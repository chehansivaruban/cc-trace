"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, Folder, MonitorSmartphone } from "lucide-react";
import { useLiveSessions } from "@/components/session-info-bar";
import { TermText } from "@/components/term-text";
import type { ProjectInfo, SessionInfo } from "@/lib/claude-logs";
import { useMask } from "@/hooks/use-mask";
import type { AppPageProps } from "@/lib/route";
import { ago, appName, formatTokens, modelName, shortPath } from "@/lib/sessions-list";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

/** Every Claude Code session running on this computer right now, across projects. */
export function LivePage({ navigate }: AppPageProps) {
  const [{ showTechnical }] = useSettings();
  const [technical, setTechnical] = useState(showTechnical);
  const live = useLiveSessions(5_000);
  const [sessions, setSessions] = useState<Map<string, SessionInfo>>(new Map());
  const [now, setNow] = useState(() => Date.now());
  const [recount, setRecount] = useState(0); // bumped while the server is still counting big logs

  // Titles and counts come from the session list, refetched when the set of running sessions changes.
  const ids = live?.map((l) => l.sessionId).join(",") ?? "";
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    fetch("/api/sessions")
      .then((r) => (r.ok ? (r.json() as Promise<ProjectInfo[]>) : []))
      .then((projects) => {
        if (stop) return;
        const list = projects.flatMap((p) => p.sessions);
        setSessions(new Map(list.map((s) => [s.id, s])));
        // Counts still being worked out: ask again shortly.
        if (list.some((s) => s.counting)) timer = setTimeout(() => setRecount((n) => n + 1), 3000);
      })
      .catch(() => {});
    setNow(Date.now());
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [ids, recount]);

  const m = useMask();

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-12 sm:px-6">
      <button
        onClick={() => navigate({ page: "session" })}
        className="mb-4 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Back to the session
      </button>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Live now</h1>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            <TermText text="The Claude Code [[session:sessions]] open on this computer right now. Pick one to watch it as it happens." />
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground select-none">
          <input type="checkbox" checked={technical} onChange={(e) => setTechnical(e.target.checked)} className="accent-foreground" />
          Technical details
        </label>
      </div>

      <div className="mt-6 space-y-2.5">
        {live === null ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Looking for running sessions…</p>
        ) : !live.length ? (
          <div className="rounded-2xl border border-dashed border-foreground/15 px-6 py-12 text-center">
            <p className="text-sm font-medium">Nothing is running right now</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Open Claude Code and it will show up here within a few seconds.</p>
          </div>
        ) : (
          live.map((l) => {
            const s = sessions.get(l.sessionId);
            const busy = l.status === "busy";
            const title = s && s.title !== "Untitled session" ? s.title : (l.name ?? "New session");
            const open = () => l.file && navigate({ page: "session", file: l.file, turn: undefined, view: "map", step: undefined });
            return (
              <button
                key={l.sessionId}
                onClick={open}
                disabled={!l.file}
                className="group flex w-full items-center gap-3 rounded-2xl border border-foreground/10 bg-foreground/[0.02] p-4 text-left transition-colors enabled:hover:bg-foreground/[0.05] disabled:cursor-default"
              >
                <span className="relative flex size-2.5 shrink-0">
                  {busy && <span className="absolute inset-0 animate-ping rounded-full bg-sky-400 opacity-60" />}
                  <span className={cn("relative size-2.5 rounded-full", busy ? "bg-sky-400" : "bg-emerald-400")} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="min-w-0 truncate text-sm font-medium">{m(title)}</span>
                    <span className={cn("shrink-0 text-[0.6875rem] font-medium", busy ? "text-sky-600 dark:text-sky-400" : "text-emerald-600 dark:text-emerald-400")}>
                      {busy ? "Working" : l.status === "idle" ? "Waiting for you" : "Open"}
                    </span>
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.75rem] text-muted-foreground">
                    {l.cwd && (
                      <span className="flex min-w-0 items-center gap-1" title={m(l.cwd)}>
                        <Folder className="size-3 shrink-0" />
                        <span className="truncate">{m(shortPath(l.cwd))}</span>
                      </span>
                    )}
                    {appName(l.entrypoint) && (
                      <span className="flex items-center gap-1">
                        <MonitorSmartphone className="size-3" />
                        {appName(l.entrypoint)}
                      </span>
                    )}
                    {l.startedAt > 0 && <span>opened {ago(l.startedAt, now)}</span>}
                    {s && (
                      <span>
                        {s.requests} request{s.requests === 1 ? "" : "s"} · {formatTokens(s.tokens)} tokens
                        {modelName(s.model) ? ` · ${modelName(s.model)}` : ""}
                      </span>
                    )}
                    {!l.file && <span>no messages yet</span>}
                  </span>
                  {technical && (
                    <span className="mt-1.5 block font-mono text-[0.6875rem] break-all text-muted-foreground/80">
                      session {l.sessionId} · process {l.pid}
                      {l.version && ` · Claude Code ${l.version}`}
                      {l.entrypoint && ` · ${l.entrypoint}`}
                    </span>
                  )}
                </span>
                {l.file && <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
