"use client";

// Debug log viewer (I4): Claude Code's own diary for a session, when it was started with --debug.
import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AnimatePresence, motion } from "framer-motion";
import { FileText, Loader2, Search, X } from "lucide-react";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useFolders } from "@/hooks/use-folders";
import { parseDebugLog, type DebugEntry, type DebugLevel } from "@/lib/debug-log";
import { maskSecrets } from "@/lib/redact";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { TermText } from "./term-text";

type Filter = "all" | "warn" | "error";
const FILTERS: { value: Filter; label: string; title: string }[] = [
  { value: "all", label: "All", title: "Everything" },
  { value: "warn", label: "Warn+", title: "Warnings and errors" },
  { value: "error", label: "Error", title: "Errors only" },
];
const RANK: Record<DebugLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const LEVEL_STYLE: Record<DebugLevel, string> = {
  debug: "bg-foreground/[0.06] text-muted-foreground",
  info: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  error: "bg-red-500/15 text-red-700 dark:text-red-300",
};

type State = { status: "loading" } | { status: "missing" } | { status: "error" } | { status: "ok"; entries: DebugEntry[]; truncated: boolean };

const time = (ts?: number) => (ts === undefined ? "" : new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));

/** The debug log of one session (`file` as the API lists it), with a level filter and a text filter. */
export function DebugLog({ file, className }: { file: string; className?: string }) {
  const [settings] = useSettings();
  const folders = useFolders();
  const [state, setState] = useState<State>({ status: "loading" });
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ status: "loading" });
    fetch(`/api/debug-log?file=${encodeURIComponent(file)}`, { signal: ctrl.signal })
      .then(async (r) => {
        if (r.status === 404) return setState({ status: "missing" });
        if (!r.ok) return setState({ status: "error" });
        setState({ status: "ok", entries: parseDebugLog(await r.text()), truncated: r.headers.get("X-Truncated") === "1" });
      })
      .catch((e) => e?.name !== "AbortError" && setState({ status: "error" }));
    return () => ctrl.abort();
  }, [file]);

  const all = state.status === "ok" ? state.entries : null;
  const shown = useMemo(() => {
    if (!all) return [];
    const q = query.trim().toLowerCase();
    const min = filter === "error" ? 3 : filter === "warn" ? 2 : 0;
    return all.filter((e) => RANK[e.level] >= min && (!q || e.text.toLowerCase().includes(q)));
  }, [all, filter, query]);

  const rows = useVirtualizer({ count: shown.length, getScrollElement: () => scroller.current, estimateSize: () => 30, overscan: 12 });
  const mask = (t: string) => (settings.maskSensitive ? maskSecrets(t, folders?.home) : t);

  return (
    <div className={cn("flex h-full min-h-[20rem] flex-col", className)}>
      <p className="text-[0.8125rem] leading-relaxed text-foreground/85">
        <TermText text="Claude Code's own [[debuglog:debug log]] for this session: a detailed diary of what it did behind the scenes. Most people never need it; it helps when something went wrong." />
      </p>

      {state.status === "loading" && (
        <div className="flex flex-1 items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      )}
      {state.status === "missing" && (
        <div className="mt-4 rounded-xl border border-dashed border-foreground/15 p-5 text-center">
          <FileText className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">No debug log for this session</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
            Claude Code only writes one when it is started with <code className="rounded bg-foreground/[0.06] px-1 font-mono">claude --debug</code>.
          </p>
        </div>
      )}
      {state.status === "error" && <p className="mt-4 text-sm text-muted-foreground">The debug log couldn&apos;t be read.</p>}

      {all && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Show" className="flex gap-0.5 rounded-xl bg-foreground/[0.06] p-0.5">
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  title={f.title}
                  aria-pressed={filter === f.value}
                  onClick={() => setFilter(f.value)}
                  className={cn(
                    "h-7 rounded-[10px] px-2.5 text-xs whitespace-nowrap transition-colors",
                    filter === f.value ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <label className="flex h-8 min-w-[10rem] flex-1 items-center gap-2 rounded-xl border border-foreground/10 px-2.5 focus-within:border-foreground/25">
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter the text"
                aria-label="Filter the debug log"
                className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              />
            </label>
          </div>
          <p className="mt-2 text-[0.6875rem] text-muted-foreground">
            {shown.length.toLocaleString()} of {all.length.toLocaleString()} entries
            {state.status === "ok" && state.truncated ? " · showing the last 2 MB" : ""}
          </p>
          <div ref={scroller} className="mt-2 min-h-0 flex-1 overflow-auto rounded-xl border border-foreground/10" role="log" aria-label="Debug log entries">
            {shown.length === 0 ? (
              <p className="p-4 text-center text-xs text-muted-foreground">Nothing matches.</p>
            ) : (
              <div className="relative w-full" style={{ height: rows.getTotalSize() }}>
                {rows.getVirtualItems().map((v) => {
                  const e = shown[v.index];
                  return (
                    <div
                      key={v.key}
                      data-index={v.index}
                      ref={rows.measureElement}
                      className="absolute inset-x-0 flex flex-col gap-1 border-b border-foreground/[0.05] px-3 py-1.5 sm:flex-row sm:items-start sm:gap-2"
                      style={{ transform: `translateY(${v.start}px)` }}
                    >
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="w-[3.875rem] font-mono text-[0.6875rem] text-muted-foreground tabular-nums">{time(e.ts)}</span>
                        <span className={cn("w-[2.875rem] rounded px-1.5 py-px text-center text-[0.625rem] font-semibold uppercase", LEVEL_STYLE[e.level])}>{e.level}</span>
                      </span>
                      <span className="min-w-0 flex-1 font-mono text-[0.75rem] leading-relaxed break-words whitespace-pre-wrap">{mask(e.text)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** The debug log in its own dialog. */
export function DebugLogDialog({ file, open, onClose }: { file: string; open: boolean; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(open, panel);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            ref={panel}
            tabIndex={-1}
            role="dialog"
            aria-modal
            aria-labelledby="debug-title"
            initial={{ y: 16, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={{ type: "spring", bounce: 0, duration: 0.35 }}
            onClick={(e) => e.stopPropagation()}
            className="glass-strong flex h-[80dvh] outline-none w-full max-w-[53.75rem] flex-col rounded-2xl p-5 shadow-2xl sm:p-6"
          >
            <div className="mb-2 flex items-start justify-between gap-4">
              <h2 id="debug-title" className="text-xl font-semibold tracking-tight">
                Debug log
              </h2>
              <button onClick={onClose} className="rounded-full p-1.5 text-muted-foreground hover:bg-foreground/10" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            <DebugLog file={file} className="min-h-0 flex-1" />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
