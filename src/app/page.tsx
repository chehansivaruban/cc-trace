"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { DetailsPanel } from "@/components/details-panel";
import { Header } from "@/components/header";
import { HelpDialog } from "@/components/help-dialog";
import { SessionFlow } from "@/components/session-flow";
import { Welcome } from "@/components/welcome";
import { StoryMap, type Selection } from "@/components/story-map";
import { TurnList } from "@/components/turn-list";
import { useSessionStream } from "@/hooks/use-session-stream";
import type { ProjectInfo, SessionInfo } from "@/lib/claude-logs";
import { SESSION_START, buildSession } from "@/lib/session";
import { cn } from "@/lib/utils";

const sheet = { type: "spring", bounce: 0, duration: 0.4 } as const;

export default function Home() {
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null);
  const [projectDir, setProjectDir] = useState<string>();
  const [file, setFile] = useState<string | null>(null);
  const [turnPick, setTurnPick] = useState<number | null>(null); // null: follow the newest request
  const [selected, setSelected] = useState<Selection>(null);
  const [view, setView] = useState<"session" | "request">("request");
  const [help, setHelp] = useState(false);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    const res = await fetch("/api/sessions");
    const list: ProjectInfo[] = await res.json();
    setProjects(list);
    // First load: jump to the most recently active session.
    setProjectDir((d) => d ?? list[0]?.dir);
    setFile((f) => f ?? list[0]?.sessions[0]?.file ?? null);
  }, []);

  useEffect(() => {
    void refresh();
    // Re-evaluates "stale" so an interrupted session drops back to idle.
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const { logs, connected } = useSessionStream(file);
  const model = useMemo(() => buildSession(logs.main, logs.agents, now), [logs, now]);

  const project = projects?.find((p) => p.dir === projectDir);
  const listed = project?.sessions.find((s) => s.file === file);
  // The picker only scans the start of each log; a huge first message leaves it untitled.
  const firstAsk = model.turns.find((t) => t.text !== SESSION_START)?.text;
  const session: SessionInfo | undefined =
    listed && listed.title === "Untitled session" && firstAsk ? { ...listed, title: firstAsk.slice(0, 120) } : listed;
  const lastTurn = model.turns.length - 1;
  const turnIndex = turnPick ?? lastTurn;
  const turn = model.turns[turnIndex];

  const pickSession = (s?: SessionInfo) => {
    setSelected(null);
    setView("request");
    setTurnPick(null);
    setFile(s?.file ?? null);
  };
  const pickTurn = (i: number) => {
    setSelected(null);
    setView("request");
    setTurnPick(i === lastTurn ? null : i);
    setRequestsOpen(false);
  };

  const turnList = (
    <TurnList turns={model.turns} actors={model.actors} selectedIndex={turnIndex} liveIndex={model.live.active ? lastTurn : undefined} onPick={pickTurn} />
  );
  const details = (onClose?: () => void) => (
    <DetailsPanel turn={turn} turns={model.turns} onPickTurn={pickTurn} onShowSession={() => setView("session")} actors={model.actors} selected={selected} onSelect={setSelected} onHelp={() => setHelp(true)} onClose={onClose} />
  );

  return (
    <main className="relative flex h-dvh w-screen flex-col overflow-hidden bg-background">
      <Header
        projects={projects ?? []}
        project={project}
        session={session}
        onProject={(p) => {
          setProjectDir(p.dir);
          pickSession(p.sessions[0]);
        }}
        onSession={pickSession}
        onRefresh={refresh}
        onHelp={() => setHelp(true)}
        live={model.live}
        connected={connected}
      />

      <div className="flex min-h-0 flex-1 pt-[84px]">
        <div className="hidden w-[272px] shrink-0 border-r border-foreground/10 xl:block">{turnList}</div>

        <div className="flex min-w-0 flex-1 flex-col">
          {turn && (
            <div className="flex shrink-0 items-center gap-1 border-b border-foreground/10 px-3 pt-2" role="tablist">
              {(
                [
                  ["session", `Whole session · ${model.turns.length} request${model.turns.length === 1 ? "" : "s"}`],
                  ["request", `Request ${turnIndex + 1}, step by step`],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={cn(
                    "-mb-px border-b-2 px-3 pb-2 text-[13px] transition-colors",
                    view === v ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="relative min-h-0 flex-1">
            {turn && <Welcome onHelp={() => setHelp(true)} />}
            {turn && view === "session" ? (
              <SessionFlow
                key={file}
                turns={model.turns}
                actors={model.actors}
                current={turnIndex}
                liveIndex={model.live.active ? lastTurn : undefined}
                onOpen={pickTurn}
                onOpenActor={(i, id) => {
                  pickTurn(i);
                  setSelected({ type: "actor", id });
                }}
              />
            ) : turn ? (
              <StoryMap
                key={`${file}:${turnIndex}`}
                turn={turn}
                actors={model.actors}
                isLatest={turnIndex === lastTurn}
                live={model.live}
                stale={model.stale}
                selected={selected}
                onSelect={setSelected}
                onShowRequests={() => setRequestsOpen(true)}
              />
            ) : (
              <Empty projects={projects} loading={!!file && !connected} />
            )}
          </div>
        </div>

        <div className="hidden w-[380px] shrink-0 border-l border-foreground/10 lg:block">{details()}</div>
      </div>

      {/* Smaller screens: the request list and the explanations slide in as drawers. */}
      <AnimatePresence>
        {requestsOpen && (
          <motion.div key="requests" className="fixed inset-0 z-40 bg-black/30 xl:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setRequestsOpen(false)}>
            <motion.div
              className="glass-strong h-full w-[300px] max-w-[85vw]"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={sheet}
              onClick={(e) => e.stopPropagation()}
            >
              {turnList}
            </motion.div>
          </motion.div>
        )}
        {selected && (
          <motion.div
            key="details"
            className="glass-strong fixed inset-x-0 bottom-0 z-40 h-[62dvh] rounded-t-2xl shadow-2xl lg:hidden"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={sheet}
          >
            {details(() => setSelected(null))}
          </motion.div>
        )}
      </AnimatePresence>

      <HelpDialog open={help} onClose={() => setHelp(false)} />
    </main>
  );
}

function Empty({ projects, loading }: { projects: ProjectInfo[] | null; loading: boolean }) {
  if (!projects) return null;
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
