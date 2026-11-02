import fs from "node:fs/promises";
import path from "node:path";
import { PROJECTS_ROOT, listProjects, subagentsDir } from "@/lib/claude-logs";
import { mergeOverview, sessionDigest, type SessionDigest } from "@/lib/analytics/stats";
import { buildSession, type AgentLog, type AgentMeta, type LogRecord } from "@/lib/session";

export const dynamic = "force-dynamic";

const TIME_BOX_MS = 20_000;
const DAY_MS = 86_400_000;
const AGENT_LOG = /^agent-(.+)\.jsonl$/;
const ROOT = path.resolve(PROJECTS_ROOT);

/** Thrown when the time budget runs out in the middle of a session. */
class TimeUp extends Error {}

// Per-session numbers (no log text; null when the log couldn't be read), keyed by the files' path + mtime + size.
// Memory only, never written to disk.
const cache = new Map<string, { sig: string; digest: SessionDigest | null }>();
// Work already under way, shared by overlapping requests (e.g. a period switch, or React's double effects in dev).
const parsing = new Map<string, Promise<SessionDigest | null>>();
const scans = new Map<number, Promise<Record<string, unknown>>>();

function parseLines(text: string, deadline: number): LogRecord[] {
  const out: LogRecord[] = [];
  let start = 0;
  for (let n = 0; start < text.length; n++) {
    if (n % 2000 === 1999 && Date.now() > deadline) throw new TimeUp();
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;
    const line = text.slice(start, end);
    start = end + 1;
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

async function readDigest(file: string, rel: string, info: { project: string; title: string }, helpers: { id: string; abs: string }[], deadline: number) {
  const main = parseLines(await fs.readFile(file, "utf8"), deadline);
  const agents: Record<string, AgentLog> = {};
  for (const h of helpers) {
    if (Date.now() > deadline) throw new TimeUp();
    let meta: AgentMeta | undefined;
    try {
      meta = JSON.parse(await fs.readFile(h.abs.replace(/\.jsonl$/, ".meta.json"), "utf8"));
    } catch {
      // no or half-written metadata
    }
    agents[h.id] = { meta, records: parseLines(await fs.readFile(h.abs, "utf8").catch(() => ""), deadline) };
  }
  if (Date.now() > deadline) throw new TimeUp();
  return sessionDigest(buildSession(main, agents), { file: rel, project: info.project, title: info.title });
}

async function digestOf(rel: string, info: { project: string; title: string; mtime: number; size: number }, deadline: number): Promise<SessionDigest | null> {
  const file = path.resolve(ROOT, rel);
  // listProjects only hands back files it found under the projects folder; check anyway.
  if (!file.startsWith(ROOT + path.sep)) return null;
  const helpers = await helperFiles(file);
  const sig = [`${info.mtime}:${info.size}`, ...helpers.map((h) => h.sig)].join("|");
  const hit = cache.get(file);
  if (hit?.sig === sig) return hit.digest;

  const key = `${file}\n${sig}`;
  let job = parsing.get(key);
  if (!job) {
    job = readDigest(file, rel, info, helpers, deadline).then(
      (digest) => {
        cache.set(file, { sig, digest });
        return digest;
      },
      (err) => {
        if (err instanceof TimeUp) throw err; // out of time: try again next request
        cache.set(file, { sig, digest: null }); // unreadable: don't retry until the file changes
        return null;
      },
    );
    parsing.set(key, job);
    job.finally(() => parsing.delete(key)).catch(() => {});
  }
  return job;
}

async function scan(days: number) {
  const now = Date.now();
  const deadline = now + TIME_BOX_MS;
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
    if (Date.now() > deadline) {
      partial = true;
      break;
    }
    try {
      const d = await digestOf(s.file, { project: s.project, title: s.title, mtime: s.mtime, size: s.size }, deadline);
      if (d) digests.push(d);
    } catch (err) {
      if (err instanceof TimeUp) {
        partial = true;
        break;
      }
      // anything else: skip this session
    }
    scanned++;
  }

  // Forget sessions that no longer exist.
  const live = new Set(projects.flatMap((p) => p.sessions.map((s) => path.resolve(ROOT, s.file))));
  for (const key of cache.keys()) if (!live.has(key)) cache.delete(key);

  const overview = mergeOverview(digests, { days, now, projects: Object.fromEntries(projects.map((p) => [p.dir, p.path])) });
  return { ...overview, partial, scanned, total: sessions.length, generatedAt: now };
}

/**
 * Token use across every session in the last `days` days (default 30): per day, per model, per project, top tools.
 * Built with the same session model as the session views. Stops after 20 s and says so with `partial: true`.
 * Overlapping requests for the same period share one scan.
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("days");
  const days = raw === null ? 30 : /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(days) || days < 1 || days > 365) return new Response("days must be a whole number from 1 to 365", { status: 400 });

  let job = scans.get(days);
  if (!job) {
    job = scan(days);
    scans.set(days, job);
    job.finally(() => scans.delete(days)).catch(() => {});
  }
  return Response.json(await job);
}
