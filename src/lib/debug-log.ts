// Claude Code's debug log (`~/.claude/debug/<sessionId>.txt`), written only when it runs with --debug.
// Pure helpers shared by the API route and the viewer.

/** The route sends at most the last 2 MB. */
export const DEBUG_LOG_MAX_BYTES = 2 * 1024 * 1024;

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "<id>.txt" for a session log path whose name is a session id, else null. Nothing else reaches the path. */
export function debugLogName(sessionFile: string): string | null {
  const base = sessionFile.split(/[\\/]/).pop() ?? "";
  if (!base.endsWith(".jsonl")) return null;
  const id = base.slice(0, -".jsonl".length);
  return SESSION_ID.test(id) ? `${id.toLowerCase()}.txt` : null;
}

/** Text of a file's tail read from byte `start`: when that's mid-file, the cut-off first line is dropped. */
export function tailText(buf: Uint8Array, start: number): string {
  let from = 0;
  if (start > 0) {
    const nl = buf.indexOf(0x0a);
    from = nl === -1 ? buf.length : nl + 1;
  }
  return new TextDecoder().decode(buf.subarray(from));
}

export type DebugLevel = "debug" | "info" | "warn" | "error";
export type DebugEntry = { ts?: number; level: DebugLevel; text: string };

const LINE = /^(\d{4}-\d\d-\d\dT[\d:.]+Z?)\s+\[(\w+)\]\s?(.*)$/;
const LEVELS: Record<string, DebugLevel> = { DEBUG: "debug", VERBOSE: "debug", TRACE: "debug", INFO: "info", WARN: "warn", WARNING: "warn", ERROR: "error", FATAL: "error" };

/** One entry per "<time> [LEVEL] message" line; lines without that prefix (stack traces) join the entry above. */
export function parseDebugLog(text: string): DebugEntry[] {
  const out: DebugEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (m) {
      const ts = Date.parse(m[1]);
      out.push({ ...(Number.isNaN(ts) ? {} : { ts }), level: LEVELS[m[2].toUpperCase()] ?? "debug", text: m[3] });
    } else if (line.trim()) {
      const last = out.at(-1);
      if (last) last.text += "\n" + line;
      else out.push({ level: "debug", text: line });
    }
  }
  return out;
}
