// One spelling per path, from any OS, for comparing paths on the client and the server alike. Pure.

/**
 * A comparable key for a path: separators become "/", repeated separators, "." and ".." are resolved, a
 * trailing separator is dropped. Windows-style paths (a drive letter or \\server) ignore case, like Windows
 * does. Git Bash's "/c/Users/...", WSL's "/mnt/c/Users/..." and the long-path "\\?\C:\..." are the same file as
 * "C:\Users\...". POSIX paths keep their case.
 */
export function normalizePath(p: string): string {
  let s = p.replace(/\\/g, "/");
  // "\\?\C:\x" and "\\?\UNC\server\share" (Windows long paths).
  s = s.replace(/^\/\/[?.]\/UNC\//i, "//").replace(/^\/\/[?.]\/(?=[a-zA-Z]:)/, "");
  // "/c/x", "/cygdrive/c/x", "/mnt/c/x" -> "c:/x".
  s = s.replace(/^\/(?:cygdrive\/|mnt\/)?([a-zA-Z])(?=\/|$)/, "$1:");
  const windows = /^[a-zA-Z]:/.test(s) || s.startsWith("//");
  const lead = s.startsWith("//") ? "//" : s.startsWith("/") ? "/" : "";
  const out: string[] = [];
  for (const part of s.slice(lead.length).split("/")) {
    if (!part || part === ".") continue;
    // Never climb above a drive ("C:") or the root.
    if (part === "..") {
      if (out.length && out.at(-1) !== ".." && !/^[a-zA-Z]:$/.test(out.at(-1)!)) out.pop();
      else if (!lead && !out.length) out.push("..");
      continue;
    }
    out.push(part);
  }
  const key = lead + out.join("/");
  return windows ? key.toLowerCase() : key || lead;
}

/** A log opened by drag and drop is shown as file "dropped:<name>": it isn't in the Claude folder. */
export const DROPPED_PREFIX = "dropped:";
/** True for a dropped log: it has no URL, bookmark, debug log or server copy, so features that need one skip it. */
export const isDroppedFile = (file?: string | null): boolean => typeof file === "string" && file.startsWith(DROPPED_PREFIX);
