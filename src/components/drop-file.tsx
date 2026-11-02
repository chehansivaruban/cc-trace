"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FileText, Loader2, Upload, X } from "lucide-react";
import { maskSecrets } from "@/lib/redact";
import { AGENT_LOG, AGENT_META, dropProblem, parseLogText } from "@/lib/sessions-list";
import type { AgentLog, AgentMeta, LogRecord } from "@/lib/session";
import { useSettings } from "@/lib/settings";

// Viewing a log someone sent you: the file is read in this browser tab only. Nothing is uploaded or saved.

export type LoadLog = (records: LogRecord[], name: string, agents: Record<string, AgentLog>) => void;

const OPEN_EVENT = "cc-trace:open-log";

export { parseLogText };

/** Reads a session log, plus any helper logs ("agent-<id>.jsonl" and ".meta.json") dropped with it. */
async function readLogFiles(files: File[]): Promise<{ records: LogRecord[]; name: string; agents: Record<string, AgentLog> }> {
  const problem = dropProblem(files);
  if (problem) throw new Error(problem);
  const logs = files.filter((f) => /\.jsonl$/i.test(f.name));
  const main = logs.find((f) => !AGENT_LOG.test(f.name)) ?? logs[0];
  const records = parseLogText(await main.text());
  if (!records.some((r) => r.type === "user" || r.type === "assistant"))
    throw new Error("That file doesn't look like a Claude Code log: it has no messages in it.");

  const agents: Record<string, AgentLog> = {};
  for (const f of files) {
    if (f === main) continue;
    const log = AGENT_LOG.exec(f.name);
    if (log) agents[log[1]] = { ...agents[log[1]], records: parseLogText(await f.text()) };
    const meta = AGENT_META.exec(f.name);
    if (meta) {
      try {
        agents[meta[1]] = { records: agents[meta[1]]?.records ?? [], meta: JSON.parse(await f.text()) as AgentMeta };
      } catch {
        // unreadable metadata: the helper just keeps a generic name
      }
    }
  }
  for (const [id, a] of Object.entries(agents)) if (!a.records.length) delete agents[id];
  return { records, name: main.name, agents };
}

/** Opens the file chooser of the mounted <DropFile>. Call it from a click handler. */
export function openLogFile() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** Lets you drop a .jsonl log anywhere on the page (or pick one with openLogFile()) and hands its records to onLoad. */
export function DropFile({ onLoad }: { onLoad: LoadLog }) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const load = useRef(onLoad);
  useEffect(() => {
    load.current = onLoad;
  }, [onLoad]);

  useEffect(() => {
    const read = async (files: File[]) => {
      setError(null);
      const problem = dropProblem(files);
      if (problem) return setError(problem);
      setReading(true);
      // Let the "Reading the file…" card paint before the parse holds the main thread. A hidden tab never runs
      // animation frames, so a short timer also ends the wait.
      await new Promise<void>((r) => {
        requestAnimationFrame(() => setTimeout(r, 0));
        setTimeout(r, 50);
      });
      try {
        const r = await readLogFiles(files);
        load.current(r.records, r.name, r.agents);
      } catch (err) {
        setError(err instanceof Error ? err.message : "That file couldn't be read.");
      } finally {
        setReading(false);
      }
    };
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      void read([...(e.dataTransfer?.files ?? [])]);
    };
    const open = () => input.current?.click();
    const el = input.current;
    const picked = () => {
      if (el?.files?.length) void read([...el.files]);
      if (el) el.value = "";
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    window.addEventListener(OPEN_EVENT, open);
    el?.addEventListener("change", picked);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      window.removeEventListener(OPEN_EVENT, open);
      el?.removeEventListener("change", picked);
    };
  }, []);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);

  return (
    <>
      <input ref={input} type="file" accept=".jsonl,.json" multiple className="hidden" aria-hidden tabIndex={-1} />
      <AnimatePresence>
        {dragging && (
          <motion.div
            key="drop"
            className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <div className="glass-strong flex max-w-sm flex-col items-center rounded-2xl border-2 border-dashed border-foreground/25 px-8 py-10 text-center shadow-2xl">
              <Upload className="mb-3 size-6 text-muted-foreground" />
              <p className="text-sm font-medium">Drop a Claude Code log to read it here</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                A .jsonl file, plus its agent-… helper files if you have them. It stays in this browser tab: nothing is uploaded or saved.
              </p>
            </div>
          </motion.div>
        )}
        {reading && (
          <motion.div
            key="reading"
            role="status"
            className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <div className="glass-strong flex items-center gap-2.5 rounded-2xl px-5 py-4 text-sm shadow-2xl">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
              Reading the file…
            </div>
          </motion.div>
        )}
        {error && (
          <motion.div
            key="error"
            role="alert"
            className="glass-strong fixed bottom-4 left-1/2 z-[60] flex w-[min(420px,calc(100vw-32px))] -translate-x-1/2 items-start gap-2 rounded-xl px-4 py-3 text-[13px] shadow-2xl"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
          >
            <span className="min-w-0 flex-1">{error}</span>
            <button onClick={() => setError(null)} className="rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="Dismiss">
              <X className="size-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** Shown above a dropped file instead of the session info bar. */
export function DroppedBanner({ name, onClose }: { name: string; onClose: () => void }) {
  const [{ maskSensitive }] = useSettings();
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-[12px]" role="status">
      <FileText className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">Viewing a file, not live:</span> {maskSensitive ? maskSecrets(name) : name}
        <span className="hidden text-muted-foreground sm:inline"> · read in this browser only, nothing saved</span>
      </span>
      <button onClick={onClose} className="shrink-0 rounded-lg px-2 py-1 text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground">
        Close file
      </button>
    </div>
  );
}
