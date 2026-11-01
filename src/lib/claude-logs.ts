import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promptText } from "./session.ts";
import { encodeProjectDir, worktreeParent } from "./sessions-list.ts";

// CLAUDE_CONFIG_DIR is Claude Code's own override for ~/.claude (also how the Docker image mounts it).
export const CLAUDE_ROOT = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
export const PROJECTS_ROOT = path.join(CLAUDE_ROOT, "projects");
// Claude Code's registry of running sessions: one "<pid>.json" per open Claude Code.
export const SESSIONS_ROOT = path.join(CLAUDE_ROOT, "sessions");

export type SessionInfo = {
  id: string;
  file: string; // "<projectDir>/<id>.jsonl", relative to PROJECTS_ROOT
  mtime: number;
  size: number;
  title: string; // the /rename title, else Claude's auto title, else the first prompt
  customTitle?: string;
  aiTitle?: string;
  firstPrompt?: string;
  cwd?: string; // the folder Claude Code ran in
  model?: string; // the latest model that replied
  requests: number; // your messages (the requests on the map)
  tokens: number; // all tokens, helpers included
  counting?: boolean; // requests and tokens are still being counted for a big log
  started: number; // first record's time
  durationMs: number; // first to last record
  helpers: number; // sub-agents this session started
  gitBranch?: string;
  live: boolean; // Claude Code is running this session right now
  version?: string; // Claude Code version
  entrypoint?: string; // cli, claude-vscode, claude-desktop, ...
  worktreeOf?: string; // the main project folder when the cwd is a git worktree
};

export type ProjectInfo = {
  dir: string;
  path: string;
  mtime: number;
  worktreeOf?: string;
  sessions: SessionInfo[];
};

export type LiveSession = {
  sessionId: string;
  pid: number;
  cwd: string;
  startedAt: number;
  version?: string;
  entrypoint?: string;
  file?: string; // "<projectDir>/<id>.jsonl" when its log exists
  name?: string; // Claude Code's own name for the session
  status?: string; // "busy" or "idle"
};

const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 64 * 1024;

