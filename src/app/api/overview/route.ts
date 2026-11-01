import fs from "node:fs/promises";
import path from "node:path";
import { PROJECTS_ROOT, listProjects, subagentsDir } from "@/lib/claude-logs";
import { mergeOverview, sessionDigest, type SessionDigest } from "@/lib/analytics/stats";
import { buildSession, type AgentLog, type AgentMeta, type LogRecord } from "@/lib/session";

export const dynamic = "force-dynamic";

const TIME_BOX_MS = 20_000;
const DAY_MS = 86_400_000;
const AGENT_LOG = /^agent-(.+)\.jsonl$/;

// Per-session numbers (no log text), keyed by the files' path + mtime + size. Memory only, never written to disk.
const cache = new Map<string, { sig: string; digest: SessionDigest }>();

function parseLines(text: string): LogRecord[] {
  const out: LogRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec && typeof rec === "object" && !Array.isArray(rec)) out.push(rec);
    } catch {
      // a corrupt or half-written line
    }
  }
  return out;
}

/** The session's helper logs with their mtime/size, so a change in any of them refreshes the digest. */
async function helperFiles(file: string) {
  const dir = subagentsDir(file);
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const out: { id: string; abs: string; sig: string }[] = [];
  for (const n of names.sort()) {
    const m = AGENT_LOG.exec(n);
    if (!m) continue;
    const abs = path.join(dir, n);
    const st = await fs.stat(abs).catch(() => null);
    if (st?.isFile()) out.push({ id: m[1], abs, sig: `${n}:${st.mtimeMs}:${st.size}` });
  }
  return out;
}

async function digestOf(rel: string, info: { project: string; title: string; mtime: number; size: number }): Promise<SessionDigest | null> {
  const file = path.join(PROJECTS_ROOT, rel);
  // listProjects only hands back files it found under the projects folder; check anyway.
  if (!path.resolve(file).startsWith(PROJECTS_ROOT + path.sep)) return null;
  const helpers = await helperFiles(file);
  const sig = [`${info.mtime}:${info.size}`, ...helpers.map((h) => h.sig)].join("|");
  const hit = cache.get(file);
  if (hit?.sig === sig) return hit.digest;

  const main = parseLines(await fs.readFile(file, "utf8"));
  const agents: Record<string, AgentLog> = {};
  for (const h of helpers) {
    let meta: AgentMeta | undefined;
    try {
      meta = JSON.parse(await fs.readFile(h.abs.replace(/\.jsonl$/, ".meta.json"), "utf8"));
    } catch {
      // no or half-written metadata
    }
    agents[h.id] = { meta, records: parseLines(await fs.readFile(h.abs, "utf8").catch(() => "")) };
  }
  const digest = sessionDigest(buildSession(main, agents), { file: rel, project: info.project, title: info.title });
  cache.set(file, { sig, digest });
  return digest;
}

/**
 * Token use across every session in the last `days` days (default 30): per day, per model, per project, top tools.
 * Built with the same session model as the session views. Stops after 20 s and says so with `partial: true`.
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("days");
  const days = raw === null ? 30 : /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(days) || days < 1 || days > 365) return new Response("days must be a whole number from 1 to 365", { status: 400 });

  const started = Date.now();
  const now = started;
  // A log last written before the window can't hold work inside it.
  const cutoff = now - (days + 1) * DAY_MS;
  const projects = await listProjects();
  const sessions = projects
    .flatMap((p) => p.sessions.map((s) => ({ ...s, project: p.dir })))
    .filter((s) => s.mtime >= cutoff)
    .sort((a, b) => b.mtime - a.mtime);

  const digests: SessionDigest[] = [];
  let partial = false;
  let scanned = 0;
  for (const s of sessions) {
    if (Date.now() - started > TIME_BOX_MS) {
      partial = true;
      break;
    }
    try {
      const d = await digestOf(s.file, { project: s.project, title: s.title, mtime: s.mtime, size: s.size });
      if (d) digests.push(d);
    } catch {
      // unreadable log: skip it
    }
    scanned++;
  }

  // Forget sessions that no longer exist.
  const live = new Set(projects.flatMap((p) => p.sessions.map((s) => path.join(PROJECTS_ROOT, s.file))));
  for (const key of cache.keys()) if (!live.has(key)) cache.delete(key);

  const overview = mergeOverview(digests, { days, now, projects: Object.fromEntries(projects.map((p) => [p.dir, p.path])) });
  return Response.json({ ...overview, partial, scanned, total: sessions.length, generatedAt: now });
}
