"use client";

import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { AttentionBadge, AttentionWatcher } from "@/components/attention";
import { DetailsPanel } from "@/components/details-panel";
import { DropFile, DroppedBanner } from "@/components/drop-file";
import { ExportMenu } from "@/components/export-menu";
import { FilterBar } from "@/components/filter-bar";
import { Header } from "@/components/header";
import { HelpDialog } from "@/components/help-dialog";
import { SessionInfoBar } from "@/components/session-info-bar";
import { SessionTabs } from "@/components/session-tabs";
import { Welcome } from "@/components/welcome";
import type { Selection } from "@/components/story-map";
import { TurnList } from "@/components/turn-list";
import { BookmarksPage } from "@/components/pages/bookmarks-page";
import { ComparePage } from "@/components/pages/compare-page";
import { DashboardPage } from "@/components/pages/dashboard-page";
import { LivePage } from "@/components/pages/live-page";
import { SearchPage } from "@/components/pages/search-page";
import { SettingsDialog } from "@/components/pages/settings-dialog";
import { SESSION_VIEWS, type SessionViewProps } from "@/components/views/registry";
import { useEscape } from "@/hooks/use-escape";
import { useFolders } from "@/hooks/use-folders";
import { MaskScope, sessionMasker } from "@/hooks/use-mask";
import { useSessionShortcuts } from "@/hooks/use-session-shortcuts";
import { useSessionStream } from "@/hooks/use-session-stream";
import type { ProjectInfo, SessionInfo } from "@/lib/claude-logs";
import { emptyFilter, isFilterEmpty, type StepFilter } from "@/lib/analytics/filters";
import { useBookmarks } from "@/lib/bookmarks";
import { slide } from "@/lib/motion";
import { useReducedMotion } from "@/components/settings-provider";
import { parseRoute, useRoute, type AppPage, type AppPageProps, type Navigate, type Route, type SessionView } from "@/lib/route";
import { SESSION_START, buildSession, type AgentLog, type LogRecord } from "@/lib/session";
import { DROPPED_PREFIX } from "@/lib/paths";
import { safeClip } from "@/lib/redact";
import { sameSessionFile, siblingSession } from "@/lib/sessions-list";

// Views that read one request step by step, and so share the step filter.
const FILTERED_VIEWS: SessionView[] = ["map", "conversation"];

const APP_PAGES: Record<Exclude<AppPage, "session">, ComponentType<AppPageProps>> = {
  dashboard: DashboardPage,
  live: LivePage,
  search: SearchPage,
  compare: ComparePage,
  bookmarks: BookmarksPage,
};

// Sessions are listed as "<projectDir>/<id>.jsonl" (a backslash on Windows).
const projectOf = (file: string) => file.split(/[\\/]/)[0];

