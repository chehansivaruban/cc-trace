// "What changed in my project" (N2): every file Claude touched, with each change in order.
import { normalizePath } from "../paths.ts";
import type { SessionModel, Step } from "../session.ts";

export const FILE_CHANGE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** A full path, not one relative to the folder Claude was working in. */
export const isAbsolutePath = (p: string) => /^([\\/]|[a-zA-Z]:|~)/.test(p);

/** Whether `p` is `dir` or somewhere below it (never a sibling that shares a prefix). */
export function isInside(p: string, dir: string): boolean {
  const k = normalizePath(p);
  const d = normalizePath(dir);
  return k === d || k.startsWith(d.endsWith("/") ? d : d + "/");
}

/** The file a tool step works on, if any. */
export function fileOf(step: Step): string | undefined {
  const input = step.input as { file_path?: unknown; notebook_path?: unknown } | null | undefined;
  const p = input && typeof input === "object" ? (input.file_path ?? input.notebook_path) : undefined;
  return typeof p === "string" && p.trim() ? p : undefined;
}

/** `created`: Claude made the file (its first change was a Write, with no read or change of it before). */
export type FileTouched = { path: string; reads: number; writes: number; edits: number; created: boolean; changes: { step: Step; turn: number }[] };

/**
 * Every file read or changed in the session, one entry per file however its path was spelled.
 * Changed files come first (in the order they were first changed), then files that were only read.
 * Failed steps changed nothing, so they don't count.
 */
export function filesTouched(m: SessionModel): FileTouched[] {
  const files = new Map<string, FileTouched & { first: number; firstChange: number }>();
  let order = 0;
  for (const [ti, turn] of m.turns.entries()) {
    for (const step of turn.steps) {
      if (step.kind !== "tool" || !step.tool || step.status === "error") continue;
      const isRead = step.tool === "Read";
      if (!isRead && !FILE_CHANGE_TOOLS.has(step.tool)) continue;
      const p = fileOf(step);
      if (!p) continue;
      const key = normalizePath(p);
      let f = files.get(key);
      if (!f) files.set(key, (f = { path: p, reads: 0, writes: 0, edits: 0, created: false, changes: [], first: order, firstChange: Infinity }));
      order++;
      if (isRead) {
        f.reads++;
        continue;
      }
      if (step.tool === "Write") f.writes++;
      else f.edits++;
      if (f.firstChange === Infinity) {
        f.firstChange = order;
        // Claude Code marks a Write that replaced an existing file as an "update".
        f.created = step.tool === "Write" && !f.reads && (step.result as { type?: unknown } | undefined)?.type !== "update";
      }
      f.changes.push({ step, turn: ti });
    }
  }
  return [...files.values()]
    .sort((a, b) => a.firstChange - b.firstChange || a.first - b.first)
    .map((f) => ({ path: f.path, reads: f.reads, writes: f.writes, edits: f.edits, created: f.created, changes: f.changes }));
}
