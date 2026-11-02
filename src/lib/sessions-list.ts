// Pure helpers for the session browser: date groups, search, sorting, worktrees, copy commands and labels.
// No Node imports, so both the browser and the server (and scripts/sessions.check.mts) can use them.

export type DateLabel = "Today" | "Yesterday" | "This week" | "This month" | "Older";
export type SessionSort = "recent" | "started";

const LABELS: DateLabel[] = ["Today", "Yesterday", "This week", "This month", "Older"];

type Dated = { mtime: number; started?: number };
const keyOf = (s: Dated, by: SessionSort) => (by === "started" ? (s.started ?? s.mtime) : s.mtime);

/** Newest first by last activity ("recent") or by when the session began ("started"). */
export function sortSessions<S extends Dated>(list: S[], by: SessionSort): S[] {
  return [...list].sort((a, b) => keyOf(b, by) - keyOf(a, by));
}

/**
 * Buckets sessions by local calendar day: Today, Yesterday, the 7 days up to today ("This week"),
 * the 30 days up to today ("This month"), then Older. Keeps the input order inside each bucket and
 * leaves out empty buckets.
 */
export function groupByDate<S extends Dated>(sessions: S[], now: number, by: SessionSort = "recent"): { label: DateLabel; sessions: S[] }[] {
  const day = (back: number) => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - back); // setDate keeps local midnight across daylight-saving changes
    return d.getTime();
  };
  const starts = [day(0), day(1), day(6), day(29)];
  const buckets = LABELS.map((label) => ({ label, sessions: [] as S[] }));
  for (const s of sessions) {
    const t = keyOf(s, by);
    const i = starts.findIndex((start) => t >= start);
    buckets[i === -1 ? 4 : i].sessions.push(s);
  }
  return buckets.filter((b) => b.sessions.length);
}

// Claude Code names a project folder after the cwd with every non-alphanumeric char replaced by "-".
export const encodeProjectDir = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, "-");

/** The project folder name of a listed session file ("<projectDir>/<id>.jsonl"). */
export const projectOfFile = (file: string) => file.split(/[\\/]/)[0];

type Searchable = { id: string; file: string; title: string; firstPrompt?: string; model?: string; live?: boolean };

