import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { PROJECTS_ROOT, listProjects, resolveSessionFile, subagentsDir, userHome } from "@/lib/claude-logs";
import { cwdMaskers, snippetOf } from "@/lib/search";
import { promptText } from "@/lib/session";

export const dynamic = "force-dynamic";

/** One match. `turn` is the 0-based request index, `step` the tool step id when the match is in a tool call. */
export type SearchHit = { file: string; title: string; turn: number; step?: string; snippet: string; ts: number };
/** The last line of every response. */
export type SearchDone = { done: true; scanned: number; matches: number; timedOut: boolean; limited: boolean };

const BUDGET_MS = 20_000;
const PER_FILE = 20;
const AROUND = 60;

/* eslint-disable @typescript-eslint/no-explicit-any -- log records are untyped JSON */
type Rec = Record<string, any>;
type Found = { text: string; step?: string };

const textOf = (c: unknown): string =>
  typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (b?.type === "text" && typeof b.text === "string" ? b.text : "")).filter(Boolean).join("\n") : "";

/** The searchable parts of a record: your messages, replies, tool input and tool output. */
function partsOf(rec: Rec, helper: boolean): Found[] {
  const content = rec.message?.content;
  const out: Found[] = [];
  if (rec.type === "user") {
    const results = Array.isArray(content) ? content.filter((b) => b?.type === "tool_result") : [];
    for (const r of results) out.push({ text: textOf(r.content), step: typeof r.tool_use_id === "string" ? r.tool_use_id : undefined });
    if (!results.length && !rec.isMeta) {
      const t = helper ? textOf(content) : promptText(rec);
      if (t) out.push({ text: t });
    }
  } else if (rec.type === "assistant" && Array.isArray(content)) {
    for (const b of content) {
      if (b?.type === "text" && typeof b.text === "string") out.push({ text: b.text });
      else if (b?.type === "tool_use") {
        let input = "";
        try {
          input = JSON.stringify(b.input ?? "");
        } catch {
          // unprintable input: skip
        }
        out.push({ text: `${b.name ?? ""} ${input}`, step: typeof b.id === "string" ? b.id : undefined });
      }
    }
  }
  return out;
}

/** True for the records buildSession turns into "Your request" steps (each opens a new request). */
function isPrompt(rec: Rec) {
  if (rec.type !== "user" || rec.isMeta || rec.isSidechain || rec.isCompactSummary) return false;
  const c = rec.message?.content;
  if (Array.isArray(c) && c.some((b) => b?.type === "tool_result")) return false;
  const raw = textOf(c);
  if (rec.origin?.kind === "task-notification" || raw.trimStart().startsWith("<task-notification>")) return false;
  const t = promptText(rec);
  return !!t && !t.startsWith("[Request interrupted");
}