export default function Home() {
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null);
  // Page, session, request (absent: follow the newest), view and selected step all live in the URL.
  const [route, navigate] = useRoute();
  // The session to come back to from an app page (dashboard, search, ...).
  const [lastSession, setLastSession] = useState<Route | null>(null);
  const [actorPick, setActorPick] = useState<Selection>(null); // a selected agent isn't worth a URL
  const [help, setHelp] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // A log opened from disk (drag and drop): read in the browser only, shown instead of the URL's session.
  const [dropped, setDropped] = useState<{ name: string; records: LogRecord[]; agents: Record<string, AgentLog> } | null>(null);
  const [recheckedFile, setRecheckedFile] = useState<string | null>(null);
  // The step filter is shared by the Map and the Conversation, and kept while you switch between them.
  const [filter, setFilter] = useState<StepFilter>(emptyFilter);
  const [filterOpen, setFilterOpen] = useState(false);
  const marks = useBookmarks();
  const home = useFolders()?.home;
  const reduce = useReducedMotion();

  const refresh = useCallback(async () => {
    const res = await fetch("/api/sessions");
    const list: ProjectInfo[] = await res.json();
    setProjects(list);
  }, []);

  // The server answers within 1.5 s and keeps counting big logs in the background: ask again until it's done.
  const stillCounting = !!projects?.some((p) => p.sessions.some((s) => s.counting));
  useEffect(() => {
    if (!stillCounting) return;
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [stillCounting, refresh]);

  useEffect(() => {
    if (route.page === "session") setLastSession(route);
  }, [route]);

  const sessionRoute = route.page === "session" ? route : lastSession;
  const file = sessionRoute?.file ?? null;
  const projectDir = sessionRoute?.project ?? (file ? projectOf(file) : undefined);
  const view: SessionView = sessionRoute?.view ?? "map";

  // No session in the URL yet: open the newest one (of the chosen project, if any), as the first load always did.
  // Not while a dropped file is shown: changing `file` would close it.
  const fallbackFile = route.page === "session" && !route.file && projects && !dropped
    ? (projects.find((p) => p.dir === route.project) ?? projects[0])?.sessions[0]?.file // an unknown project falls back to the newest
    : undefined;
  useEffect(() => {
    if (fallbackFile) navigate({ file: fallbackFile, project: undefined }, true);
  }, [fallbackFile, navigate]);

  useEffect(() => {
    void refresh();
    // Re-evaluates "stale" so an interrupted session drops back to idle.
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  // A file in the URL that isn't listed (deleted, or a link from another computer). Refresh once before saying so,
  // in case it's a session that started after the list was loaded.
  const listedAnywhere = !file || !projects || projects.some((p) => p.sessions.some((s) => sameSessionFile(s.file, file)));
  useEffect(() => {
    if (!listedAnywhere && file && recheckedFile !== file) void refresh().then(() => setRecheckedFile(file));
  }, [listedAnywhere, file, recheckedFile, refresh]);
  const missing = !listedAnywhere && recheckedFile === file;

  // Opening another session (a new file in the URL) closes a dropped file and starts with no filter.
  useEffect(() => {
    setDropped(null);
    setFilter(emptyFilter());
  }, [file]);
  const { logs, connected } = useSessionStream(dropped || missing ? null : file);
  // A dropped file is never live: "now" far in the future marks it finished.
  const model = useMemo(
    () => (dropped ? buildSession(dropped.records, dropped.agents, Number.MAX_SAFE_INTEGER) : buildSession(logs.main, logs.agents, now)),
    [dropped, logs, now],
  );

  const project = projects?.find((p) => p.dir === projectDir);
  const listed = project?.sessions.find((s) => sameSessionFile(s.file, file));
  // The picker only scans the start of each log; a huge first message leaves it untitled.
  const firstAsk = model.turns.find((t) => t.text !== SESSION_START)?.text;
  const session: SessionInfo | undefined =
    listed && listed.title === "Untitled session" && firstAsk ? { ...listed, title: safeClip(firstAsk.replace(/\s+/g, " ").trim(), 300) } : listed;
  const lastTurn = model.turns.length - 1;
  const turnIndex = sessionRoute?.turn !== undefined && sessionRoute.turn <= lastTurn ? sessionRoute.turn : lastTurn;
  const turn = model.turns[turnIndex];
  const selected: Selection = sessionRoute?.step ? { type: "step", id: sessionRoute.step } : actorPick;
  const selectedStep = selected?.type === "step" ? turn?.steps.find((s) => s.id === selected.id) : undefined;
  const viewFile = dropped ? DROPPED_PREFIX + dropped.name : file;
  // A name you gave the session (Bookmarks) wins over its title.
  const title = (file && !dropped && marks.nameOf(file)) || session?.title;
  // Bookmark labels are stored, so they're always fully masked (this session's names included).
  const cwdKey = model.meta.cwds.join("\n");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `cwdKey` stands for the folders' contents
  const storeMask = useMemo(() => sessionMasker(home, model.meta.cwds), [home, cwdKey]);

  // Session-level changes: from an app page they return to the last open session. Reads the live URL, not
  // this render's `route`, so two calls in one handler (pick a request, then select an agent) both land.
  const go = (patch: Partial<Route>, replace?: boolean) => {
    const onSession = parseRoute(window.location.hash).page === "session";
    navigate({ ...(onSession ? null : lastSession), ...patch, page: "session" }, replace);
  };
  const setSelected = (s: Selection) => {
    setActorPick(s?.type === "actor" ? s : null);
    go({ step: s?.type === "step" ? s.id : undefined }, true);
  };
  const pickSession = (s?: SessionInfo, project?: string) => {
    setActorPick(null);
    setDropped(null);
    go({ file: s?.file, project: s ? undefined : project, turn: undefined, step: undefined, view: "map", q: undefined, other: undefined });
  };
  const pickTurn = (i: number) => {
    setActorPick(null);
    // Picking a request from the whole-session overview opens its map; other views stay put.
    go({ turn: i === lastTurn ? undefined : i, step: undefined, view: view === "flow" ? "map" : view });
    setRequestsOpen(false);
  };
  const pageNavigate: Navigate = (patch, replace) =>
    patch.page === "session" && !patch.file ? go(patch, replace) : navigate(patch, replace);
  const openPage = (page: AppPage) => (page === "session" ? go({}) : navigate({ page }));

  // Escape closes the top-most layer only: dialogs first (they register later), then these drawers.
  useEscape(requestsOpen && route.page === "session", () => setRequestsOpen(false));
  useEscape(!!selected && route.page === "session", () => setSelected(null));

  // Keyboard: j/k and friends show another request in the same view (the Whole session view just moves its
  // highlight); pickTurn, for clicks, opens a request's map from the Whole session view.
  useSessionShortcuts({
    openPage: (page) => navigate({ page }),
    onSession: route.page === "session" && !!turn,
    view,
    turnIndex,
    lastTurn,
    showTurn: (i) => {
      setActorPick(null);
      go({ turn: i === lastTurn ? undefined : i, step: undefined });
    },
    setView: (v) => go({ view: v }),
    stepSession: (d) => {
      const next = siblingSession(project?.sessions ?? [], file, d);
      if (next) pickSession(next);
    },
    bookmark: () =>
      viewFile && marks.toggle({ file: viewFile, step: selectedStep?.id, turn: selectedStep ? turnIndex : undefined, label: selectedStep?.title ?? title ?? "Session" }, storeMask),
  });

  const turnList = (
    <TurnList turns={model.turns} actors={model.actors} selectedIndex={turnIndex} liveIndex={model.live.active ? lastTurn : undefined} onPick={pickTurn} />
  );
  const details = (onClose?: () => void) => (
    <DetailsPanel file={viewFile ?? undefined} turn={turn} turns={model.turns} onPickTurn={pickTurn} onShowSession={() => go({ view: "flow" })} actors={model.actors} selected={selected} onSelect={setSelected} onHelp={() => setHelp(true)} onClose={onClose} />
  );

  return (
    // Masking learns the user's name from this session's folders (and the home folder), never from log text.
    <MaskScope cwds={model.meta.cwds}>
      {/* A size container: the header and the space under it adapt, in rem, to the room left at the chosen text
          size (the @min-[44rem] variants). It must stay exactly viewport-sized (h-dvh w-screen): its width is what
          those queries measure, and the fixed header, drawers and popups inside it are laid out against it. */}
      <main className="@container relative flex h-dvh w-screen flex-col overflow-hidden bg-background">
        {!dropped && <AttentionWatcher model={model} />}
        <Header
          projects={projects ?? []}
          project={project}
          session={session}
          title={title}
          fileName={dropped?.name}
          page={route.page}
          onSession={pickSession}
          onRefresh={refresh}
          onHelp={() => setHelp(true)}
          onOpenPage={openPage}
          onSettings={() => setSettingsOpen(true)}
          live={model.live}
          connected={connected}
          badge={!dropped && <AttentionBadge model={model} compact />}
        />

        {route.page !== "session" ? (
          <div className="min-h-0 flex-1 overflow-auto pt-[8rem] @min-[44rem]:pt-[5.25rem]">
            <AppPageView page={route.page} route={route} navigate={pageNavigate} />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 pt-[8rem] @min-[44rem]:pt-[5.25rem]">
            <div data-tour="requests" className="hidden w-[17rem] shrink-0 border-r border-foreground/10 xl:block">{turnList}</div>

            <div className="flex min-w-0 flex-1 flex-col">
              {turn && dropped && <DroppedBanner name={dropped.name} onClose={() => setDropped(null)} actions={<ExportMenu model={model} turn={turn} compact />} />}
              {turn && !dropped && file && <SessionInfoBar model={model} file={file} title={title ?? "Session"} turn={turn} />}
              {turn && (
                <SessionTabs
                  view={view}
                  turnIndex={turnIndex}
                  turnCount={model.turns.length}
                  onView={(v) => go({ view: v })}
                  filter={FILTERED_VIEWS.includes(view) ? { active: !isFilterEmpty(filter), open: filterOpen, onToggle: () => setFilterOpen(!filterOpen) } : undefined}
                />
              )}
              {turn && FILTERED_VIEWS.includes(view) && (filterOpen || !isFilterEmpty(filter)) && (
                <div className="shrink-0 border-b border-foreground/10 px-4 py-2.5">
                  <FilterBar steps={turn.steps} value={filter} onChange={setFilter} actors={model.actors} />
                </div>
              )}
              <div data-tour="map" className="relative min-h-0 flex-1">
                {turn && <Welcome onHelp={() => setHelp(true)} />}
                {turn && (file || dropped) ? (
                  <ActiveView
                    key={`${dropped ? DROPPED_PREFIX + dropped.name : file}:${view}`}
                    view={view}
                    model={model}
                    turn={turn}
                    file={dropped ? DROPPED_PREFIX + dropped.name : file!}
                    selected={selected}
                    onSelect={setSelected}
                    onPickTurn={pickTurn}
                    onShowSession={() => go({ view: "flow" })}
                    onShowRequests={() => setRequestsOpen(true)}
                    filter={FILTERED_VIEWS.includes(view) ? filter : undefined}
                  />
                ) : (
                  <Empty
                    projects={projects}
                    loading={!!file && (!connected || (listed?.requests ?? 0) > 0)} // a big log takes a while to replay
                    missing={missing}
                    onNewest={() => pickSession(projects?.[0]?.sessions[0])}
                  />
                )}
              </div>
            </div>

            <div data-tour="explanations" className="hidden w-[23.75rem] shrink-0 border-l border-foreground/10 lg:block">{details()}</div>
          </div>
        )}

        {/* Smaller screens: the request list and the explanations slide in as drawers. */}
        <AnimatePresence>
          {requestsOpen && route.page === "session" && (
            <motion.div key="requests" className="fixed inset-0 z-40 bg-black/30 xl:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setRequestsOpen(false)}>
              <motion.div
                className="glass-strong h-full w-[18.75rem] max-w-[85vw]"
                {...slide(reduce, { x: "-100%" })}
                onClick={(e) => e.stopPropagation()}
              >
                {turnList}
              </motion.div>
            </motion.div>
          )}
          {selected && route.page === "session" && (
            <motion.div
              key="details"
              className="glass-strong fixed inset-x-0 bottom-0 z-40 h-[62dvh] rounded-t-2xl shadow-2xl lg:hidden"
              {...slide(reduce, { y: "100%" })}
            >
              {details(() => setSelected(null))}
            </motion.div>
          )}
        </AnimatePresence>

        <DropFile
          onLoad={(records, name, agents) => {
            setActorPick(null);
            setDropped({ name, records, agents });
            if (route.page !== "session") go({});
          }}
        />
        <HelpDialog open={help} onClose={() => setHelp(false)} />
        <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </main>
    </MaskScope>
  );
}

function ActiveView({ view, ...props }: { view: SessionView } & SessionViewProps) {
  const View = (SESSION_VIEWS.find((v) => v.id === view) ?? SESSION_VIEWS[0]).component;
  return <View {...props} />;
}

function AppPageView({ page, ...props }: { page: Exclude<AppPage, "session"> } & AppPageProps) {
  const Page = APP_PAGES[page];
  return <Page {...props} />;
}

function Empty({ projects, loading, missing, onNewest }: { projects: ProjectInfo[] | null; loading: boolean; missing: boolean; onNewest: () => void }) {
  if (!projects) return null;
  if (missing)
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <p className="text-sm font-medium">That session isn&apos;t on this computer any more</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Its log may have been deleted, or the link came from another computer.
          </p>
          {projects.some((p) => p.sessions.length) && (
            <button
              onClick={onNewest}
              className="mt-4 h-8 rounded-lg border border-foreground/10 px-3 text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            >
              Open the newest session
            </button>
          )}
        </div>
      </div>
    );
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-sm text-center">
        {loading && <Loader2 className="mx-auto mb-3 size-5 animate-spin text-muted-foreground" />}
        <p className="text-sm font-medium">{!projects.length ? "No Claude Code sessions found" : loading ? "Loading session…" : "Nothing to show yet"}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {!projects.length
            ? "cc-trace looked in ~/.claude/projects. Use Claude Code once, then come back."
            : "Send Claude a message and watch it appear here as it happens."}
        </p>
      </div>
    </div>
  );
}