/** Search (every word must appear in the title, first prompt, id or model), project and "running now" filters. */
export function filterSessions<S extends Searchable>(list: S[], opts: { q?: string; projects?: string[]; liveOnly?: boolean }): S[] {
  const words = (opts.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const projects = opts.projects?.length ? new Set(opts.projects) : null;
  return list.filter((s) => {
    if (opts.liveOnly && !s.live) return false;
    if (projects && !projects.has(projectOfFile(s.file))) return false;
    if (!words.length) return true;
    const hay = [s.title, s.firstPrompt, s.id, s.model].filter(Boolean).join("\n").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

const WINDOWS_PATH = /^(?:[A-Za-z]:[\\/]|\\\\)/;
export const isWindowsPath = (p: string) => WINDOWS_PATH.test(p);

/**
 * The main project folder when `cwd` is a git worktree, else undefined. Claude Code's own worktrees live in
 * "<project>/.claude/worktrees/<name>"; other worktrees have a `.git` file ("gitdir: <main>/.git/worktrees/<name>").
 */
export function worktreeParent(cwd: string, gitFile?: string): string | undefined {
  if (!cwd) return undefined;
  const m = /[\\/]\.claude[\\/]worktrees[\\/]/.exec(cwd);
  if (m) return cwd.slice(0, m.index) || undefined;
  const g = gitFile && /^gitdir:\s*(.+?)[\\/]\.git[\\/]worktrees[\\/]/m.exec(gitFile);
  if (!g) return undefined;
  // Git writes forward slashes even on Windows; match the cwd's own spelling.
  return /^[A-Za-z]:\//.test(g[1]) ? g[1].replace(/\//g, "\\") : g[1];
}

// Inside Windows double quotes cmd.exe still expands %VAR% and PowerShell expands $(...) and `; a " ends the quote.
// Inside POSIX single quotes everything is literal (a ' is escaped below), but a line break still ends the command.
const UNSAFE_WINDOWS = /["`$%\r\n]/;
const UNSAFE_POSIX = /[\r\n]/;
const SAFE_ID = /^[\w-]+$/;

/** False when the folder (read from a log, so possibly crafted) can't be quoted safely in a `cd` command. */
export function cwdIsSafe(cwd: string | undefined): boolean {
  if (!cwd) return true;
  return !(isWindowsPath(cwd) ? UNSAFE_WINDOWS : UNSAFE_POSIX).test(cwd);
}

/**
 * The command that reopens a session in its own folder: `cd '<cwd>' && claude --resume <id>`, with
 * `--fork-session` to continue in a new copy. Windows folders (a drive letter or \\server) get double quotes.
 * A folder that can't be quoted safely drops the `cd` part; an id that isn't letters, digits, _ and - gives null.
 */
export function resumeCommand(cwd: string | undefined, id: string, fork = false): string | null {
  if (!SAFE_ID.test(id)) return null;
  const cmd = `claude --resume ${id}${fork ? " --fork-session" : ""}`;
  if (!cwd || !cwdIsSafe(cwd)) return cmd;
  const quoted = isWindowsPath(cwd) ? `"${cwd}"` : `'${cwd.replace(/'/g, "'\\''")}'`;
  return `cd ${quoted} && ${cmd}`;
}

const APPS: Record<string, string> = {
  cli: "Terminal",
  "claude-vscode": "VS Code",
  "claude-jetbrains": "JetBrains",
  "claude-desktop": "Claude desktop app",
  "sdk-ts": "Agent SDK",
  "sdk-py": "Agent SDK",
  "sdk-cli": "Agent SDK",
  mcp: "MCP",
};
/** Where Claude Code was started from, from the log's `entrypoint`. */
export const appName = (entrypoint?: string) => (entrypoint ? (APPS[entrypoint] ?? entrypoint) : undefined);

const MODES: Record<string, { label: string; text: string; risky?: boolean }> = {
  default: { label: "Asks before changes", text: "Claude asks you before it edits files or runs commands." },
  acceptEdits: { label: "Edits without asking", text: "Claude changes files without asking, but still asks before running commands." },
  plan: { label: "Planning only", text: "Claude can look around and suggest a plan, but makes no changes until you approve." },
  auto: { label: "Auto mode", text: "Claude decides on its own, with safety checks on risky actions." },
  dontAsk: { label: "Pre-approved only", text: "Claude only does what you allowed in advance and skips anything else without asking." },
  bypassPermissions: { label: "Never asks", text: "Every safety prompt is switched off: Claude can change files and run commands without asking.", risky: true },
};
/** Plain-English name for Claude Code's permission mode. */
export function permissionLabel(mode: string): { label: string; text: string; risky: boolean } {
  const m = MODES[mode];
  return m ? { ...m, risky: !!m.risky } : { label: mode, text: "A permission mode cc-trace doesn't know yet.", risky: false };
}

/** The last two folders of a path, either separator. */
export const shortPath = (p: string) => p.split(/[\\/]/).filter(Boolean).slice(-2).join("/") || p;

/** The user's home folder as it appears at the start of a recorded path, for masking. */
export function homeOf(p?: string): string | undefined {
  return p ? /^(?:\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/.exec(p)?.[0] : undefined;
}

export function formatTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

export function formatDuration(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return "under a minute";
  if (m < 60) return `${m} min`;
  const h = ms / 3_600_000;
  return h < 48 ? `${h.toFixed(h < 10 ? 1 : 0)} h` : `${Math.round(h / 24)} days`;
}

export function ago(ms: number, now = Date.now()): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** "claude-opus-4-1-20250805" -> "Opus 4.1". Unknown names pass through. */
export function modelName(model?: string): string | undefined {
  if (!model) return undefined;
  const m = /claude-(?:(\d)-(\d)-)?(opus|sonnet|haiku)(?:-(\d+)(?:-(\d)(?!\d))?)?/.exec(model);
  if (!m) return model;
  const family = m[3][0].toUpperCase() + m[3].slice(1);
  // Old names put the version first ("claude-3-5-sonnet"); new ones after ("claude-sonnet-4-5").
  const version = m[1] ? `${m[1]}${m[2] !== "0" ? "." + m[2] : ""}` : m[4] && m[4].length < 3 ? `${m[4]}${m[5] ? "." + m[5] : ""}` : "";
  return version ? `${family} ${version}` : family;
}

// ── Opening a log from disk (drag and drop): read in the browser only ──

// file.text() plus splitting needs several times the file size in memory, and V8 strings top out near 512 MB.
export const MAX_DROP_BYTES = 150 * 1024 * 1024;
export const AGENT_LOG = /^agent-(.+)\.jsonl$/;
export const AGENT_META = /^agent-(.+)\.meta\.json$/;

/** Why a set of dropped files can't be opened, in plain English, or null when they can. */
export function dropProblem(files: { name: string; size: number }[]): string | null {
  const logs = files.filter((f) => /\.jsonl$/i.test(f.name));
  if (!logs.length) return "Pick a Claude Code log: a file ending in .jsonl.";
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > MAX_DROP_BYTES)
    return `That's too big to open in the browser: ${Math.round(total / 1024 / 1024)} MB, and cc-trace reads up to 150 MB from a dropped file. Sessions on this computer have no limit: pick it from the session list instead.`;
  if (logs.filter((f) => !AGENT_LOG.test(f.name)).length > 1) return "Drop one session at a time, plus its agent-… helper files if you have them.";
  return null;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- log records are untyped JSON */
/** One JSON record per line; blank, broken and non-object lines are skipped. */
export function parseLogText(text: string): Record<string, any>[] {
  const out: Record<string, any>[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec && typeof rec === "object" && !Array.isArray(rec)) out.push(rec);
    } catch {
      // a corrupt line: skip it
    }
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** `p`'s value, or `fallback` if it fails or takes longer than `ms` (so a dead network folder can't hang a listing). */
export function withTimeout<T, F>(p: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<F>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([p.catch(() => fallback), late]).finally(() => clearTimeout(timer));
}