/**
 * Streams matches across every session log (newest first) as NDJSON: one SearchHit per line, then one
 * SearchDone line. Case-insensitive plain substring; nothing is stored. ?q= (2–200 chars), ?limit= (1–1000,
 * default 200), ?mask=1 hides sensitive text in snippets and titles.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const q = (params.get("q") ?? "").trim();
  if (q.length < 2) return new Response("Search needs at least 2 characters", { status: 400 });
  if (q.length > 200) return new Response("Search text is too long", { status: 400 });
  const limitRaw = Number(params.get("limit") ?? 200);
  const limit = Number.isFinite(limitRaw) ? Math.min(1000, Math.max(1, Math.floor(limitRaw))) : 200;
  const home = userHome();
  const masking = params.get("mask") === "1";
  const maskFor = masking ? cwdMaskers(home) : () => (s: string) => s;
  const needle = q.toLowerCase();
  // JSON keeps these characters as they are, so a raw line without the text can't contain it either.
  const prefilter = !/["\\\u0000-\u001f]/.test(q);
  const enc = new TextEncoder();
  const started = Date.now();
  let stopped = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (v: unknown) => {
        if (!stopped) controller.enqueue(enc.encode(JSON.stringify(v) + "\n"));
      };
      let matches = 0;
      let scanned = 0;
      let timedOut = false;
      const sessions = (await listProjects()).flatMap((p) => p.sessions).sort((a, b) => b.mtime - a.mtime);
      const inRoot = (abs: string) => path.resolve(abs).startsWith(PROJECTS_ROOT + path.sep);

      /** Reads one log line by line; `onRec` returns false to stop early. */
      const scan = async (abs: string, onLine: (line: string, lower: string | null) => boolean) => {
        const input = fs.createReadStream(abs, { encoding: "utf8" });
        const rl = readline.createInterface({ input, crlfDelay: Infinity });
        try {
          for await (const line of rl) {
            if (stopped || req.signal.aborted) break;
            if (Date.now() - started > BUDGET_MS) {
              timedOut = true;
              break;
            }
            if (!onLine(line, prefilter ? line.toLowerCase() : null)) break;
          }
        } catch {
          // unreadable or vanished file: skip it
        } finally {
          rl.close();
          input.destroy();
        }
      };
      const parse = (line: string): Rec | null => {
        try {
          const v = JSON.parse(line);
          return v && typeof v === "object" && !Array.isArray(v) ? v : null;
        } catch {
          return null; // a half-written last line
        }
      };

      try {
        for (const s of sessions) {
          if (stopped || req.signal.aborted || timedOut || matches >= limit) break;
          const abs = resolveSessionFile(s.file);
          if (!abs) continue;
          scanned++;
          const mask = maskFor(s.cwd);
          // Listing titles are cut at a word boundary, so masking still sees whole words.
          const title = mask(s.title);
          let inFile = 0;
          // Requests: count your messages the way buildSession does, so jump links open the right one.
          const prompts: number[] = [];
          let before = false; // work logged before your first message makes an extra first request
          const hit = (rec: Rec, turn: number, helper: boolean) => {
            for (const part of partsOf(rec, helper)) {
              if (!part.text.toLowerCase().includes(needle)) continue;
              // Masks the whole text, then cuts the window, so a cut can't split a secret.
              const snippet = snippetOf(part.text, q, mask, AROUND);
              if (snippet === null) continue; // the only match was inside hidden text
              send({ file: s.file, title, turn, step: part.step, snippet, ts: Date.parse(rec.timestamp) || 0 } satisfies SearchHit);
              matches++;
              inFile++;
              return;
            }
          };
          const turnOfTs = (ts: number) => {
            let i = -1;
            while (i + 1 < prompts.length && prompts[i + 1] <= ts) i++;
            return i < 0 ? 0 : i + (before ? 1 : 0);
          };
          await scan(abs, (line, lower) => {
            const maybeHit = !lower || lower.includes(needle);
            const maybePrompt = line.includes('"type":"user"') && !line.includes('"tool_result"');
            const maybeEarly = !prompts.length && !before && (line.includes('"type":"assistant"') || line.includes('"api_error"'));
            if (!maybeHit && !maybePrompt && !maybeEarly) return true;
            const rec = parse(line);
            if (!rec) return true;
            // Older Claude Code versions wrote helper records into the main log.
            if (rec.isSidechain) {
              if (maybeHit) hit(rec, turnOfTs(Date.parse(rec.timestamp) || 0), true);
              return inFile < PER_FILE && matches < limit;
            }
            if (isPrompt(rec)) prompts.push(Date.parse(rec.timestamp) || 0);
            else if (!prompts.length && (rec.type === "assistant" || rec.subtype === "api_error")) before = true;
            const turn = prompts.length ? prompts.length - 1 + (before ? 1 : 0) : 0;
            if (maybeHit) hit(rec, turn, false);
            return inFile < PER_FILE && matches < limit;
          });
          // Helper logs: each match belongs to the request that was running at the time.
          const sub = subagentsDir(abs);
          const names = await fs.promises.readdir(sub).catch(() => [] as string[]);
          for (const n of names.filter((x) => /^agent-.+\.jsonl$/.test(x))) {
            if (stopped || timedOut || inFile >= PER_FILE || matches >= limit) break;
            const h = path.join(sub, n);
            if (!inRoot(h)) continue;
            await scan(h, (line, lower) => {
              if (lower && !lower.includes(needle)) return true;
              const rec = parse(line);
              if (rec) hit(rec, turnOfTs(Date.parse(rec.timestamp) || 0), true);
              return inFile < PER_FILE && matches < limit;
            });
          }
        }
      } finally {
        send({ done: true, scanned, matches, timedOut, limited: matches >= limit } satisfies SearchDone);
        if (!stopped) {
          stopped = true;
          try {
            controller.close();
          } catch {
            // the client already went away
          }
        }
      }
    },
    cancel() {
      stopped = true;
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
