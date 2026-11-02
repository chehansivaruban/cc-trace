import fs from "node:fs/promises";
import path from "node:path";
import { PROJECTS_ROOT, resolveSessionFile } from "@/lib/claude-logs";
import { DEBUG_LOG_MAX_BYTES, debugLogName, tailText } from "@/lib/debug-log";

export const dynamic = "force-dynamic";

// Claude Code keeps debug logs next to "projects" in the same config folder (CLAUDE_CONFIG_DIR or ~/.claude).
const DEBUG_DIR = path.join(path.dirname(PROJECTS_ROOT), "debug");

// No debug log is a normal answer (most sessions have none), so it is a 200, not a 404 the browser would log.
const MISSING = () => Response.json({ missing: true }, { headers: { "Cache-Control": "no-store" } });

/**
 * The debug log Claude Code wrote for a session (`<config>/debug/<sessionId>.txt`), as plain text.
 * At most the last 2 MB is sent (header `X-Truncated: 1` when cut). The path is built only from the
 * validated session id. 400 for a bad `file`; `{ missing: true }` (JSON) when there is no debug log.
 * With `check=1` only `{ missing: boolean }` is sent, so the page can say up front whether there is one.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const file = resolveSessionFile(params.get("file"));
  if (!file) return new Response("Invalid session file", { status: 400 });
  const name = debugLogName(file);
  if (!name) return MISSING();

  let fh: fs.FileHandle;
  try {
    fh = await fs.open(path.join(DEBUG_DIR, name), "r");
  } catch {
    return MISSING();
  }
  try {
    const st = await fh.stat();
    if (!st.isFile()) return MISSING();
    if (params.get("check") === "1") return Response.json({ missing: false }, { headers: { "Cache-Control": "no-store" } });
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
