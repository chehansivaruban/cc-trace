"use client";
// Dashboard: token use across every session on this computer, read from the logs on demand.
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { BarChart } from "@/components/charts/bars";
import { CHART_VARS, fmt } from "@/components/charts/kit";
import { Donut, useStableColors } from "@/components/charts/donut";
import { Section, Segmented, SortTable, StatTile, TechToggle, guessHome, pct, sameLabel, tokenColumns, toolLabel, type Column } from "@/components/stats-parts";
import { Term, TermText } from "@/components/term-text";
import { cacheHit, type Overview, type Row } from "@/lib/analytics/stats";
import { maskSecrets } from "@/lib/redact";
import type { AppPageProps } from "@/lib/route";
import { useSettings } from "@/lib/settings";
import { totalTokens } from "@/lib/session";
import { cn } from "@/lib/utils";

type OverviewResponse = Overview & { partial: boolean; scanned: number; total: number; generatedAt: number };
type Range = 7 | 30 | 90;
type ToolCount = Overview["tools"][number];
type Sess = Overview["sessions"][number];

const dayLabel = (date: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], opts);
};
const ago = (ts: number) => {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return `${d} day${d === 1 ? "" : "s"} ago`;
};

export function DashboardPage({ navigate }: AppPageProps) {
  const [settings] = useSettings();
  const [tech, setTech] = useState(settings.showTechnical);
  const [days, setDays] = useState<Range>(30);
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const colorOf = useStableColors();

  const load = useCallback(async (d: Range) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/overview?days=${d}`);
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load(days);
  }, [days, load]);

  const home = guessHome(data?.byProject.map((p) => p.label) ?? []);
  const mask = (s: string) => (settings.maskSensitive ? maskSecrets(s, home) : s);
  const open = (file?: string) => file && navigate({ page: "session", file, view: "map", turn: undefined, step: undefined, project: undefined });

  const total = data ? totalTokens(data.totals) : 0;
  const active = data?.days.filter((d) => d.tokens > 0) ?? [];
  const busiest = active.reduce<{ date: string; tokens: number } | null>((a, d) => (!a || d.tokens > a.tokens ? d : a), null);
  const projectName = (dir: string) => data?.byProject.find((p) => p.key === dir)?.label.split(/[\\/]/).filter(Boolean).pop() ?? dir;

  const projectCols: Column<Row>[] = [
    {
      id: "label",
      label: "Project",
      width: "minmax(0,1fr)",
      sort: (r) => r.label,
      cell: (r) => (
        <span title={mask(r.label)} className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 font-medium">{mask(r.label.split(/[\\/]/).filter(Boolean).pop() ?? r.label)}</span>
          <span className="truncate text-xs text-muted-foreground">{mask(r.label)}</span>
        </span>
      ),
    },
    { id: "sessions", label: "Sessions", width: "64px", align: "right", minor: true, sort: (r) => r.sessions ?? 0, cell: (r) => fmt(r.sessions ?? 0) },
    ...tokenColumns<Row>((r) => r.usage, tech, total),
  ];
  const modelCols: Column<Row>[] = [
    {
      id: "label",
      label: "Model",
      width: "minmax(0,1fr)",
      sort: (r) => r.label,
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: colorOf(r.key) }} />
          <span className="truncate">{tech ? r.key : r.label}</span>
        </span>
      ),
    },
    ...tokenColumns<Row>((r) => r.usage, tech, total),
    { id: "replies", label: "Replies", width: "64px", align: "right", minor: true, sort: (r) => r.replies ?? 0, cell: (r) => fmt(r.replies ?? 0) },
  ];
  const maxTool = Math.max(1, ...(data?.tools.map((t) => t.count) ?? []));
  const twins = sameLabel(data?.tools.slice(0, 25).map((t) => t.tool) ?? []);
  const toolCols: Column<ToolCount>[] = [
    {
      id: "tool",
      label: "Action",
      width: "minmax(0,1fr)",
      sort: (r) => toolLabel(r.tool),
      cell: (r) => (
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate">{toolLabel(r.tool)}</span>
          {(tech || twins.has(toolLabel(r.tool))) && <code className="truncate text-[11px] text-muted-foreground">{r.tool}</code>}
        </span>
      ),
    },
    {
      id: "count",
      label: "Uses",
      width: "112px",
      sort: (r) => r.count,
      cell: (r) => (
        <span className="flex items-center gap-2">
          <span className="h-1.5 shrink-0 rounded-full bg-[var(--series-1)]" style={{ width: `${Math.max(3, (r.count / maxTool) * 56)}px` }} />
          <span className="tabular-nums">{fmt(r.count)}</span>
        </span>
      ),
    },
    { id: "ok", label: "Worked", width: "60px", align: "right", sort: (r) => (r.count - r.failed) / r.count, cell: (r) => pct(((r.count - r.failed) / r.count) * 100) },
  ];
  const sessionCols: Column<Sess>[] = [
    { id: "title", label: "Session", width: "minmax(0,1fr)", sort: (r) => r.title, cell: (r) => mask(r.title) },
    { id: "project", label: "Project", width: "minmax(0,0.5fr)", minor: true, sort: (r) => projectName(r.project), cell: (r) => <span className="text-muted-foreground">{mask(projectName(r.project))}</span> },
    { id: "tokens", label: "Tokens", width: "108px", align: "right", sort: (r) => r.tokens, cell: (r) => fmt(r.tokens) },
    { id: "last", label: "Last active", width: "92px", align: "right", minor: true, sort: (r) => r.lastTs, cell: (r) => <span className="text-muted-foreground">{ago(r.lastTs)}</span> },
  ];

  return (
    <div className={cn("mx-auto max-w-5xl px-4 pt-5 pb-16 sm:px-6", CHART_VARS)}>
      <button onClick={() => navigate({ page: "session" })} className="text-xs text-muted-foreground hover:text-foreground">
        ← Back to the session
      </button>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Dashboard</div>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">All your sessions at a glance</h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
            How much work Claude did across all your projects, counted in <Term k="tokens">tokens</Term> (about ¾ of a word each). cc-trace reads your Claude Code logs on this
            computer; nothing is sent anywhere.
          </p>
        </div>
        <TechToggle on={tech} onChange={setTech} />
      </div>

      {/* Filters: one row, above everything they scope. */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Segmented
          label="Period"
          value={days}
          onChange={setDays}
          options={[
            { value: 7, label: "7 days" },
            { value: 30, label: "30 days" },
            { value: 90, label: "90 days" },
          ]}
        />
        <button
          onClick={() => load(days)}
          disabled={loading}
          className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-60"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          {loading ? "Reading your logs…" : "Refresh"}
        </button>
      </div>

      {error && <p className="mt-4 rounded-xl bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-600 dark:text-red-300">Couldn&apos;t read the logs: {error}</p>}
      {data?.partial && (
        <p className="mt-4 rounded-xl border border-foreground/10 px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground">
          Showing {fmt(data.scanned)} of {fmt(data.total)} sessions: reading took longer than 20 seconds, so cc-trace stopped there. Press Refresh to read the rest (sessions
          already read are remembered).
        </p>
      )}

      {!data && loading ? (
        <div className="flex items-center gap-2 py-16 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Reading your Claude Code logs…
        </div>
      ) : data ? (
        // While a new period loads, the old numbers stay put, dimmed.
        <div className={cn("transition-opacity", loading && "opacity-50")}>
          <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <StatTile label="Tokens processed" value={fmt(total)} sub={`${fmt(data.totals.written)} written`} />
            <StatTile label="Sessions" value={fmt(data.sessions.length)} sub={`in ${data.byProject.length} project${data.byProject.length === 1 ? "" : "s"}`} />
            <StatTile label={<TermText text="[[cacheHit:Re-read from cache]]" />} value={pct(cacheHit(data.totals))} sub={`${fmt(data.totals.cached)} tokens`} />
            <StatTile label="Busiest day" value={busiest ? dayLabel(busiest.date) : "–"} sub={busiest ? `${fmt(busiest.tokens)} tokens` : "no work in this period"} />
          </div>

          <Section title="Tokens per day" intro={`Each column is one day. Claude worked on ${active.length} of the last ${days} days.`}>
            <BarChart
              bars={data.days.map((d) => ({
                key: d.date,
                value: d.tokens,
                label: dayLabel(d.date, { weekday: "short", month: "short", day: "numeric" }),
                detail: `${d.sessions} session${d.sessions === 1 ? "" : "s"}`,
              }))}
              seriesLabel="tokens"
              ariaLabel={`Tokens per day over the last ${days} days`}
              ends={[dayLabel(data.days[0].date), "today"]}
              height={180}
            />
          </Section>

          <Section title={<TermText text="By [[model:model]]" />} intro="Which versions of Claude did the work.">
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <Donut
                slices={data.byModel.map((r) => ({ key: r.key, label: tech ? r.key : r.label, value: totalTokens(r.usage) }))}
                colorOf={colorOf}
                centerLabel="tokens"
                ariaLabel="Share of tokens by model"
              />
              <SortTable rows={data.byModel} columns={modelCols} rowKey={(r) => r.key} initialSort={{ id: "tokens", desc: true }} />
            </div>
          </Section>

          <Section title="By project" intro="Click a project to open its newest session.">
            <SortTable rows={data.byProject} columns={projectCols} rowKey={(r) => r.key} onRow={(r) => open(r.file)} initialSort={{ id: "tokens", desc: true }} empty="No sessions in this period." />
          </Section>

          <Section title="Sessions that used the most" intro="Click one to open it.">
            <SortTable rows={data.sessions.slice(0, 50)} columns={sessionCols} rowKey={(r) => r.file} onRow={(r) => open(r.file)} initialSort={{ id: "tokens", desc: true }} empty="No sessions in this period." />
          </Section>

          <Section title="Actions Claude took most" intro="Across all sessions in this period, with how often each one worked.">
            <SortTable rows={data.tools.slice(0, 25)} columns={toolCols} rowKey={(r) => r.tool} initialSort={{ id: "count", desc: true }} empty="No actions in this period." />
          </Section>
        </div>
      ) : null}
    </div>
  );
}
