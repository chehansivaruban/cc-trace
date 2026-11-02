"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy, Folder, GitBranch, MonitorSmartphone, ShieldAlert, ShieldCheck } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { LiveSession } from "@/lib/claude-logs";
import { useMask } from "@/hooks/use-mask";
import type { SessionModel } from "@/lib/session";
import { appName, cwdIsSafe, encodeProjectDir, permissionLabel, projectOfFile, resumeCommand, shortPath } from "@/lib/sessions-list";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

const idOf = (file: string) => (file.split(/[\\/]/).pop() ?? file).replace(/\.jsonl$/, "");

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API blocked (permissions, not a secure context): the old way still works in many browsers.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.appendChild(area);
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}

/** "Copy" menu: the command to reopen a session, to fork it, and its id. Copies the real values even when masking. */
export function CopyActions({ id, cwd, className, label = true }: { id: string; cwd?: string; className?: string; label?: boolean }) {
  const [done, setDone] = useState<string | null>(null); // the copied item's key, or "failed"
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(null), 1500);
    return () => clearTimeout(t);
  }, [done]);
  // A folder that can't be quoted safely leaves just the claude command: say where to run it.
  const where = cwdIsSafe(cwd) ? "" : " (open a terminal in the project folder first)";
  const resume = resumeCommand(cwd, id);
  const fork = resumeCommand(cwd, id, true);
  const items = [
    resume && { key: "resume", label: "Copy resume command", hint: `Open this session again in Claude Code${where}`, text: resume },
    fork && { key: "fork", label: "Copy fork command", hint: `Start a new session from a copy of this one${where}`, text: fork },
    { key: "id", label: "Copy session id", hint: id, text: id },
  ].filter((it): it is { key: string; label: string; hint: string; text: string } => !!it);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[12px] text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.07] hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/20 data-popup-open:bg-foreground/[0.07]",
          className,
        )}
        aria-label="Copy commands for this session"
      >
        {done && done !== "failed" ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
        {label && <span>{done === "failed" ? "Couldn't copy" : done ? "Copied" : "Copy"}</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="glass-strong w-[280px] rounded-xl p-1.5 shadow-2xl shadow-black/40 ring-0" align="end" sideOffset={6}>
        {items.map((it) => (
          <DropdownMenuItem
            key={it.key}
            onClick={(e) => {
              e.stopPropagation();
              void copy(it.text).then((ok) => setDone(ok ? it.key : "failed"));
            }}
            className="flex-col items-start gap-0.5 rounded-lg px-2.5 py-2"
          >
            <span className="text-[13px] font-medium">{it.label}</span>
            <span className="w-full text-[11px] leading-snug break-words text-muted-foreground">{it.hint}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Polls Claude Code's running-session registry. */
export function useLiveSessions(intervalMs = 15_000) {
  const [live, setLive] = useState<LiveSession[] | null>(null);
  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch("/api/live")
        .then((r) => (r.ok ? (r.json() as Promise<LiveSession[]>) : null))
        .then((l) => !stop && l && setLive(l))
        .catch(() => {});
    void load();
    const t = setInterval(load, intervalMs);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [intervalMs]);
  return live;
}

function Chip({ icon: Icon, children, title, className }: { icon?: typeof Folder; children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={cn("flex shrink-0 items-center gap-1.5 whitespace-nowrap", className)}>
      {Icon && <Icon className="size-3.5 shrink-0 opacity-70" />}
      {children}
    </span>
  );
}

/** One line under the tabs: is it running, how freely Claude may act, branch, folder(s) and app, plus copy actions. */
export function SessionInfoBar({ model, file }: { model: SessionModel; file: string }) {
  const [{ showTechnical }] = useSettings();
  const live = useLiveSessions();
  const id = idOf(file);
  const { meta } = model;
  const running = live ? live.some((l) => l.sessionId === id) : undefined; // undefined until the registry is read
  const m = useMask(model);
  const mode = meta.permissionMode ? permissionLabel(meta.permissionMode) : undefined;
  const app = appName(meta.entrypoint);
  // `claude --resume` looks in the folder Claude Code filed the session under.
  const resumeCwd = meta.cwds.find((c) => encodeProjectDir(c) === projectOfFile(file)) ?? meta.cwds[0];

  const chips = [
    running === true && (
      <Chip key="live" title="Claude Code has this session open right now" className="font-medium text-emerald-600 dark:text-emerald-400">
        <span className="relative flex size-2">
          <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative size-2 rounded-full bg-emerald-400" />
        </span>
        Live
      </Chip>
    ),
    running === false && (
      <Chip key="closed" title="Claude Code isn't running this session now">
        <span className="size-2 rounded-full bg-foreground/25" />
        Closed
      </Chip>
    ),
    mode && (
      <Chip key="mode" icon={mode.risky ? ShieldAlert : ShieldCheck} title={mode.text} className={cn(mode.risky && "font-medium text-amber-600 dark:text-amber-400")}>
        {mode.label}
      </Chip>
    ),
    meta.gitBranch && meta.gitBranch !== "HEAD" && (
      <Chip key="branch" icon={GitBranch} title={`Git branch: ${m(meta.gitBranch)}`}>
        <span className="max-w-[180px] truncate">{m(meta.gitBranch)}</span>
      </Chip>
    ),
    resumeCwd && (
      <Chip key="cwd" icon={Folder} title={meta.cwds.map(m).join("\n")}>
        <span className="max-w-[220px] truncate">{m(shortPath(resumeCwd))}</span>
        {meta.cwds.length > 1 && <span className="text-foreground/40">+{meta.cwds.length - 1} more</span>}
      </Chip>
    ),
    (app || meta.version) && (
      <Chip key="app" icon={MonitorSmartphone} title={[app && `Started from ${app}`, meta.version && `Claude Code ${meta.version}`].filter(Boolean).join(" · ")}>
        {app ?? "Claude Code"}
        {showTechnical && meta.version && <span className="text-foreground/40">v{meta.version}</span>}
      </Chip>
    ),
  ].filter(Boolean);

  return (
    <div className="flex h-9 shrink-0 items-center gap-2.5 overflow-x-auto border-b border-foreground/10 px-4 text-[12px] text-muted-foreground [scrollbar-width:none]">
      {chips.flatMap((c, i) => (i ? [<span key={`sep${i}`} className="shrink-0 text-foreground/20">·</span>, c] : [c]))}
      <CopyActions id={id} cwd={resumeCwd} className="ml-auto" />
    </div>
  );
}