async function readSlice(file: string, start: number, length: number) {
  const fh = await fs.open(file, "r");
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, start);
    return buf.subarray(0, bytesRead).toString("utf8");
  } finally {
    await fh.close();
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- log records are untyped JSON */
function parseRecord(line: string): Record<string, any> | null {
  if (!line) return null;
  try {
    const rec = JSON.parse(line);
    return rec && typeof rec === "object" && !Array.isArray(rec) ? rec : null;
  } catch {
    return null; // a line cut off by the byte limit, or a corrupt one
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** What one stretch of a log says about its session. First values for cwd/prompt/start, latest for the rest. */
export type LogScan = {
  cwd?: string;
  cwds?: string[]; // every folder seen, in order
  firstPrompt?: string;
  customTitle?: string;
  aiTitle?: string;
  model?: string;
  gitBranch?: string;
  version?: string;
  entrypoint?: string;
  firstTs?: number;
  lastTs?: number;
};

function scanText(text: string, skipFirst: boolean): LogScan {
  const out: LogScan = {};
  const lines = text.split("\n");
  if (skipFirst) lines.shift(); // starts mid-line
  for (const line of lines) {
    const rec = parseRecord(line);
    if (!rec || rec.isSidechain) continue;
    const ts = Date.parse(rec.timestamp);
    if (ts) {
      out.firstTs ??= ts;
      out.lastTs = ts;
    }
    const cwd = str(rec.cwd);
    if (cwd) {
      out.cwd ??= cwd;
      if (!out.cwds) out.cwds = [cwd];
      else if (!out.cwds.includes(cwd)) out.cwds.push(cwd);
    }
    if (rec.type === "custom-title") out.customTitle = str(rec.customTitle) ?? out.customTitle;
    if (rec.type === "ai-title") out.aiTitle = str(rec.aiTitle) ?? out.aiTitle;
    const model = rec.type === "assistant" ? str(rec.message?.model) : undefined;
    if (model && model !== "<synthetic>") out.model = model;
    out.gitBranch = str(rec.gitBranch) ?? out.gitBranch;
    out.version = str(rec.version) ?? out.version;
    out.entrypoint = str(rec.entrypoint) ?? out.entrypoint;
    if (!out.firstPrompt && rec.type === "user" && !rec.isMeta && !rec.isCompactSummary) {
      const text = promptText(rec);
      if (text && !text.startsWith("[Request interrupted")) out.firstPrompt = text;
    }
  }
  return out;
}

/** Scans the first bytes of a log (a cut-off last line is skipped). */
export const scanHead = (text: string) => scanText(text, false);
/** Scans the last bytes of a log; its first line is a fragment and is skipped. */
export const scanTail = (text: string) => scanText(text, true);

/** /rename title, else Claude's auto title, else the first prompt (the tail holds the latest titles). */
export function pickTitle(head: LogScan, tail: LogScan): string {
  const t = tail.customTitle ?? head.customTitle ?? tail.aiTitle ?? head.aiTitle ?? head.firstPrompt ?? tail.firstPrompt;
  return t?.replace(/\s+/g, " ").trim().slice(0, 120) || "Untitled session";
}

/** Running totals over a whole log, fed in pieces as it is read. Replies are counted once by message id. */
export type LogCount = { requests: number; byMsg: Map<string, number>; model?: string; customTitle?: string; aiTitle?: string; lines: number };
export const createCount = (): LogCount => ({ requests: 0, byMsg: new Map(), lines: 0 });

const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
// Same sum as totalTokens(usageOf(u)) in session.ts.
/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped usage JSON */
function tokensOf(u: any): number {
  const split = u?.cache_creation && typeof u.cache_creation === "object" ? num(u.cache_creation.ephemeral_5m_input_tokens) + num(u.cache_creation.ephemeral_1h_input_tokens) : 0;
  return num(u?.input_tokens) + (split || num(u?.cache_creation_input_tokens)) + num(u?.cache_read_input_tokens) + num(u?.output_tokens);
}

const IS_ASSISTANT = /"type"\s*:\s*"assistant"/;
const IS_USER = /"type"\s*:\s*"user"/;
const IS_TITLE = /"type"\s*:\s*"(?:custom|ai)-title"/;

/** Adds complete lines to the totals. `lead` is the main log: only it has your requests and titles. */
export function countLines(acc: LogCount, text: string, lead: boolean) {
  for (const line of text.split("\n")) {
    if (!line) continue;
    const i = acc.lines++;
    // Most lines are tool results; skip parsing anything that can't change the totals.
    const user = lead && IS_USER.test(line) && !line.includes('"tool_use_id"');
    if (!IS_ASSISTANT.test(line) && !user && !(lead && IS_TITLE.test(line))) continue;
    const rec = parseRecord(line);
    if (!rec) continue;
    if (rec.type === "assistant") {
      if (lead && rec.isSidechain) continue;
      if (rec.message?.usage) acc.byMsg.set(str(rec.message.id) ?? str(rec.uuid) ?? `#${i}`, tokensOf(rec.message.usage));
      const model = lead ? str(rec.message?.model) : undefined;
      if (model && model !== "<synthetic>") acc.model = model;
    } else if (rec.type === "user" && lead) {
      if (rec.isSidechain || rec.isMeta || rec.isCompactSummary || rec.origin?.kind === "task-notification") continue;
      const content = rec.message?.content;
      if (Array.isArray(content) && content.some((b) => b?.type === "tool_result")) continue;
      const text = promptText(rec);
      if (text && !text.startsWith("[Request interrupted")) acc.requests++;
    } else if (rec.type === "custom-title" && lead) acc.customTitle = str(rec.customTitle) ?? acc.customTitle;
    else if (rec.type === "ai-title" && lead) acc.aiTitle = str(rec.aiTitle) ?? acc.aiTitle;
  }
}

export function countTokens(acc: LogCount): number {
  let n = 0;
  for (const v of acc.byMsg.values()) n += v;
  return n;
}

// ── Whole-log counting, cached in memory per file. Logs only grow, so later calls read just the new bytes. ──

type Tally = { offset: number; size: number; pending: Buffer; count: LogCount; queue: Promise<void> };
const tallies = new Map<string, Tally>();
const CHUNK = 4 * 1024 * 1024;
const NEWLINE = 0x0a;

function tally(abs: string, size: number, lead: boolean): Tally {
  let t = tallies.get(abs);
  if (!t || size < t.offset) {
    // New, or rewritten shorter: start over.
    t = { offset: 0, size, pending: Buffer.alloc(0), count: createCount(), queue: Promise.resolve() };
    tallies.set(abs, t);
  }
  const cur = t;
  cur.size = Math.max(cur.size, size);
  if (cur.offset >= size) return cur;
  cur.queue = cur.queue
    .then(() =>
      limit(async () => {
        if (cur.offset >= size) return;
        const fh = await fs.open(abs, "r");
        try {
          while (cur.offset < size) {
            const buf = Buffer.alloc(Math.min(CHUNK, size - cur.offset));
            const { bytesRead } = await fh.read(buf, 0, buf.length, cur.offset);
            if (!bytesRead) break;
            cur.offset += bytesRead;
            // Bytes after the last newline (a line still being written, or a split character) wait for next time.
            const data = Buffer.concat([cur.pending, buf.subarray(0, bytesRead)]);
            const end = data.lastIndexOf(NEWLINE);
            if (end === -1) {
              cur.pending = data;
              continue;
            }
            countLines(cur.count, data.subarray(0, end).toString("utf8"), lead);
            cur.pending = Buffer.from(data.subarray(end + 1));
          }
        } finally {
          await fh.close();
        }
      }),
    )
    .catch(() => {
      // unreadable or vanished: keep what was counted
    });
  return cur;
}

// At most a few logs are read at once, so thousands of sessions can't exhaust file handles.
let running = 0;
const waiting: (() => void)[] = [];
async function limit<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 6) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

// Counting a never-seen big log can take a while: answer after this long and finish in the background.
const COUNT_BUDGET_MS = 1500;

// ── Head and tail scans, cached by path + mtime + size ──

type Scanned = { mtime: number; size: number; head: LogScan; tail: LogScan };
const scans = new Map<string, Scanned>();

async function scanLog(abs: string, mtime: number, size: number): Promise<Scanned> {
  const hit = scans.get(abs);
  if (hit && hit.mtime === mtime && hit.size === size) return hit;
  const head = scanHead(await readSlice(abs, 0, HEAD_BYTES));
  // A small log is all head: its first line is whole, so it is scanned once, as a head.
  const tail = size <= HEAD_BYTES ? head : scanTail(await readSlice(abs, size - TAIL_BYTES, TAIL_BYTES));
  const s = { mtime, size, head, tail };
  scans.set(abs, s);
  return s;
}

const worktrees = new Map<string, Promise<string | undefined>>();
/** Checks the folder's `.git` (a worktree has a small file there, not a folder). Cached per folder. */
function worktreeOf(cwd: string | undefined): Promise<string | undefined> {
  if (!cwd) return Promise.resolve(undefined);
  const quick = worktreeParent(cwd);
  if (quick) return Promise.resolve(quick);
  let p = worktrees.get(cwd);
  if (!p) {
    p = (async () => {
      try {
        const git = path.join(cwd, ".git");
        const st = await fs.stat(git);
        if (!st.isFile() || st.size > 4096) return undefined;
        return worktreeParent(cwd, await fs.readFile(git, "utf8"));
      } catch {
        return undefined; // folder gone, or not a git checkout
      }
    })();
    worktrees.set(cwd, p);
  }
  return p;
}

/**
 * Folder names are the absolute path with every non-alphanumeric char replaced by "-",
 * which is lossy, so prefer the cwd recorded inside the log.
 */
function decodeDir(dir: string) {
  // Windows: "C:\Users\me\app" is stored as "C--Users-me-app".
  const drive = /^([A-Za-z])--/.exec(dir);
  if (drive) return `${drive[1]}:\\${dir.slice(3).replace(/-/g, "\\")}`;
  return dir.replace(/-/g, "/");
}

type Found = { dir: string; name: string; mtime: number; size: number; scan: Scanned; logs: Tally[]; helpers: number; worktreeOf?: string };

async function findSession(dir: string, name: string, seen: Set<string>): Promise<Found | null> {
  try {
    const file = path.join(PROJECTS_ROOT, dir, name);
    const st = await fs.stat(file);
    const scan = await scanLog(file, st.mtimeMs, st.size);
    const logs = [tally(file, st.size, true)];
    seen.add(file);
    const sub = subagentsDir(file);
    const agentLogs = await fs
      .readdir(sub)
      .then((n) => n.filter((x) => x.endsWith(".jsonl")))
      .catch(() => [] as string[]);
    for (const n of agentLogs) {
      const a = path.join(sub, n);
      const size = await fs.stat(a).then(
        (s) => s.size,
        () => -1,
      );
      if (size < 0) continue;
      logs.push(tally(a, size, false));
      seen.add(a);
    }
    const found: Found = { dir, name, mtime: st.mtimeMs, size: st.size, scan, logs, helpers: agentLogs.length };
    found.worktreeOf = await worktreeOf(homeCwd(found));
    return found;
  } catch {
    return null;
  }
}

/** The folder Claude Code files this session under (where `claude --resume` finds it), else the first one seen. */
function homeCwd(f: Found): string | undefined {
  const all = [...(f.scan.head.cwds ?? []), ...(f.scan.tail.cwds ?? [])];
  return all.find((c) => encodeProjectDir(c) === f.dir) ?? all[0];
}

function toInfo(f: Found, live: Set<string>): SessionInfo {
  const { head, tail } = f.scan;
  const c = f.logs[0].count;
  const id = f.name.slice(0, -".jsonl".length);
  const started = head.firstTs ?? f.mtime;
  const last = tail.lastTs ?? head.lastTs ?? started;
  return {
    id,
    file: `${f.dir}/${f.name}`,
    mtime: f.mtime,
    size: f.size,
    // Titles in the tail are the newest; the whole-log count finds ones that scrolled out of it.
    title: pickTitle({ ...head, customTitle: c.customTitle ?? head.customTitle, aiTitle: c.aiTitle ?? head.aiTitle }, tail),
    customTitle: tail.customTitle ?? c.customTitle ?? head.customTitle,
    aiTitle: tail.aiTitle ?? c.aiTitle ?? head.aiTitle,
    firstPrompt: head.firstPrompt?.slice(0, 300),
    cwd: homeCwd(f),
    model: tail.model ?? c.model ?? head.model,
    requests: c.requests,
    tokens: f.logs.reduce((n, l) => n + countTokens(l.count), 0),
    counting: f.logs.some((l) => l.offset < l.size) || undefined,
    started,
    durationMs: Math.max(0, last - started),
    helpers: f.helpers,
    gitBranch: tail.gitBranch ?? head.gitBranch,
    live: live.has(id),
    version: tail.version ?? head.version,
    entrypoint: tail.entrypoint ?? head.entrypoint,
    worktreeOf: f.worktreeOf,
  };
}

/** The cwd that names this folder, else the folder most sessions ran in, else a lossy decode of the name. */
function projectPath(dir: string, list: Found[]): string {
  const cwds = list.map(homeCwd).filter((c): c is string => !!c);
  const exact = cwds.find((c) => encodeProjectDir(c) === dir);
  if (exact) return exact;
  const freq = new Map<string, number>();
  for (const c of cwds) freq.set(c, (freq.get(c) ?? 0) + 1);
  return [...freq].sort((a, b) => b[1] - a[1])[0]?.[0] ?? decodeDir(dir);
}

export async function listProjects(): Promise<ProjectInfo[]> {
  let dirs: string[];
  try {
    dirs = await fs.readdir(PROJECTS_ROOT);
  } catch {
    return [];
  }
  const live = new Set((await readLiveSessions()).map((l) => l.sessionId));
  const seen = new Set<string>();

  const found = await Promise.all(
    dirs.map(async (dir) => {
      let names: string[];
      try {
        names = (await fs.readdir(path.join(PROJECTS_ROOT, dir))).filter((n) => n.endsWith(".jsonl"));
      } catch {
        return []; // not a directory
      }
      return (await Promise.all(names.map((name) => findSession(dir, name, seen)))).filter((s): s is Found => s !== null);
    }),
  );

  // Counting a big log for the first time can take a while: answer within the budget, keep counting in the background.
  const counting = found.flat().flatMap((f) => f.logs.map((l) => l.queue));
  await Promise.race([Promise.all(counting), new Promise((r) => setTimeout(r, COUNT_BUDGET_MS))]);
  // Forget logs that are gone.
  for (const key of tallies.keys()) if (!seen.has(key)) tallies.delete(key);
  for (const key of scans.keys()) if (!seen.has(key)) scans.delete(key);

  const projects = found.map((list, i): ProjectInfo | null => {
    if (!list.length) return null;
    const sessions = list.map((f) => toInfo(f, live)).sort((a, b) => b.mtime - a.mtime);
    return {
      dir: dirs[i],
      path: projectPath(dirs[i], list),
      mtime: sessions[0].mtime,
      worktreeOf: list.find((f) => f.worktreeOf)?.worktreeOf,
      sessions,
    };
  });
  return projects.filter((p): p is ProjectInfo => p !== null).sort((a, b) => b.mtime - a.mtime);
}

/** True when a process with this id is running. EPERM means it exists but belongs to another user. */
export function isAlive(pid: unknown): boolean {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

// Session ids are uuids; anything else could walk out of the projects folder.
const SAFE_ID = /^[\w-]+$/;

/** Finds "<projectDir>/<id>.jsonl": first in the folder named after the cwd, else in any project folder. */
async function findLog(id: string, cwd: string): Promise<string | undefined> {
  const exists = (dir: string) =>
    fs.stat(path.join(PROJECTS_ROOT, dir, `${id}.jsonl`)).then(
      (s) => s.isFile(),
      () => false,
    );
  const guess = encodeProjectDir(cwd);
  if (guess && (await exists(guess))) return `${guess}/${id}.jsonl`;
  const dirs = await fs.readdir(PROJECTS_ROOT).catch(() => [] as string[]);
  for (const dir of dirs) if (dir !== guess && (await exists(dir))) return `${dir}/${id}.jsonl`;
  return undefined;
}

/** The sessions Claude Code is running right now, newest first. A missing registry folder gives []. */
export async function readLiveSessions(root = SESSIONS_ROOT): Promise<LiveSession[]> {
  let names: string[];
  try {
    names = (await fs.readdir(root)).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const out = await Promise.all(
    names.map(async (name): Promise<LiveSession | null> => {
      try {
        const abs = path.join(root, name);
        if ((await fs.stat(abs)).size > 64 * 1024) return null;
        const rec = parseRecord(await fs.readFile(abs, "utf8"));
        if (!rec || typeof rec.sessionId !== "string" || !SAFE_ID.test(rec.sessionId) || !isAlive(rec.pid)) return null;
        const cwd = str(rec.cwd) ?? "";
        return {
          sessionId: rec.sessionId,
          pid: rec.pid,
          cwd,
          startedAt: num(rec.startedAt),
          version: str(rec.version),
          entrypoint: str(rec.entrypoint),
          file: await findLog(rec.sessionId, cwd),
          name: str(rec.name),
          status: str(rec.status),
        };
      } catch {
        return null;
      }
    }),
  );
  return out.filter((l): l is LiveSession => l !== null).sort((a, b) => b.startedAt - a.startedAt);
}

/** Resolves a client-supplied session path, refusing anything outside the projects root. */
export function resolveSessionFile(rel: string | null): string | null {
  if (!rel || !rel.endsWith(".jsonl")) return null;
  const abs = path.resolve(PROJECTS_ROOT, rel);
  return abs.startsWith(PROJECTS_ROOT + path.sep) ? abs : null;
}

/** Sub-agents write their own logs next to the session: "<id>/subagents/agent-<agentId>.jsonl" (+ ".meta.json"). */
export function subagentsDir(sessionFile: string) {
  return path.join(sessionFile.slice(0, -".jsonl".length), "subagents");
}
