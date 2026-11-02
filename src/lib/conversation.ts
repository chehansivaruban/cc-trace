// Pure helpers behind the Conversation view and the tool renderers: chat rows, diffs, command outcomes, labels.
import { diffWords as wordDiff, structuredPatch } from "diff";
import type { Actor, Step, Turn } from "./session.ts";

/* eslint-disable @typescript-eslint/no-explicit-any -- tool inputs and results are untyped JSON */

// ── text ──

/** A tool's output as text: plain strings, or the text blocks of a content array. */
export function outputText(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
  return "";
}
const str = (v: unknown) => (typeof v === "string" ? v : "");

// ── diffs ──

export type WordSegment = { text: string; type: "same" | "added" | "removed" };
/** Word-level changes between two strings. Very long strings come back as one removed and one added piece. */
export function diffWords(oldText: string, newText: string): WordSegment[] {
  if (oldText.length + newText.length > 10_000) {
    const out: WordSegment[] = [];
    if (oldText) out.push({ text: oldText, type: "removed" });
    if (newText) out.push({ text: newText, type: "added" });
    return out;
  }
  return wordDiff(oldText, newText).map((c) => ({ text: c.value, type: c.added ? "added" : c.removed ? "removed" : "same" }));
}

export type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] };
/** A file change: its hunks, whether they came from Claude Code's log (real line numbers) and the line counts. */
export type EditDiff = { hunks: Hunk[]; fromLog: boolean; added: number; removed: number };

const isHunk = (h: any): h is Hunk =>
  !!h && typeof h === "object" && typeof h.oldStart === "number" && typeof h.newStart === "number" && Array.isArray(h.lines) && h.lines.every((l: unknown) => typeof l === "string");

function finish(hunks: Hunk[], fromLog: boolean): EditDiff {
  const clean = hunks.map((h) => ({ ...h, lines: h.lines.filter((l) => !l.startsWith("\\")) }));
  const count = (c: string) => clean.reduce((n, h) => n + h.lines.filter((l) => l[0] === c).length, 0);
  return { hunks: clean, fromLog, added: count("+"), removed: count("-") };
}
// Above this size a line diff can take seconds: show the old text as removed and the new as added instead.
export const DIFF_MAX_CHARS = 200_000;
const linesOf = (t: string) => (t ? t.replace(/\n$/, "").split("\n") : []);
/** One hunk that removes all of `a` and adds all of `b`: the plain before/after. */
function plainHunk(a: string, b: string): Hunk {
  const old = linesOf(a);
  const neu = linesOf(b);
  return { oldStart: 1, oldLines: old.length, newStart: 1, newLines: neu.length, lines: [...old.map((l) => "-" + l), ...neu.map((l) => "+" + l)] };
}
function compute(a: string, b: string): Hunk[] {
  if (a.length + b.length > DIFF_MAX_CHARS) return [plainHunk(a, b)];
  // A time limit as well: some inputs are slow even when small.
  const patch = structuredPatch("a", "b", a, b, "", "", { context: 3, timeout: 1500 });
  return patch ? (patch.hunks as Hunk[]) : [plainHunk(a, b)];
}

/**
 * The diff of a file-changing tool call. Prefers the `structuredPatch` Claude Code logged (it has the real
 * line numbers); otherwise computes one from the old and new text. Undefined when there's nothing to compare
 * (a new file, a tool that doesn't edit).
 */
export function editDiff(tool: string | undefined, input: unknown, result: unknown): EditDiff | undefined {
  const logged = (result as any)?.structuredPatch;
  if (Array.isArray(logged) && logged.length && logged.every(isHunk)) return finish(logged, true);
  const inp = input as any;
  if (!inp || typeof inp !== "object") return undefined;
  if (tool === "Edit" && (typeof inp.old_string === "string" || typeof inp.new_string === "string")) return finish(compute(str(inp.old_string), str(inp.new_string)), false);
  if (tool === "MultiEdit" && Array.isArray(inp.edits)) return finish(inp.edits.flatMap((e: any) => compute(str(e?.old_string), str(e?.new_string))), false);
  if (tool === "NotebookEdit" && typeof inp.new_source === "string") return finish(compute("", inp.new_source), false);
  return undefined;
}

