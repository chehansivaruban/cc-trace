import fs from "node:fs/promises";
import path from "node:path";
import { watch } from "chokidar";
import { resolveSessionFile, subagentsDir } from "@/lib/claude-logs";

export const dynamic = "force-dynamic";

const NEWLINE = 0x0a;
const AGENT_FILE = /^agent-(.+)\.(jsonl|meta\.json)$/;

type Tail = { offset: number; pending: Buffer };

/**
 * Replays a session log and its sub-agent logs, then tails all of them.
 * Events: "records" {source, records} where source is null for the main log or the sub-agent's id,
 * "agent" {id, meta} for a sub-agent's metadata, "reset" when the main log was rewritten, then "ready".
 */
export async function GET(req: Request) {
  const file = resolveSessionFile(new URL(req.url).searchParams.get("file"));
  if (!file) return new Response("Invalid session file", { status: 400 });
  try {
    await fs.access(file);
  } catch {
    return new Response("Session not found", { status: 404 });
  }

  const projectDir = path.dirname(file);
  const sessionDir = file.slice(0, -".jsonl".length);
  const subDir = subagentsDir(file);
  const enc = new TextEncoder();
  const tails = new Map<string, Tail>();
  let closed = false;
  let cleanup = () => {};

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const readLog = async (abs: string, source: string | null) => {
        let tail = tails.get(abs);
        if (!tail) tails.set(abs, (tail = { offset: 0, pending: Buffer.alloc(0) }));
        const { size } = await fs.stat(abs);
        if (size < tail.offset) {
          // File was truncated or rewritten: start over.
          tail.offset = 0;
          tail.pending = Buffer.alloc(0);
          if (source === null) send("reset", null);
        }
        if (size === tail.offset) return;

        const fh = await fs.open(abs, "r");
        let chunk: Buffer;
        try {
          chunk = Buffer.alloc(size - tail.offset);
          const { bytesRead } = await fh.read(chunk, 0, chunk.length, tail.offset);
          chunk = chunk.subarray(0, bytesRead);
          tail.offset += bytesRead;
        } finally {
          await fh.close();
        }

        // Bytes after the last newline: a line still being written, or a split multi-byte char.
        tail.pending = Buffer.concat([tail.pending, chunk]);
        const end = tail.pending.lastIndexOf(NEWLINE);
        if (end === -1) return;
        const complete = tail.pending.subarray(0, end).toString("utf8");
        tail.pending = tail.pending.subarray(end + 1);

        const records: unknown[] = [];
        for (const line of complete.split("\n")) {
          if (!line.trim()) continue;
          try {
            records.push(JSON.parse(line));
          } catch {
            // a corrupt line: skip it rather than drop the batch
          }
        }
        if (records.length) send("records", { source, records });
      };

      const onPath = async (abs: string) => {
        if (abs === file) return readLog(file, null);
        if (path.dirname(abs) !== subDir) return;
        const m = AGENT_FILE.exec(path.basename(abs));
        if (!m) return;
        if (m[2] === "jsonl") return readLog(abs, m[1]);
        try {
          send("agent", { id: m[1], meta: JSON.parse(await fs.readFile(abs, "utf8")) });
        } catch {
          // half-written metadata: the next change event re-reads it
        }
      };

      // Serialize reads so overlapping change events never read the same bytes twice.
      let queue = Promise.resolve();
      const schedule = (abs: string) => {
        queue = queue.then(() => onPath(abs)).catch((err) => send("error", String(err)));
        return queue;
      };

      // Watch the project folder (it always exists) but only this session's files, so helpers
      // that start later are picked up too. Docker Desktop bind mounts don't reliably forward
      // file events, so containers poll instead.
      const allowed = new Set([projectDir, file, sessionDir, subDir]);
      const watcher = watch(projectDir, {
        ignoreInitial: true,
        depth: 2,
        usePolling: process.env.CC_TRACE_POLL === "1",
        interval: 1000,
        ignored: (p: string) => !allowed.has(p) && path.dirname(p) !== subDir,
      })
        .on("add", schedule)
        .on("change", schedule);
      await new Promise<void>((resolve) => watcher.once("ready", () => resolve()));

      // Initial replay: metadata first so helpers have names before their records arrive.
      await schedule(file);
      const names = await fs.readdir(subDir).catch(() => [] as string[]);
      for (const n of names.filter((n) => n.endsWith(".meta.json"))) await schedule(path.join(subDir, n));
      for (const n of names.filter((n) => n.endsWith(".jsonl"))) await schedule(path.join(subDir, n));
      send("ready", null);

      const heartbeat = setInterval(() => !closed && controller.enqueue(enc.encode(": ping\n\n")), 15_000);

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        void watcher.close();
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
