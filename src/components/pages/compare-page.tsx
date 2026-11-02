"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { TermText } from "@/components/term-text";
import { useMask } from "@/hooks/use-mask";
import { useSessionStream } from "@/hooks/use-session-stream";
import { METRIC_LABELS, compare, compareModels, compareTools, scopeToTurn, type CompareMetric } from "@/lib/analytics/compare";
import { formatCount, sessionStory, storyOf } from "@/lib/analytics/story";
import type { ProjectInfo } from "@/lib/claude-logs";
import type { AppPageProps } from "@/lib/route";
import { SESSION_START, buildSession, type SessionModel } from "@/lib/session";
import { cn } from "@/lib/utils";
import { maskClip } from "@/lib/redact";

const shortPath = (p: string) => p.split(/[\\/]/).filter(Boolean).slice(-2).join("/") || p;

function duration(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 90 ? `${m} min` : `${(m / 60).toFixed(1)} h`;
}
const show = (metric: string, n: number) => (metric === "durationMs" ? duration(n) : formatCount(n));

/** One side of the comparison: a session from the logs, optionally narrowed to one request. */
function useSide(file: string | undefined, turn: number | "all", size: number | undefined) {
  const { logs, connected } = useSessionStream(file ?? null);
  // The stream keeps updating; "now" only matters for live state, which comparing doesn't show.
  const model = useMemo(() => buildSession(logs.main, logs.agents), [logs]);
  const scoped = useMemo(() => (turn === "all" ? model : scopeToTurn(model, turn)), [model, turn]);
  // An empty log (size 0) or one that isn't listed (size 0 too) never sends records: don't wait for them.
  const loading = !!file && size !== 0 && (!connected || !logs.main.length);
  return { model, scoped, loading, empty: !!file && !loading && !model.turns.length };
}