// Steps never change once their result is in, so a diff is worked out once per step (the view and
// find-in-request both need it). Running steps aren't cached: their result may still arrive.
const diffCache = new WeakMap<Step, EditDiff | undefined>();
/** `editDiff` for a step, cached. Write only diffs when it replaced a file. */
export function stepDiff(step: Step): EditDiff | undefined {
  if (diffCache.has(step)) return diffCache.get(step);
  const write = step.tool === "Write";
  const d = write && (step.result as any)?.type !== "update" ? undefined : editDiff(step.tool, step.input, step.result);
  if (step.status !== "running") diffCache.set(step, d);
  return d;
}

export type DiffRow = { type: "same" | "added" | "removed"; text: string; oldNo?: number; newNo?: number; words?: WordSegment[] };

/**
 * Splits a hunk into display rows, in line order. A removed line followed by its replacement gets word-level
 * highlights. Stops after `max` rows (word diffs are only worked out for rows that will be shown).
 */
export function diffRows(hunk: Hunk, max = Infinity): DiffRow[] {
  const lines = hunk.lines.filter((l) => !l.startsWith("\\"));
  const rows: DiffRow[] = [];
  let o = hunk.oldStart;
  let n = hunk.newStart;
  let i = 0;
  while (i < lines.length && rows.length < max) {
    const c = lines[i][0];
    if (c !== "-" && c !== "+") {
      rows.push({ type: "same", text: lines[i].slice(1), oldNo: o++, newNo: n++ });
      i++;
      continue;
    }
    const dels: string[] = [];
    const adds: string[] = [];
    while (i < lines.length && lines[i][0] === "-") dels.push(lines[i++].slice(1));
    while (i < lines.length && lines[i][0] === "+") adds.push(lines[i++].slice(1));
    const room = max - rows.length;
    const pairs = dels.map((d, k) => (k < adds.length && k < room ? similarWords(d, adds[k]) : undefined));
    for (const [k, text] of dels.entries()) if (rows.length < max) rows.push({ type: "removed", text, oldNo: o++, words: pairs[k]?.filter((w) => w.type !== "added") });
    for (const [k, text] of adds.entries()) if (rows.length < max) rows.push({ type: "added", text, newNo: n++, words: pairs[k]?.filter((w) => w.type !== "removed") });
  }
  return rows;
}

/** Masks lines as one text, so a secret spread over several lines (a private key) is caught; one entry per line. */
export function maskLines(lines: string[], mask: (t: string) => string): string[] {
  const out = mask(lines.join("\n")).split("\n");
  return out.length === lines.length ? out : lines.map(mask);
}

/** Word highlights only help when the two lines are mostly alike. */
function similarWords(a: string, b: string): WordSegment[] | undefined {
  if (a.length + b.length > 2000) return undefined;
  const words = diffWords(a, b);
  const same = words.filter((w) => w.type === "same").reduce((n, w) => n + w.text.trim().length, 0);
  return same >= 0.3 * Math.max(a.trim().length, b.trim().length, 1) ? words : undefined;
}

// ── tool outcomes ──

export type BashOutcome = { exitCode?: number; stdout: string; stderr: string; interrupted: boolean; background?: string; note?: string };

