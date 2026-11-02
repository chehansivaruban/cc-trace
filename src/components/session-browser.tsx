"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { BookmarkCheck, FileUp, GitBranch, Radio, Search, X } from "lucide-react";
import type { ProjectInfo, SessionInfo } from "@/lib/claude-logs";
import { useMask } from "@/hooks/use-mask";
import { useBookmarks } from "@/lib/bookmarks";
import {
  ago,
  filterSessions,
  formatDuration,
  formatTokens,
  groupByDate,
  isWindowsPath,
  modelName,
  projectOfFile,
  shortPath,
  sortSessions,
  type SessionSort,
} from "@/lib/sessions-list";
import { cn } from "@/lib/utils";
import { openLogFile } from "./drop-file";
import { CopyActions } from "./session-info-bar";
import { TermText } from "./term-text";

type Row = { kind: "group"; label: string; count: number } | { kind: "session"; s: SessionInfo; project: ProjectInfo };

// One spelling per folder, so a worktree's "main project" matches the project list on any OS.
const folderKey = (p: string) => {
  const t = p.replace(/[\\/]+$/, "");
  return isWindowsPath(t) ? t.replace(/\//g, "\\").toLowerCase() : t;
};

/** Main projects, each followed by the worktree projects that belong to it. */
function projectTree(projects: ProjectInfo[]) {
  const byPath = new Map(projects.map((p) => [folderKey(p.path), p]));
  const parentOf = (p: ProjectInfo) => {
    const main = p.worktreeOf ? byPath.get(folderKey(p.worktreeOf)) : undefined;
    return main && main !== p ? main : undefined;
  };
  const children = new Map<string, ProjectInfo[]>();
  for (const p of projects) {
    const main = parentOf(p);
    if (main) children.set(main.dir, [...(children.get(main.dir) ?? []), p]);
  }
  return projects.filter((p) => !parentOf(p)).map((p) => ({ project: p, worktrees: children.get(p.dir) ?? [] }));
}

export function SessionBrowser(props: {
  projects: ProjectInfo[];
  onPick: (s: SessionInfo) => void;
  current?: SessionInfo;
  onShowLive?: () => void;
  onClose?: () => void;
}) {
  const { projects, current } = props;
  const [q, setQ] = useState("");
  const [project, setProject] = useState(""); // a project dir, "" for all
  const [liveOnly, setLiveOnly] = useState(false);
  const [saved, setSaved] = useState(""); // "" all, "*" bookmarked, else a tag
  const marks = useBookmarks();
  const [sort, setSort] = useState<SessionSort>("recent");
  const [active, setActive] = useState(-1); // keyboard-highlighted row
  const [now] = useState(() => Date.now());
  const scroller = useRef<HTMLDivElement>(null);

  const m = useMask();
  const tree = useMemo(() => projectTree(projects), [projects]);

  const { rows, totals } = useMemo(() => {
    const byDir = new Map(projects.map((p) => [p.dir, p]));
    // Names you gave sessions replace their titles, so search finds them too.
    const bookmarked = new Set(marks.data.items.map((b) => b.file));
    const all = projects
      .flatMap((p) => p.sessions)
      .filter((s) => !saved || (saved === "*" ? bookmarked.has(s.file) : marks.tags(s.file).includes(saved)))
      .map((s) => (marks.data.names[s.file] ? { ...s, title: marks.data.names[s.file] } : s));
    const node = tree.find((n) => n.project.dir === project);
    const dirs = !project ? undefined : node ? [node.project.dir, ...node.worktrees.map((w) => w.dir)] : [project];
    const list = sortSessions(filterSessions(all, { q, projects: dirs, liveOnly }), sort);
    const rows: Row[] = [];
    for (const g of groupByDate(list, now, sort)) {
      rows.push({ kind: "group", label: g.label, count: g.sessions.length });
      for (const s of g.sessions) rows.push({ kind: "session", s, project: byDir.get(projectOfFile(s.file))! });
    }
    return {
      rows,
      totals: { sessions: list.length, tokens: list.reduce((n, s) => n + s.tokens, 0), live: list.filter((s) => s.live).length, counting: list.some((s) => s.counting) },
    };
  }, [projects, tree, project, q, liveOnly, sort, now, saved, marks]);
  const allTags = useMemo(() => [...new Set(Object.values(marks.data.tags).flat())].sort(), [marks.data.tags]);

  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => (rows[i].kind === "group" ? 34 : 70),
    overscan: 10,
  });

  const move = (dir: 1 | -1) => {
    let i = active;
    do i += dir;
    while (i >= 0 && i < rows.length && rows[i].kind !== "session");
    if (i < 0 || i >= rows.length) return;
    setActive(i);
    virtual.scrollToIndex(i, { align: "auto" });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      move(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter") {
      const r = rows[active] ?? rows.find((r) => r.kind === "session");
      if (r?.kind === "session") props.onPick(r.s);
    }
  };

  const select = "h-8 min-w-0 rounded-lg border border-foreground/10 bg-transparent px-2 text-[0.75rem] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-foreground/20";

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={onKey}>
      <div className="shrink-0 space-y-2.5 border-b border-foreground/10 p-3">
        <p className="px-1 text-[0.75rem] leading-snug text-muted-foreground">
          <TermText text="Every [[session:session]] Claude Code saved on this computer. Pick one to see what happened in it." />
        </p>
        <div className="flex h-9 items-center gap-2 rounded-xl bg-foreground/[0.05] px-3 focus-within:ring-2 focus-within:ring-foreground/15">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(-1);
            }}
            placeholder="Search titles, first messages, ids, models…"
            aria-label="Search sessions"
            className="min-w-0 flex-1 bg-transparent text-[0.8125rem] outline-none placeholder:text-muted-foreground/70"
          />
          {q && (
            <button onClick={() => setQ("")} className="rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="Clear search">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={project} onChange={(e) => setProject(e.target.value)} className={cn(select, "w-full sm:w-auto sm:max-w-[15rem] sm:flex-1")} aria-label="Project">
            <option value="">All projects ({projects.length})</option>
            {tree.map(({ project: p, worktrees }) => [
              <option key={p.dir} value={p.dir}>
                {m(shortPath(p.path))} ({p.sessions.length + worktrees.reduce((n, w) => n + w.sessions.length, 0)})
              </option>,
              ...worktrees.map((w) => (
                <option key={w.dir} value={w.dir}>
                  {"   ↳ "}
                  {m(shortPath(w.path))} (worktree, {w.sessions.length})
                </option>
              )),
            ])}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SessionSort)} className={select} aria-label="Sort by">
            <option value="recent">Latest activity</option>
            <option value="started">When it started</option>
          </select>
          <button
            onClick={() => setLiveOnly((v) => !v)}
            aria-pressed={liveOnly}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[0.75rem] transition-colors",
              liveOnly ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-foreground/10 text-muted-foreground hover:text-foreground",
            )}
          >
            <span className={cn("size-1.5 rounded-full", liveOnly ? "bg-emerald-500" : "bg-foreground/30")} />
            Running now
          </button>
          {(marks.data.items.length > 0 || allTags.length > 0) && (
            <select value={saved} onChange={(e) => setSaved(e.target.value)} className={cn(select, saved && "border-amber-500/40 text-amber-700 dark:text-amber-300")} aria-label="Show bookmarked or tagged sessions">
              <option value="">Any session</option>
              <option value="*">Bookmarked</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  Tagged “{m(t)}”
                </option>
              ))}
            </select>
          )}
        </div>
        <p className="px-1 text-[0.6875rem] text-muted-foreground" aria-live="polite">
          {totals.sessions} session{totals.sessions === 1 ? "" : "s"} · {formatTokens(totals.tokens)} tokens{totals.counting ? " so far" : ""}
          {totals.live > 0 && ` · ${totals.live} running now`}
        </p>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 py-1" role="listbox" aria-label="Sessions">
        {!rows.length ? (
          <p className="px-4 py-10 text-center text-[0.8125rem] text-muted-foreground">
            {projects.length ? "No sessions match. Try fewer words or another project." : "No Claude Code sessions found on this computer yet."}
          </p>
        ) : (
          <div className="relative w-full" style={{ height: virtual.getTotalSize() }}>
            {virtual.getVirtualItems().map((v) => {
              const r = rows[v.index];
              return (
                <div key={v.key} data-index={v.index} ref={virtual.measureElement} className="absolute inset-x-0" style={{ transform: `translateY(${v.start}px)` }}>
                  {r.kind === "group" ? (
                    <div className="px-2.5 pt-3 pb-1.5 text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">
                      {r.label} <span className="font-normal normal-case opacity-70">· {r.count}</span>
                    </div>
                  ) : (
                    <SessionRow
                      s={r.s}
                      project={r.project}
                      sort={sort}
                      now={now}
                      mask={m}
                      current={r.s.file === current?.file}
                      bookmarked={marks.data.items.some((b) => b.file === r.s.file)}
                      active={v.index === active}
                      onPick={() => props.onPick(r.s)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 border-t border-foreground/10 p-1.5 text-[0.75rem]">
        <button
          onClick={openLogFile}
          className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground"
          title="Read a .jsonl log from your computer, for example one someone sent you. Nothing is uploaded or saved."
        >
          <FileUp className="size-3.5" />
          Open a log file…
        </button>
        {props.onShowLive && (
          <button
            onClick={props.onShowLive}
            className="ml-auto flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground"
          >
            <Radio className="size-3.5" />
            Live now
          </button>
        )}
      </div>
    </div>
  );
}

function SessionRow(props: {
  s: SessionInfo;
  project?: ProjectInfo;
  sort: SessionSort;
  now: number;
  mask: (t: string) => string;
  current: boolean;
  active: boolean;
  bookmarked?: boolean;
  onPick: () => void;
}) {
  const { s, mask: m } = props;
  const facts = [
    props.project && m(shortPath(props.project.path)),
    modelName(s.model),
    `${s.requests} request${s.requests === 1 ? "" : "s"}`,
    `${formatTokens(s.tokens)} tokens`,
    s.durationMs >= 60_000 && formatDuration(s.durationMs),
    s.helpers > 0 && `${s.helpers} helper${s.helpers === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return (
    <div
      role="option"
      aria-selected={props.current}
      tabIndex={-1}
      onClick={props.onPick}
      className={cn(
        "group flex cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2 transition-colors hover:bg-foreground/[0.06]",
        props.current && "bg-foreground/[0.06]",
        props.active && "ring-2 ring-foreground/20 ring-inset",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {s.live && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-px text-[0.625rem] font-semibold text-emerald-700 uppercase dark:text-emerald-300">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Live
            </span>
          )}
          {props.bookmarked && <BookmarkCheck className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-label="Bookmarked" />}
          <span className="line-clamp-1 text-[0.8125rem] font-medium">{m(s.title)}</span>
        </div>
        <div className="mt-0.5 line-clamp-2 text-[0.6875rem] leading-snug text-muted-foreground">
          {facts.join(" · ")}
          {s.gitBranch && s.gitBranch !== "HEAD" && (
            <span className="whitespace-nowrap">
              {" · "}
              <GitBranch className="inline size-3 align-[-2px]" /> {m(s.gitBranch)}
            </span>
          )}
          {s.worktreeOf && <span className="whitespace-nowrap"> · worktree</span>}
        </div>
        <div className="mt-0.5 text-[0.6875rem] text-muted-foreground/70">
          {props.sort === "started" ? `started ${ago(s.started, props.now)}` : `active ${ago(s.mtime, props.now)}`}
        </div>
      </div>
      <CopyActions id={s.id} cwd={s.cwd} label={false} className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100" />
    </div>
  );
}
