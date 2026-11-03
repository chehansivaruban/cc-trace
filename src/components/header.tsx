"use client";

import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bookmark, ChevronDown, CircleHelp, Ellipsis, FileText, GitCompare, History, LayoutDashboard, Moon, Radio, Search, Settings, Sun, Waypoints, Workflow } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ProjectInfo, SessionInfo } from "@/lib/claude-logs";
import type { AppPage } from "@/lib/route";
import { useEscape } from "@/hooks/use-escape";
import { useMask } from "@/hooks/use-mask";
import type { Live } from "@/lib/session";
import { shortPath } from "@/lib/sessions-list";
import { updateSettings } from "@/lib/settings";
import { EASE_OUT, appear } from "@/lib/motion";
import { useDarkMode, useReducedMotion } from "./settings-provider";
import { cn } from "@/lib/utils";
import { SessionBrowser } from "./session-browser";

/**
 * The bar at the top: the session picker, what Claude is doing, and the app's pages. <main> is a size
 * container, so the bar adapts to the room it has in rem: at a larger text size it collapses sooner. When it is
 * narrower than 44rem the pages move to a second row of icons.
 */
export function Header(props: {
  /** null until /api/sessions answers. */
  projects: ProjectInfo[] | null;
  project?: ProjectInfo;
  session?: SessionInfo;
  /** The name to show for the session: a name you gave it, else its title. */
  title?: string;
  fileName?: string; // a dropped log file being viewed instead of a session
  page: AppPage;
  onSession: (s: SessionInfo) => void;
  onRefresh: () => void;
  onHelp: () => void;
  onOpenPage: (page: AppPage) => void;
  onSettings: () => void;
  live: Live;
  connected: boolean;
  /** "Claude needs you", next to the status. */
  badge?: ReactNode;
}) {
  const { project, session, live, connected } = props;
  const projects = props.projects ?? [];
  const listing = props.projects === null;
  const [open, setOpen] = useState(false);
  const m = useMask();
  const reduce = useReducedMotion();

  useEscape(open, () => setOpen(false));

  const toggle = () => {
    if (!open) props.onRefresh();
    setOpen(!open);
  };
  const nav = <PageNav page={props.page} onOpenPage={props.onOpenPage} />;

  return (
    <>
      <motion.header
        {...appear(reduce, { y: -8 }, { duration: 0.25, ease: EASE_OUT })}
        className="glass fixed inset-x-3 top-3 z-30 rounded-2xl shadow-xl shadow-black/20"
      >
        <div className="flex h-[3.75rem] items-center gap-1 px-2 @min-[30rem]:px-3">
          <button
            onClick={() => props.onOpenPage("session")}
            className="mr-1 flex shrink-0 items-center gap-2 rounded-lg pl-1 transition-transform duration-150 ease-out active:scale-[0.97] @min-[30rem]:mr-2"
            aria-label="cc-trace: back to the session"
            title="Back to the session"
          >
            <span className="flex size-7 items-center justify-center rounded-lg bg-foreground text-background">
              <Workflow className="size-4" />
            </span>
            <span className="hidden text-sm font-medium tracking-tight whitespace-nowrap @min-[100rem]:inline">cc-trace</span>
          </button>

          <div className="hidden h-5 w-px shrink-0 bg-foreground/10 @min-[30rem]:block" />

          <div data-tour="pickers" className="flex min-w-0 flex-1 @min-[44rem]:max-w-[23.75rem]">
            <button
              onClick={toggle}
              aria-expanded={open}
              aria-haspopup="dialog"
              className={cn(
                "flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl px-2 text-left outline-none transition-[background-color,transform] duration-150 ease-out hover:bg-foreground/[0.07] focus-visible:ring-2 focus-visible:ring-foreground/20 active:scale-[0.97] @min-[30rem]:px-2.5",
                open && "bg-foreground/[0.07]",
              )}
            >
              {props.fileName ? <FileText className="size-4 shrink-0 text-amber-500" /> : <History className="size-4 shrink-0 text-muted-foreground" />}
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-sm">
                  {props.fileName ? m(props.fileName) : session ? m(props.title ?? session.title) : listing ? "Loading…" : projects.length ? "Choose a session" : "No sessions yet"}
                </span>
                {!props.fileName && project && (
                  <span className="hidden truncate text-[0.6875rem] text-muted-foreground @min-[36rem]:block">
                    {m(shortPath(project.path))}
                    {session?.live && " · live"}
                  </span>
                )}
              </span>
              <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground", open && "rotate-180")} />
            </button>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1 @min-[44rem]:gap-1.5">
            {props.badge}
            {!props.fileName && <StatusPill live={live} connected={connected} active={!!session} />}
            <div className="hidden items-center gap-0.5 @min-[44rem]:flex">
              {nav}
              <IconButton onClick={props.onSettings} label="Settings">
                <Settings className="size-4 shrink-0" />
              </IconButton>
              <IconButton onClick={props.onHelp} label="How Claude Code works" className="@min-[110rem]:w-auto @min-[110rem]:px-2.5">
                <CircleHelp className="size-4 shrink-0" />
                <span className="hidden text-sm @min-[110rem]:inline">How it works</span>
              </IconButton>
              <ThemeToggle />
            </div>
          </div>
        </div>
        {/* Narrow: the pages get their own row of icons, so the picker keeps its room, and Settings, help and
            the theme go in "More". Seven 44 px touch targets fit a 320 px phone at any text size. */}
        <div className="flex h-11 items-center gap-0.5 border-t border-foreground/10 px-1.5 @min-[44rem]:hidden">
          {nav}
          <MoreMenu onSettings={props.onSettings} onHelp={props.onHelp} />
        </div>
      </motion.header>

      <AnimatePresence>
        {open && (
          <>
            <motion.div key="scrim" className="fixed inset-0 z-[45]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} onClick={() => setOpen(false)} />
            <motion.div
              key="browser"
              role="dialog"
              aria-label="Sessions"
              {...appear(reduce, { y: -4, scale: 0.98 })}
              // Pinned under the header (one row or two) and to the bottom edge, so it never runs off screen;
              // on wider screens it is a 37.5rem-wide popup at most 40rem tall.
              className="glass-strong fixed inset-x-3 top-[7.75rem] bottom-3 z-[45] origin-top-left overflow-hidden rounded-2xl shadow-2xl shadow-black/40 @min-[44rem]:top-[5rem] sm:right-auto sm:max-h-[40rem] sm:w-[min(37.5rem,calc(100vw-1.5rem))]"
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
  { page: "session", label: "Session", icon: Waypoints },
  { page: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { page: "live", label: "Live now", icon: Radio },
  { page: "search", label: "Search", icon: Search },
  { page: "compare", label: "Compare", icon: GitCompare },
  { page: "bookmarks", label: "Bookmarks", icon: Bookmark },
] as const;

function IconButton(props: { onClick: () => void; label: string; current?: boolean; className?: string; children: ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      aria-label={props.label}
      aria-current={props.current ? "page" : undefined}
      title={props.label}
      className={cn(
        "flex h-9 min-w-0 shrink items-center justify-center gap-1.5 rounded-xl px-0 text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out hover:bg-foreground/[0.07] hover:text-foreground active:scale-[0.97] w-9",
        props.current && "bg-foreground/[0.08] text-foreground",
        props.className,
      )}
    >
      {props.children}
    </button>
  );
}

/** The app's pages as icon buttons; with room to spare (wide screen, smaller text) each gets its label. */
function PageNav({ page, onOpenPage }: { page: AppPage; onOpenPage: (page: AppPage) => void }) {
  return (
    <nav aria-label="Pages" className="contents">
      {PAGE_LINKS.map(({ page: p, label, icon: Icon }) => (
        <IconButton key={p} onClick={() => onOpenPage(p)} label={label} current={page === p} className="flex-1 min-w-[44px] @min-[44rem]:min-w-0 @min-[44rem]:flex-none @min-[86rem]:w-auto @min-[86rem]:px-2.5">
          <Icon className="size-4 shrink-0" />
          <span className="hidden text-[0.8125rem] whitespace-nowrap @min-[86rem]:inline">{label}</span>
        </IconButton>
      ))}
    </nav>
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
    <div
      className={cn(
        "flex h-9 shrink-0 items-center gap-2 overflow-hidden rounded-full px-2.5 text-xs font-medium transition-shadow duration-500 @min-[64rem]:h-auto @min-[64rem]:border @min-[64rem]:border-foreground/10 @min-[64rem]:px-3 @min-[64rem]:py-1.5",
        view.glow,
      )}
      role="status"
      title={view.label}
      aria-label={view.label}
    >
      <span className="relative flex size-2">
        {pulsing && <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60", view.dot)} />}
        <span className={cn("relative size-2 rounded-full", view.dot)} />
      </span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={view.label}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="hidden max-w-[11.25rem] truncate whitespace-nowrap @min-[64rem]:inline"
        >
          {view.label}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

/** Narrow header only: Settings, the guide and the theme, behind one 44 px button. */
function MoreMenu({ onSettings, onHelp }: { onSettings: () => void; onHelp: () => void }) {
  const dark = useDarkMode();
  const item = "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[0.8125rem]";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="More: settings, help and theme"
        className="flex h-9 min-w-[44px] flex-1 items-center justify-center rounded-xl text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out hover:bg-foreground/[0.07] hover:text-foreground active:scale-[0.97] data-popup-open:bg-foreground/[0.07]"
      >
        <Ellipsis className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="glass-strong w-[13.75rem] rounded-xl p-1.5 shadow-2xl shadow-black/40 ring-0" align="end" sideOffset={8}>
        <DropdownMenuItem onClick={onSettings} className={item}>
          <Settings className="size-4 text-muted-foreground" /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onHelp} className={item}>
          <CircleHelp className="size-4 text-muted-foreground" /> How Claude Code works
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => updateSettings({ theme: dark ? "light" : "dark" })} className={item}>
          {dark ? <Sun className="size-4 text-muted-foreground" /> : <Moon className="size-4 text-muted-foreground" />}
          {dark ? "Light mode" : "Dark mode"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeToggle() {
  const dark = useDarkMode();
  const toggle = () => updateSettings({ theme: dark ? "light" : "dark" });

  return (
    <IconButton onClick={toggle} label={dark ? "Switch to light mode" : "Switch to dark mode"}>
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </IconButton>
  );
}