/** What a command printed and how it ended. Claude Code only writes the exit code when it isn't 0. */
export function bashOutcome(step: Step): BashOutcome {
  const r = step.result as any;
  let stdout = "";
  let stderr = "";
  let interrupted = false;
  let background: string | undefined;
  let note: string | undefined;
  if (r && typeof r === "object" && !Array.isArray(r)) {
    stdout = str(r.stdout);
    stderr = str(r.stderr);
    interrupted = r.interrupted === true;
    background = str(r.backgroundTaskId) || undefined;
    note = str(r.returnCodeInterpretation) || undefined;
  } else {
    stdout = typeof r === "string" ? r : outputText(step.output);
  }
  let exitCode: number | undefined;
  const m = /^(?:Error: )?Exit code (\d+)\r?\n?/.exec(stdout);
  if (m) {
    exitCode = Number(m[1]);
    stdout = stdout.slice(m[0].length);
  }
  const fromNote = /exit code (\d+)/i.exec(note ?? "");
  if (exitCode === undefined && fromNote) exitCode = Number(fromNote[1]);
  if (exitCode === undefined && step.status === "success") exitCode = 0;
  return { exitCode, stdout, stderr, interrupted, background, note };
}

export type ToolOutcome = "denied" | "interrupted" | "orphan";
const DENIED = /doesn't want to proceed|user (?:rejected|denied)|permission (?:to use .* )?(?:was )?denied|was rejected by the user/i;

