import fs from "node:fs/promises";
import path from "node:path";
import { PROJECTS_ROOT, resolveSessionFile } from "@/lib/claude-logs";
import { DEBUG_LOG_MAX_BYTES, debugLogName, tailText } from "@/lib/debug-log";

export const dynamic = "force-dynamic";

// Claude Code keeps debug logs next to "projects" in the same config folder (CLAUDE_CONFIG_DIR or ~/.claude).
const DEBUG_DIR = path.join(path.dirname(PROJECTS_ROOT), "debug");

/**
 * The debug log Claude Code wrote for a session (`<config>/debug/<sessionId>.txt`), as plain text.
 * At most the last 2 MB is sent (header `X-Truncated: 1` when cut). The path is built only from the
 * validated session id; 400 for a bad `file`, 404 when there is no debug log.
 */
export async function GET(req: Request) {
  const file = resolveSessionFile(new URL(req.url).searchParams.get("file"));
  if (!file) return new Response("Invalid session file", { status: 400 });
  const name = debugLogName(file);
  if (!name) return new Response("No debug log for this session", { status: 404 });

  let fh: fs.FileHandle;
  try {
    fh = await fs.open(path.join(DEBUG_DIR, name), "r");
  } catch {
    return new Response("No debug log for this session", { status: 404 });
  }
  try {
    const st = await fh.stat();
    if (!st.isFile()) return new Response("No debug log for this session", { status: 404 });
    const size = st.size;
    const start = Math.max(0, size - DEBUG_LOG_MAX_BYTES);
    const buf = Buffer.alloc(size - start);
    const { bytesRead } = await fh.read(buf, 0, buf.length, start);
    return new Response(tailText(buf.subarray(0, bytesRead), start), {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...(start > 0 ? { "X-Truncated": "1" } : {}) },
    });
  } catch {
    return new Response("Could not read the debug log", { status: 500 });
  } finally {
    await fh.close();
  }
}
