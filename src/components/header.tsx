"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bookmark, ChevronDown, CircleHelp, Folder, GitCompare, History, LayoutDashboard, Menu, Moon, Radio, Search, Settings, Sun, Workflow } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ProjectInfo, SessionInfo } from "@/lib/claude-logs";
import type { AppPage } from "@/lib/route";
import type { Live } from "@/lib/session";
import { cn } from "@/lib/utils";

const trigger =
  "flex h-9 min-w-0 max-w-[240px] items-center gap-2 rounded-xl px-3 text-sm outline-none transition-colors hover:bg-foreground/[0.07] active:scale-[0.98] data-popup-open:bg-foreground/[0.07]";
const menu = "glass-strong w-[380px] max-h-[60vh] rounded-xl p-1.5 shadow-2xl shadow-black/40 ring-0";

function ago(ms: number) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function kb(bytes: number) {
  return bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

function shortPath(p: string) {
  // Windows cwds use backslashes ("C:\Users\me\app").
  return p.split(/[\\/]/).filter(Boolean).slice(-2).join("/") || p;
}

export function Header(props: {
  projects: ProjectInfo[];
  project?: ProjectInfo;
  session?: SessionInfo;
  onProject: (p: ProjectInfo) => void;
  onSession: (s: SessionInfo) => void;
  onRefresh: () => void;
  onHelp: () => void;
  onOpenPage: (page: AppPage) => void;
  onSettings: () => void;
  live: Live;
  connected: boolean;
}) {
  const { projects, project, session, live, connected } = props;

  return (
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

      <DropdownMenu onOpenChange={(open) => open && props.onRefresh()}>
        <DropdownMenuTrigger className={trigger}>
          <Folder className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{project ? shortPath(project.path) : "Select project"}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className={menu} align="start" sideOffset={10}>
          {projects.map((p) => (
            <DropdownMenuItem
              key={p.dir}
              onClick={() => props.onProject(p)}
              className={cn("flex-col items-start gap-0.5 rounded-lg px-2.5 py-2", p.dir === project?.dir && "bg-foreground/[0.06]")}
            >
              <span className="w-full truncate text-[13px] font-medium">{shortPath(p.path)}</span>
              <span className="w-full truncate text-[11px] text-muted-foreground">
                {p.path} · {p.sessions.length} sessions · {ago(p.mtime)}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu onOpenChange={(open) => open && props.onRefresh()}>
        <DropdownMenuTrigger className={trigger} disabled={!project}>
          <History className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{session ? session.title : "Select session"}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className={menu} align="start" sideOffset={10}>
          {project?.sessions.map((s) => (
            <DropdownMenuItem
              key={s.id}
              onClick={() => props.onSession(s)}
              className={cn("flex-col items-start gap-0.5 rounded-lg px-2.5 py-2", s.id === session?.id && "bg-foreground/[0.06]")}
            >
              <span className="line-clamp-1 w-full text-[13px] font-medium">{s.title}</span>
              <span className="text-[11px] text-muted-foreground">
                {ago(s.mtime)} · {kb(s.size)}
                {s.helpers ? ` · ${s.helpers} helper${s.helpers === 1 ? "" : "s"}` : ""}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <StatusPill live={live} connected={connected} active={!!session} />
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
        "flex items-center gap-2 overflow-hidden rounded-full border border-foreground/10 px-3 py-1.5 text-xs font-medium transition-shadow duration-500",
        view.glow,
      )}
      role="status"
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
          className="max-w-[180px] truncate whitespace-nowrap"
        >
          {view.label}
        </motion.span>
      </AnimatePresence>
    </motion.div>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(true);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // storage blocked: theme just won't persist
    }
  };

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