/** How a tool call ended badly, if it did: you said no, you stopped it, or it never got a result. */
export function toolOutcome(step: Step, open: boolean): ToolOutcome | undefined {
  const out = outputText(step.output);
  if (/\[Request interrupted by user/i.test(out)) return "interrupted";
  if (step.status === "error" && DENIED.test(out)) return "denied";
  if (step.status === "running" && !open) return "orphan";
  return undefined;
}

/** Time spent in tools, with calls that ran in parallel counted once. */
export function toolTime(steps: Step[]): number {
  const spans = steps
    .filter((s) => s.tool && typeof s.durationMs === "number" && s.durationMs > 0)
    .map((s) => [s.ts, s.ts + (s.durationMs as number)] as const)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let start = -Infinity;
  let end = -Infinity;
  for (const [a, b] of spans) {
    if (a > end) {
      if (end > start) total += end - start;
      start = a;
      end = b;
    } else end = Math.max(end, b);
  }
  if (end > start) total += end - start;
  return total;
}

// ── labels ──

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
/** "claude-opus-4-5-20251101" -> "Opus 4.5". Unknown names come back unchanged. */
export function modelLabel(model?: string): string | undefined {
  if (!model) return undefined;
  const id = model.replace(/\[.*\]$/, "").replace(/-\d{8}$/, "");
  const a = /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?$/.exec(id);
  if (a) return `${cap(a[1])} ${a[2]}${a[3] ? `.${a[3]}` : ""}`;
  const b = /^claude-(\d+)(?:-(\d{1,2}))?-(opus|sonnet|haiku)$/.exec(id);
  if (b) return `${cap(b[3])} ${b[1]}${b[2] ? `.${b[2]}` : ""}`;
  return model;
}

/** "mcp__claude-in-chrome__navigate" -> { server: "claude in chrome", tool: "navigate" }. */
export function mcpLabel(name?: string): { server: string; tool: string } | undefined {
  if (!name?.startsWith("mcp__")) return undefined;
  const [, server = "", ...rest] = name.split("__");
  return { server: server.replace(/^plugin_[^_]+_/, "").replace(/[_-]+/g, " ").trim(), tool: rest.join("__").replace(/_/g, " ") };
}

const LANGS: Record<string, string> = {
  ts: "typescript", tsx: "tsx", mts: "typescript", cts: "typescript", js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift", dart: "dart", c: "c", h: "c", cpp: "c++",
  cs: "c#", php: "php", sh: "shell", bash: "shell", zsh: "shell", ps1: "powershell", json: "json", jsonl: "json", yaml: "yaml", yml: "yaml",
  toml: "toml", md: "markdown", mdx: "markdown", html: "html", css: "css", scss: "css", sql: "sql", xml: "xml", svg: "xml", txt: "text",
};
/** The language of a file, from its name. */
export function langOf(path?: unknown): string | undefined {
  if (typeof path !== "string") return undefined;
  const name = path.split(/[\\/]/).pop() ?? "";
  if (/^dockerfile$/i.test(name)) return "dockerfile";
  if (/^makefile$/i.test(name)) return "makefile";
  const ext = /\.([\w]+)$/.exec(name)?.[1]?.toLowerCase();
  return ext ? LANGS[ext] ?? ext : undefined;
}

// ── chat rows ──

export type RowKind = "you" | "text" | "tool" | "memory" | "compact" | "error" | "interrupted" | "event";
export type ConvRow = {
  id: string;
  kind: RowKind;
  step: Step;
  /** Who said or did it: the sender for messages, else the step's own agent. */
  speaker: string;
  /** 0 for you and the lead, 1 for a helper, 2 for a helper's helper (capped at 3). */
  depth: number;
  outcome?: ToolOutcome;
};

function depthOf(id: string, actors: Record<string, Actor>): number {
  let d = 0;
  let a: Actor | undefined = actors[id];
  const seen = new Set<string>();
  while (a?.kind === "helper" && !seen.has(a.id) && d < 3) {
    seen.add(a.id);
    d++;
    a = a.parent ? actors[a.parent] : undefined;
  }
  return d;
}

function kindOf(s: Step): RowKind {
  if (s.event === "api_error") return "error";
  if (s.event === "compact") return "compact";
  if (s.event === "interrupted" || s.kind === "stop") return "interrupted";
  if (s.event) return "event";
  if (s.kind === "prompt") return "you";
  if (s.kind === "memory") return "memory";
  if (s.kind === "tool" || s.tool === "AskUserQuestion") return "tool";
  return "text";
}

/**
 * One chat row per step of the request, in order. `open` is true while the request is still going, so a
 * tool without a result is "running" rather than "never finished".
 */
export function conversationRows(turn: Turn, actors: Record<string, Actor>, opts: { open: boolean }): ConvRow[] {
  return turn.steps.map((step) => {
    const kind = kindOf(step);
    const speaker = step.from ?? step.actor;
    return { id: step.id, kind, step, speaker, depth: depthOf(speaker, actors ?? {}), outcome: kind === "tool" ? toolOutcome(step, opts.open) : undefined };
  });
}

const plain = (t: string) => t.replace(/\[\[(\w+):([^\]]+)\]\]/g, "$2");
/** The text a row shows, for find-in-page and copy. */
export function rowText(row: ConvRow): string {
  const s = row.step;
  if (row.kind === "you" || row.kind === "text") return typeof s.quote === "string" ? s.quote : "";
  if (row.kind === "tool") return `${s.title} ${s.subtitle}`;
  return [s.title, plain(s.what), typeof s.quote === "string" ? s.quote : ""].filter(Boolean).join(" ");
}

/** "0.4 s", "12 s", "3 min 5 s", "1 h 20 min". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 60)} h`;
}

// ── what each renderer shows ──
// The renderers and find-in-request (src/lib/find-text.ts) both read these, so a search sees the same text.

/** How much of a long text the UI renders before "Show all" (or "copy to get all"). */
export const CAPS = { code: 60_000, markdown: 20_000, textBox: 1200, diffRows: 400, files: 60, webResults: 12 } as const;

/** The text a code panel renders for a value: strings as written, anything else as JSON, cut at CAPS.code. */
export function codeText(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? String(value);
  return text.length > CAPS.code ? text.slice(0, CAPS.code) : text;
}

/** The text a collapsed text box renders. */
export const textBoxText = (text: string) => (text.length > CAPS.textBox ? text.slice(0, CAPS.textBox) + "…" : text);

const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});

