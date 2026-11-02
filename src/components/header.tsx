"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bookmark, ChevronDown, CircleHelp, FileText, GitCompare, History, LayoutDashboard, Menu, Moon, Radio, Search, Settings, Sun, Workflow } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ProjectInfo, SessionInfo } from "@/lib/claude-logs";
import type { AppPage } from "@/lib/route";
import { maskSecrets } from "@/lib/redact";
import type { Live } from "@/lib/session";
import { homeOf, shortPath } from "@/lib/sessions-list";
import { updateSettings, useSettings } from "@/lib/settings";
import { useDarkMode } from "./settings-provider";
import { cn } from "@/lib/utils";
import { SessionBrowser } from "./session-browser";

export function Header(props: {
  projects: ProjectInfo[];
  project?: ProjectInfo;
  session?: SessionInfo;
  fileName?: string; // a dropped log file being viewed instead of a session
  onSession: (s: SessionInfo) => void;
  onRefresh: () => void;
  onHelp: () => void;
  onOpenPage: (page: AppPage) => void;
  onSettings: () => void;
  live: Live;
  connected: boolean;
}) {
  const { projects, project, session, live, connected } = props;
  const [{ maskSensitive }] = useSettings();
  const [open, setOpen] = useState(false);
  const m = (t: string) => (maskSensitive ? maskSecrets(t, homeOf(project?.path)) : t);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const toggle = () => {
    if (!open) props.onRefresh();
    setOpen(!open);
  };

  return (
    <>
      <motion.header
        initial={{ y: -24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", bounce: 0, duration: 0.5 }}
        className="glass fixed inset-x-3 top-3 z-30 flex h-[60px] items-center gap-1 rounded-2xl px-3 shadow-xl shadow-black/20"
      >
        <div className="mr-2 flex items-center gap-2 pl-1">
          <div className="flex size-7 items-center justify-center rounded-lg bg-foreground text-background">
            <Workflow className="size-4" />
          </div>
          <span className="hidden text-sm font-medium tracking-tight whitespace-nowrap lg:inline">cc-trace</span>
        </div>

        <div className="h-5 w-px bg-foreground/10" />

        <button
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="dialog"
          className={cn(
            "flex h-11 min-w-0 max-w-[380px] flex-1 items-center sm:flex-initial gap-2 rounded-xl px-2.5 text-left outline-none transition-colors hover:bg-foreground/[0.07] focus-visible:ring-2 focus-visible:ring-foreground/20 active:scale-[0.98]",
            open && "bg-foreground/[0.07]",
          )}
        >
          {props.fileName ? <FileText className="size-4 shrink-0 text-amber-500" /> : <History className="size-4 shrink-0 text-muted-foreground" />}
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm">
              {props.fileName ? m(props.fileName) : session ? m(session.title) : projects.length ? "Choose a session" : "No sessions yet"}
            </span>
            {!props.fileName && project && (
              <span className="hidden truncate text-[11px] text-muted-foreground sm:block">
                {m(shortPath(project.path))}
                {session?.live && " · live"}
              </span>
            )}
          </span>
          <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          {!props.fileName && <StatusPill live={live} connected={connected} active={!!session} />}
          <button
            onClick={props.onHelp}
            className="flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-sm text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground"
          >
            <CircleHelp className="size-4" />
            <span className="hidden md:inline">How it works</span>
          </button>
          <AppMenu onOpenPage={props.onOpenPage} onSettings={props.onSettings} />
          <ThemeToggle />
        </div>
      </motion.header>

      <AnimatePresence>
        {open && (
          <>
            <motion.div key="scrim" className="fixed inset-0 z-[45]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
            <motion.div
              key="browser"
              role="dialog"
              aria-label="Sessions"
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ type: "spring", bounce: 0, duration: 0.3 }}
              className="glass-strong fixed inset-x-3 top-[80px] bottom-3 z-[45] origin-top-left overflow-hidden rounded-2xl shadow-2xl shadow-black/40 sm:right-auto sm:bottom-auto sm:h-[min(640px,calc(100dvh-100px))] sm:w-[600px]"
            >
              <SessionBrowser
                projects={projects}
                current={session}
                onPick={(s) => {
                  setOpen(false);
                  props.onSession(s);
                }}
                onShowLive={() => {
                  setOpen(false);
                  props.onOpenPage("live");
                }}
                onClose={() => setOpen(false)}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

const PAGE_LINKS = [
  { page: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { page: "live", label: "Live now", icon: Radio },
  { page: "search", label: "Search", icon: Search },
  { page: "compare", label: "Compare", icon: GitCompare },
  { page: "bookmarks", label: "Bookmarks", icon: Bookmark },
] as const;

// shortcut: a plain menu so the app pages are reachable; the integration task gives them proper navigation.
function AppMenu({ onOpenPage, onSettings }: { onOpenPage: (page: AppPage) => void; onSettings: () => void }) {
  const item = "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px]";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground data-popup-open:bg-foreground/[0.07]"
        aria-label="More pages"
      >
        <Menu className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="glass-strong w-[200px] rounded-xl p-1.5 shadow-2xl shadow-black/40 ring-0" align="end" sideOffset={10}>
        {PAGE_LINKS.map(({ page, label, icon: Icon }) => (
          <DropdownMenuItem key={page} onClick={() => onOpenPage(page)} className={item}>
            <Icon className="size-4 text-muted-foreground" />
            {label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onClick={onSettings} className={item}>
          <Settings className="size-4 text-muted-foreground" />
          Settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StatusPill({ live, connected, active }: { live: Live; connected: boolean; active: boolean }) {
  const view = !active
    ? { label: "No session", dot: "bg-foreground/30", glow: "" }
    : !connected
      ? { label: "Reconnecting…", dot: "bg-amber-400", glow: "" }
      : live.active
        ? { label: live.thinking ? "Claude is thinking…" : live.helpersWorking ? `Working · ${live.helpersWorking} helper${live.helpersWorking === 1 ? "" : "s"}` : "Claude is working…", dot: "bg-sky-400", glow: "shadow-[0_0_18px_-2px] shadow-sky-400/50" }
        : { label: "Waiting for you", dot: "bg-emerald-400/80", glow: "" };
  const pulsing = active && connected && live.active;

  return (
    <motion.div
      layout
      transition={{ type: "spring", bounce: 0, duration: 0.4 }}
      className={cn(
        "flex items-center gap-2 overflow-hidden rounded-full border border-foreground/10 px-2.5 py-1.5 sm:px-3 text-xs font-medium transition-shadow duration-500",
        view.glow,
      )}
      role="status"
      title={view.label}
    >
      <span className="relative flex size-2">
        {pulsing && <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60", view.dot)} />}
        <span className={cn("relative size-2 rounded-full", view.dot)} />
      </span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={view.label}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ type: "spring", bounce: 0, duration: 0.3 }}
          className="hidden max-w-[180px] truncate whitespace-nowrap sm:inline"
        >
          {view.label}
        </motion.span>
      </AnimatePresence>
    </motion.div>
  );
}

function ThemeToggle() {
  const dark = useDarkMode();
  const toggle = () => updateSettings({ theme: dark ? "light" : "dark" });

  return (
    <button
      onClick={toggle}
      className="flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground active:scale-90"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
