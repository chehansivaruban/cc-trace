import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promptText } from "./session";

// CLAUDE_CONFIG_DIR is Claude Code's own override for ~/.claude (also how the Docker image mounts it).
export const PROJECTS_ROOT = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");

export type SessionInfo = {
  id: string;
  file: string; // "<projectDir>/<id>.jsonl", relative to PROJECTS_ROOT
  mtime: number;
  size: number;
  title: string;
  helpers: number; // sub-agents this session started
};

export type ProjectInfo = {
  dir: string;
  path: string;
  mtime: number;
  sessions: SessionInfo[];
};

const HEAD_BYTES = 64 * 1024;

async function readHead(file: string) {
  const fh = await fs.open(file, "r");
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, bytesRead).toString("utf8");
  } finally {
    await fh.close();
  }
}

/** Pulls the real cwd and the first human prompt out of the start of a log. */
function scanHead(head: string) {
  let cwd: string | undefined;
  let title: string | undefined;
  for (const line of head.split("\n")) {
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line);
    } catch {
      continue; // last line is usually cut off by the byte limit
    }
    if (!cwd && typeof rec.cwd === "string") cwd = rec.cwd;
    if (!title && rec.type === "user" && !rec.isMeta) title = promptText(rec);
    if (cwd && title) break;
  }
  return { cwd, title };
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

export async function listProjects(): Promise<ProjectInfo[]> {
  let dirs: string[];
  try {
    dirs = await fs.readdir(PROJECTS_ROOT);
  } catch {
    return [];
  }

  const projects = await Promise.all(
    dirs.map(async (dir): Promise<ProjectInfo | null> => {
      const abs = path.join(PROJECTS_ROOT, dir);
      let names: string[];
      try {
        names = (await fs.readdir(abs)).filter((n) => n.endsWith(".jsonl"));
      } catch {
        return null; // not a directory
      }
      let cwd: string | undefined;
      const sessions = (
        await Promise.all(
          names.map(async (name): Promise<SessionInfo | null> => {
            try {
              const file = path.join(abs, name);
              const st = await fs.stat(file);
              const head = scanHead(await readHead(file));
              cwd ??= head.cwd;
              const helpers = await fs
                .readdir(subagentsDir(file))
                .then((n) => n.filter((x) => x.endsWith(".jsonl")).length)
                .catch(() => 0);
              return {
                id: name.slice(0, -".jsonl".length),
                file: `${dir}/${name}`,
                mtime: st.mtimeMs,
                size: st.size,
                title: head.title?.slice(0, 120) ?? "Untitled session",
                helpers,
              };
            } catch {
              return null;
            }
          }),
        )
      )
        .filter((s): s is SessionInfo => s !== null)
        .sort((a, b) => b.mtime - a.mtime);
      if (!sessions.length) return null;
      return { dir, path: cwd ?? decodeDir(dir), mtime: sessions[0].mtime, sessions };
    }),
  );

  return projects
    .filter((p): p is ProjectInfo => p !== null)
    .sort((a, b) => b.mtime - a.mtime);
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