// Claude Code numbers each line it shows Claude ("    12\t…" or "    12→…"); the raw file has no numbers.
const NUMBERED = /^\s*\d+[\t→]/;
export function stripLineNumbers(text: string): string {
  const lines = text.split("\n");
  return lines.every((l) => !l.trim() || NUMBERED.test(l)) ? lines.map((l) => l.replace(NUMBERED, "")).join("\n") : text;
}

export function readData(step: Step) {
  const input = obj(step.input);
  const file = obj(obj(step.result).file);
  const content = typeof file.content === "string" ? file.content : stripLineNumbers(outputText(step.output));
  return { input, file, path: str(input.file_path), content, isImage: !!step.images?.length || file.type === "image" };
}

export function searchData(step: Step) {
  const input = obj(step.input);
  const r = step.result && typeof step.result === "object" ? obj(step.result) : undefined;
  const files: string[] = Array.isArray(r?.filenames) ? r.filenames.filter((f: unknown) => typeof f === "string") : [];
  const content = str(r?.content);
  return { input, result: r, pattern: String(input.pattern ?? ""), files, content, text: outputText(step.output), count: typeof r?.numFiles === "number" ? r.numFiles : files.length };
}

export function webSearchData(step: Step) {
  const r = obj(step.result);
  const links: { title: string; url: string }[] = [];
  const notes: string[] = [];
  for (const item of Array.isArray(r.results) ? r.results : []) {
    if (typeof item === "string") notes.push(item);
    else for (const c of Array.isArray(item?.content) ? item.content : []) if (typeof c?.url === "string") links.push({ title: str(c.title) || c.url, url: c.url });
  }
  const summary = notes.join("\n\n") || (links.length ? "" : outputText(step.output));
  return { query: str(obj(step.input).query), links, summary, result: r };
}
/** A URL as shown under a search result: without the scheme. */
export const shortUrl = (url: string) => url.replace(/^https?:\/\//, "");

export function webFetchData(step: Step) {
  const input = obj(step.input);
  const r = obj(step.result);
  return { url: str(input.url), prompt: str(input.prompt), text: str(r.result) || outputText(step.output), result: r };
}

export type QuestionData = { header: string; question: string; multi: boolean; options: { label: string; description: string; chosen: boolean }[]; other: string[] };
/** AskUserQuestion: the questions, their options, and what you picked (from the result, or the text Claude saw). */
export function questionData(step: Step): { questions: QuestionData[]; answered: boolean; out: string } {
  const answers: Record<string, string[]> = {};
  const a = obj(step.result).answers;
  const out = outputText(step.output);
  if (a && typeof a === "object") for (const [q, v] of Object.entries(a)) answers[q] = (Array.isArray(v) ? v : [v]).map(String);
  else for (const m of out.matchAll(/"([^"]+)"="([^"]*)"/g)) answers[m[1]] = m[2].split(/,\s*/);
  const list: any[] = Array.isArray(obj(step.input).questions) ? obj(step.input).questions : [];
  const questions = list.map((q) => {
    const question = str(q?.question);
    const picked = answers[question] ?? [];
    const options = (Array.isArray(q?.options) ? q.options : []).map((o: any) => ({ label: str(o?.label), description: str(o?.description), chosen: picked.includes(str(o?.label)) }));
    const labels = options.map((o: { label: string }) => o.label);
    return { header: str(q?.header), question, multi: q?.multiSelect === true, options, other: picked.filter((p) => p && !labels.includes(p)) };
  });
  return { questions, answered: Object.keys(answers).length > 0, out };
}

export type TodoItem = { text: string; status: string };
export function todoItems(input: unknown): TodoItem[] {
  const i = obj(input);
  const list = Array.isArray(i.todos) ? i.todos : Array.isArray(i.items) ? i.items : [];
  return list
    .map((t: any) => ({ text: str(t?.content) || str(t?.subject) || str(t?.title) || str(t?.activeForm), status: str(t?.status) || "pending" }))
    .filter((t: TodoItem) => t.text);
}