function Picker(props: {
  label: string;
  projects: ProjectInfo[];
  file?: string;
  onFile: (f: string) => void;
  model: SessionModel;
  turn: number | "all";
  onTurn: (t: number | "all") => void;
  mask: (s: string) => string;
}) {
  const { projects, file, model, turn, mask } = props;
  const select = "h-9 w-full min-w-0 rounded-lg border border-foreground/15 bg-background px-2 text-[0.8125rem] outline-none focus:border-foreground/40";
  return (
    <div className="min-w-0 rounded-xl border border-foreground/10 p-3">
      <p className="mb-2 text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">{props.label}</p>
      <select className={select} value={file ?? ""} onChange={(e) => props.onFile(e.target.value)} aria-label={`${props.label}: session`}>
        {!file && <option value="">Pick a session…</option>}
        {file && projects.length > 0 && !projects.some((p) => p.sessions.some((s) => s.file === file)) && <option value={file}>A session that wasn&apos;t found</option>}
        {projects.map((p) => (
          <optgroup key={p.dir} label={mask(shortPath(p.path))}>
            {p.sessions.map((s) => (
              <option key={s.file} value={s.file}>
                {maskClip(s.title, 80, mask)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <select
        className={cn(select, "mt-2")}
        value={String(turn)}
        onChange={(e) => props.onTurn(e.target.value === "all" ? "all" : Number(e.target.value))}
        aria-label={`${props.label}: request`}
        disabled={!model.turns.length}
      >
        <option value="all">Whole session</option>
        {model.turns.map((t) => (
          <option key={t.index} value={t.index}>
            Request {t.index + 1}: {t.text === SESSION_START ? SESSION_START : mask(t.text.replace(/\s+/g, " ")).slice(0, 60)}
          </option>
        ))}
      </select>
    </div>
  );
}

function Note({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-dashed border-foreground/15 p-3">
      <p className="mb-2 text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

/** Compare two sessions or requests (H2): effort side by side, top tools and models. Tokens only, no money. */
export function ComparePage({ route, navigate }: AppPageProps) {
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null);
  const [turnA, setTurnA] = useState<number | "all">("all");
  const [turnB, setTurnB] = useState<number | "all">("all");
  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((list: ProjectInfo[]) => setProjects(Array.isArray(list) ? list : []))
      .catch(() => setProjects([]));
  }, []);
  const newest = useMemo(() => (projects ?? []).flatMap((p) => p.sessions).sort((a, b) => b.mtime - a.mtime), [projects]);
  const fileA = route.file ?? newest[0]?.file;
  const fileB = route.other ?? newest.find((s) => s.file !== fileA)?.file;
  // Before the listing arrives the size is unknown (keep waiting); afterwards a missing file counts as empty.
  const sizeOf = (f?: string) => (projects === null ? undefined : (newest.find((s) => s.file === f)?.size ?? 0));
  const a = useSide(fileA, turnA, sizeOf(fileA));
  const b = useSide(fileB, turnB, sizeOf(fileB));
  const listed = projects !== null;
  const maskA = useMask(a.model);
  const maskB = useMask(b.model);

  const rows = useMemo(() => compare(a.scoped, b.scoped), [a.scoped, b.scoped]);
  const tools = useMemo(() => compareTools(a.scoped, b.scoped, 8), [a.scoped, b.scoped]);
  const models = useMemo(() => compareModels(a.scoped, b.scoped), [a.scoped, b.scoped]);
  const maxTool = Math.max(1, ...tools.flatMap((t) => [t.a, t.b]));
  const storyA = turnA === "all" ? sessionStory(a.model, maskA) : a.model.turns[turnA] ? storyOf(a.model.turns[turnA], a.model, maskA) : "";
  const storyB = turnB === "all" ? sessionStory(b.model, maskB) : b.model.turns[turnB] ? storyOf(b.model.turns[turnB], b.model, maskB) : "";
  const loading = a.loading || b.loading;

  return (
    <div className="mx-auto max-w-[57.5rem] px-4 pt-4 pb-16 sm:px-6">
      <button onClick={() => navigate({ page: "session" })} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Back to the session
      </button>
      <h2 className="mt-3 text-lg font-semibold tracking-tight">Compare two sessions</h2>
      <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">
        <TermText text="Put two sessions, or two requests, side by side to see which took more effort. Lower numbers mean less work: fewer [[tokens:tokens]], less time, fewer errors." />
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {fileA || !listed ? (
          <Picker label="A" projects={projects ?? []} file={fileA} onFile={(f) => { setTurnA("all"); navigate({ file: f }, true); }} model={a.model} turn={turnA} onTurn={setTurnA} mask={maskA} />
        ) : (
          <Note label="A">No Claude Code sessions were found yet. Use Claude Code once, then come back.</Note>
        )}
        {fileB || !listed ? (
          <Picker label="B" projects={projects ?? []} file={fileB} onFile={(f) => { setTurnB("all"); navigate({ other: f }, true); }} model={b.model} turn={turnB} onTurn={setTurnB} mask={maskB} />
        ) : (
          <Note label="B">{fileA ? "There's only one session so far. Once you have another, you can compare the two here." : "Nothing to compare yet."}</Note>
        )}
      </div>
      {(a.empty || b.empty) && (
        <p className="mt-4 rounded-xl bg-foreground/[0.05] px-4 py-3 text-[0.8125rem] text-muted-foreground" role="status">
          {a.empty && b.empty ? "Neither session has any messages yet." : `Session ${a.empty ? "A" : "B"} has no messages yet. Pick another one to compare.`}
        </p>
      )}

      {loading && (
        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Reading the logs…
        </p>
      )}

      {fileA && fileB && !a.empty && !b.empty && (
        <>
          <div className="mt-6 overflow-x-auto rounded-xl border border-foreground/10">
            <table className="w-full text-[0.8125rem]">
              <thead>
                <tr className="border-b border-foreground/10 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">What</th>
                  <th className="px-3 py-2 text-right font-medium">A</th>
                  <th className="px-3 py-2 text-right font-medium">B</th>
                  <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Difference</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.metric} className="border-b border-foreground/5 last:border-0">
                    <td className="px-3 py-2 sm:whitespace-nowrap">{METRIC_LABELS[r.metric as CompareMetric] ?? r.metric}</td>
                    <td className={cn("px-3 py-2 text-right tabular-nums", r.better === "a" && "font-semibold text-emerald-700 dark:text-emerald-300")}>{show(r.metric, r.a)}</td>
                    <td className={cn("px-3 py-2 text-right tabular-nums", r.better === "b" && "font-semibold text-emerald-700 dark:text-emerald-300")}>{show(r.metric, r.b)}</td>
                    <td className="hidden px-3 py-2 text-right text-muted-foreground tabular-nums sm:table-cell">
                      {r.delta === 0 ? (
                        "same"
                      ) : (
                        <>
                          {r.delta > 0 ? "+" : "−"}
                          {show(r.metric, Math.abs(r.delta))}
                          {r.a > 0 && <span> ({r.delta > 0 ? "+" : "−"}{Math.round((Math.abs(r.delta) / r.a) * 100)}%)</span>}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">The lower number in each row is shown in green.</p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {[
              { label: "A", text: storyA },
              { label: "B", text: storyB },
            ].map((s) => (
              <div key={s.label} className="min-w-0 rounded-xl bg-foreground/[0.05] px-4 py-3">
                <p className="text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">{s.label} in short</p>
                <p className="mt-1 text-[0.8125rem] leading-relaxed break-words">
                  <TermText text={s.text} />
                </p>
              </div>
            ))}
          </div>

          <h3 className="mt-8 text-[0.9375rem] font-semibold tracking-tight">Most used tools</h3>
          <p className="mt-1 mb-3 text-[0.8125rem] text-muted-foreground">How many times each side used each tool.</p>
          {tools.length ? (
            <ul className="space-y-2">
              {tools.map((t) => (
                <li key={t.name} className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 text-xs">
                  <span className="truncate font-mono">{t.name}</span>
                  <span className="space-y-1">
                    {(["a", "b"] as const).map((k) => (
                      <span key={k} className="flex items-center gap-2">
                        <span className="w-3 text-muted-foreground">{k.toUpperCase()}</span>
                        <span className={cn("h-2 rounded-full", k === "a" ? "bg-sky-500/70" : "bg-violet-500/70")} style={{ width: `${(t[k] / maxTool) * 100}%`, minWidth: t[k] ? 4 : 0 }} />
                        <span className="tabular-nums text-muted-foreground">{t[k]}</span>
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[0.8125rem] text-muted-foreground">Neither side used any tools.</p>
          )}

          <h3 className="mt-8 text-[0.9375rem] font-semibold tracking-tight">Models</h3>
          <p className="mt-1 mb-3 text-[0.8125rem] text-muted-foreground">
            <TermText text="Which [[model:model]] wrote the replies on each side." />
          </p>
          <div className="grid gap-3 text-[0.8125rem] sm:grid-cols-2">
            {(["a", "b"] as const).map((k) => (
              <div key={k} className="min-w-0 rounded-xl border border-foreground/10 px-4 py-3">
                <p className="text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">{k.toUpperCase()}</p>
                <p className="mt-1 font-mono text-xs break-words">{models[k].length ? models[k].join(", ") : "None recorded"}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
