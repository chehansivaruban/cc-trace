"use client";
// Stats: how many tokens this session used, where they went, how full Claude's memory got, and tips for using fewer.
import { useMemo, useState } from "react";
import { Info, Lightbulb, TriangleAlert } from "lucide-react";
import { BarChart, type Bar } from "@/components/charts/bars";
import { CHART_VARS, fmt } from "@/components/charts/kit";
import { LineChart } from "@/components/charts/line";
import { hueColor } from "@/components/step-icon";
import { AsTable, Meter, Section, Segmented, SortTable, StatTile, TechToggle,  pct, shortDuration, sameLabel, tokenColumns, toolLabel, type Column } from "@/components/stats-parts";
import { Term, TermText } from "@/components/term-text";
import { burnSeries, cacheHit, contextGauge, sessionStats, type BurnPoint, type Row, type ToolRow } from "@/lib/analytics/stats";
import { tipsFor } from "@/lib/analytics/tips";
import { useMask } from "@/hooks/use-mask";
import { useRoute } from "@/lib/route";
import { useSettings } from "@/lib/settings";
import { totalTokens, type Usage } from "@/lib/session";
import { cn } from "@/lib/utils";
import { isDroppedFile } from "@/lib/paths";
import type { SessionViewProps } from "./registry";

const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const dateTime = (ts: number) => new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function StatsView({ model, turn, file }: SessionViewProps) {
  const [settings] = useSettings();
  const [, navigate] = useRoute();
  const [tech, setTech] = useState(settings.showTechnical);
  const [scope, setScope] = useState<"session" | "request">("session");
  const mask = useMask(model);

  const stats = useMemo(() => sessionStats(model), [model]);
  const burn = useMemo(() => burnSeries(model, scope === "request" ? turn.index : undefined), [model, scope, turn.index]);
  const gauges = useMemo(() => new Map(model.turns.map((t) => [t.index, contextGauge(t, model)])), [model]);
  const tips = useMemo(() => tipsFor(turn, model), [turn, model]);

  const last = model.turns.length - 1;
  // Open a request (and step) on the map.
  // A dropped file has no URL: stay on it rather than putting "dropped:…" in the link.
  const jump = (to?: { turn: number; step?: string }) =>
    to && navigate({ page: "session", ...(isDroppedFile(file) ? null : { file }), turn: to.turn === last ? undefined : to.turn, view: "map", step: to.step });

  const total = totalTokens(stats.totals);
  const replies = stats.byRequest.reduce((a, r) => a + (r.replies ?? 0), 0);
  const helpers = stats.byAgent.filter((r) => model.actors[r.key]?.kind === "helper");
  const topHelper = helpers[0];
  const gauge = gauges.get(turn.index) ?? contextGauge(turn, model);
  const share = (u: Usage) => pct((totalTokens(u) / Math.max(1, total)) * 100);

  const replyBars: (Bar & { n: number })[] = turn.steps
    .filter((s) => s.usage)
    .map((s, i) => ({
      key: s.id,
      n: i + 1,
      value: s.usage!.written,
      label: `Reply ${i + 1} · ${mask(model.actors[s.from ?? s.actor]?.name ?? "Claude")}`,
      detail: `${mask(s.title)} · ${time(s.ts)}`,
    }));

  const burnCols: Column<BurnPoint>[] = [
    { id: "when", label: "When", width: "minmax(0,1fr)", sort: (p) => p.ts, cell: (p) => dateTime(p.ts) },
    { id: "request", label: "Request", width: "4rem", align: "right", sort: (p) => p.turn ?? 0, cell: (p) => (p.turn ?? 0) + 1 },
    { id: "tokens", label: "Tokens so far", width: "6.75rem", align: "right", sort: (p) => p.tokens, cell: (p) => fmt(p.tokens) },
  ];
  const replyCols: Column<Bar & { n: number }>[] = [
    { id: "n", label: "#", width: "2.125rem", sort: (b) => b.n, cell: (b) => <span className="text-muted-foreground tabular-nums">{b.n}</span> },
    { id: "what", label: "Reply", width: "minmax(0,1fr)", sort: (b) => b.detail ?? "", cell: (b) => `${b.label.replace(/^Reply \d+ · /, "")} · ${b.detail ?? ""}` },
    { id: "written", label: "Tokens written", width: "6.75rem", align: "right", sort: (b) => b.value, cell: (b) => fmt(b.value) },
  ];

  const requestCols: Column<Row>[] = [
    { id: "n", label: "#", width: "2.125rem", sort: (r) => r.jumpTo!.turn, cell: (r) => <span className="text-muted-foreground tabular-nums">{r.jumpTo!.turn + 1}</span> },
    { id: "label", label: "You asked", width: "minmax(0,1fr)", sort: (r) => r.label, cell: (r) => mask(r.label) },
    ...tokenColumns<Row>((r) => r.usage, tech),
    {
      id: "memory",
      label: "Memory at start",
      width: "8rem",
      minor: true,
      sort: (r) => gauges.get(r.jumpTo!.turn)?.pct ?? 0,
      cell: (r) => {
        const g = gauges.get(r.jumpTo!.turn);
        return g && g.used ? <Meter pct={g.pct} compact /> : <span className="text-muted-foreground">–</span>;
      },
    },
    { id: "steps", label: "Steps", width: "3.25rem", align: "right", minor: true, sort: (r) => r.steps, cell: (r) => r.steps },
    { id: "time", label: "Time", width: "3.75rem", align: "right", sort: (r) => r.durationMs, cell: (r) => shortDuration(r.durationMs) },
  ];

  const modelCols: Column<Row>[] = [
    { id: "label", label: "Model", width: "minmax(0,1fr)", sort: (r) => r.label, cell: (r) => (tech && r.key !== "unknown" ? <code className="text-xs">{r.key}</code> : r.label) },
    ...tokenColumns<Row>((r) => r.usage, tech, total),
    { id: "replies", label: "Replies", width: "3.75rem", align: "right", sort: (r) => r.replies ?? 0, cell: (r) => fmt(r.replies ?? 0) },
    { id: "steps", label: "Steps", width: "3.25rem", align: "right", minor: true, sort: (r) => r.steps, cell: (r) => fmt(r.steps) },
  ];

  const agentCols: Column<Row>[] = [
    {
      id: "label",
      label: "Who",
      width: "minmax(0,1fr)",
      sort: (r) => r.label,
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: hueColor(model.actors[r.key]?.hue ?? 0) }} />
          <span className="truncate">{mask(r.label)}</span>
          {tech && model.actors[r.key]?.model && <code className="hidden shrink-0 text-[0.6875rem] text-muted-foreground sm:inline">{model.actors[r.key].model}</code>}
        </span>
      ),
    },
    ...tokenColumns<Row>((r) => r.usage, tech, total),
    { id: "tools", label: "Tool uses", width: "4.25rem", align: "right", sort: (r) => r.toolCalls ?? 0, cell: (r) => fmt(r.toolCalls ?? 0) },
    { id: "time", label: "Time", width: "3.75rem", align: "right", minor: true, sort: (r) => r.durationMs, cell: (r) => shortDuration(r.durationMs) },
  ];

  const maxTool = Math.max(1, ...stats.tools.map((t) => t.count));
  const twins = sameLabel(stats.tools.map((t) => t.tool));
  const toolCols: Column<ToolRow>[] = [
    {
      id: "tool",
      label: "Action",
      width: "minmax(0,1fr)",
      sort: (r) => toolLabel(r.tool),
      cell: (r) => (
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate">{toolLabel(r.tool)}</span>
          {(tech || twins.has(toolLabel(r.tool))) && <code className="truncate text-[0.6875rem] text-muted-foreground">{r.tool}</code>}
        </span>
      ),
    },
    {
      id: "count",
      label: "Uses",
      width: "6.5rem",
      sort: (r) => r.count,
      cell: (r) => (
        <span className="flex items-center gap-2">
          <span className="h-1.5 shrink-0 rounded-full bg-[var(--series-1)]" style={{ width: `${Math.max(3, (r.count / maxTool) * 52)}px` }} />
          <span className="tabular-nums">{fmt(r.count)}</span>
        </span>
      ),
    },
    { id: "ok", label: "Worked", width: "3.75rem", align: "right", sort: (r) => (r.count - r.failed) / r.count, cell: (r) => pct(((r.count - r.failed) / r.count) * 100) },
    {
      id: "longest",
      label: "Longest",
      width: "4.25rem",
      align: "right",
      minor: true,
      sort: (r) => r.longest?.durationMs ?? 0,
      cell: (r) =>
        r.longest?.durationMs ? (
          <button
            onClick={() => jump({ turn: r.turn!, step: r.longest!.id })}
            className="underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground"
            title="Open the longest one on the map"
          >
            {shortDuration(r.longest.durationMs)}
          </button>
        ) : (
          "–"
        ),
    },
  ];

  const turnBand = scope === "session" && model.turns.length > 1 ? { from: turn.ts, to: turn.end, label: `request ${turn.index + 1}` } : undefined;

  return (
    <div className={cn("h-full overflow-y-auto", CHART_VARS)}>
      <div className="mx-auto max-w-5xl px-4 pt-5 pb-16 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">Stats</div>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">How much work this session took</h2>
            <p className="mt-1 max-w-2xl text-[0.8125rem] leading-relaxed text-muted-foreground">
              Claude measures text in <Term k="tokens">tokens</Term>, about ¾ of a word each. Here is how many this session used, where they went, and tips for using fewer.
              cc-trace counts them from the log on your computer and uses none itself.
            </p>
          </div>
          <TechToggle on={tech} onChange={setTech} />
        </div>

        <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(min(100%,10rem),1fr))] gap-2.5">
          <StatTile label="Requests" value={fmt(model.turns.length)} sub={`${fmt(replies)} replies from Claude`} />
          <StatTile label="Tokens processed" value={fmt(total)} sub={`${fmt(stats.totals.written)} written`} />
          <StatTile label={<TermText text="[[cacheHit:Re-read from cache]]" />} value={pct(stats.cacheHitPct)} sub={`${fmt(stats.totals.cached)} tokens`} />
          <StatTile label="Helpers" value={fmt(helpers.length)} sub={topHelper ? `busiest: ${share(topHelper.usage)} of tokens` : "Claude worked alone"} />
        </div>
        {tech && (
          <div className="mt-2.5 grid grid-cols-[repeat(auto-fill,minmax(min(100%,10rem),1fr))] gap-2.5">
            <StatTile label="New (input)" value={fmt(stats.totals.input)} sub="input_tokens" />
            <StatTile label="Cache write, 5 min" value={fmt(stats.totals.cacheWrite5m)} sub="ephemeral_5m_input_tokens" />
            <StatTile label="Cache write, 1 hour" value={fmt(stats.totals.cacheWrite1h)} sub="ephemeral_1h_input_tokens" />
            <StatTile label="Re-read (cache read)" value={fmt(stats.totals.cached)} sub="cache_read_input_tokens" />
          </div>
        )}

        <Section
          title={`Request ${turn.index + 1}: memory and tips`}
          intro={<TermText text="How full Claude's [[context:memory]] was when it started on this request, compared with the most its model can hold (its [[window:memory size]])." />}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-foreground/10 px-3.5 py-3">
              {gauge.used ? (
                <>
                  <Meter pct={gauge.pct} />
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    <span className="text-foreground tabular-nums">{fmt(gauge.used)}</span> of <span className="tabular-nums">{fmt(gauge.window)}</span> tokens. Re-read from
                    cache in this request: {pct(cacheHit(turn.usage))}.
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Claude hasn&apos;t replied in this request yet, so there is nothing to measure.</p>
              )}
            </div>
            <div className="rounded-xl border border-foreground/10 px-3.5 py-3" aria-live="polite">
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <Lightbulb className="size-3.5" /> Tips for using fewer tokens
              </div>
              {tips.length ? (
                <ul className="mt-2 space-y-2">
                  {tips.map((t) => (
                    <li key={t.id} className="flex gap-2 text-[0.8125rem] leading-relaxed">
                      {t.severity === "warn" ? (
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-[var(--status-warning)]" aria-label="Worth acting on" />
                      ) : (
                        <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-label="Good to know" />
                      )}
                      <span className="min-w-0 break-words">
                        <TermText text={mask(t.text)} />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-xs text-muted-foreground">Nothing stood out in this request. Memory, caching and file reads all look normal.</p>
              )}
            </div>
          </div>
        </Section>

        <Section
          title="Tokens as the session went on"
          intro="The running total after each of Claude's replies. Steep parts are where a lot happened; click the line to open that moment on the map."
          aside={
            <Segmented
              label="Show"
              value={scope}
              onChange={setScope}
              options={[
                { value: "session", label: "Whole session" },
                { value: "request", label: `Request ${turn.index + 1}` },
              ]}
            />
          }
        >
          <LineChart
            points={burn.map((p) => ({ x: p.ts, y: p.tokens }))}
            seriesLabel="tokens so far"
            ariaLabel={`Running total of tokens, reaching ${fmt(burn.at(-1)?.tokens ?? 0)}`}
            formatX={scope === "session" ? dateTime : time}
            band={turnBand}
            onPick={(i) => {
              const p = burn[i];
              if (p?.turn !== undefined) jump({ turn: p.turn, step: p.step });
            }}
            pickHint="Click to open on the map"
          />
          <AsTable>
            {() => (
              <SortTable
                rows={burn.slice(1)}
                columns={burnCols}
                rowKey={(p) => `${p.step}-${p.ts}`}
                onRow={(p) => p.turn !== undefined && jump({ turn: p.turn, step: p.step })}
                initialSort={{ id: "when", desc: false }}
              />
            )}
          </AsTable>
        </Section>

        <Section
          title={`What Claude wrote in each reply (request ${turn.index + 1})`}
          intro={<TermText text="[[written:Tokens written]] per reply, by Claude and its helpers. Tall bars are long answers, big files or long briefs. Click a bar to see that step." />}
        >
          <BarChart
            bars={replyBars}
            seriesLabel="tokens written"
            ariaLabel={`Tokens written per reply in request ${turn.index + 1}`}
            ends={replyBars.length ? ["first reply", `reply ${replyBars.length}`] : undefined}
            onPick={(key) => jump({ turn: turn.index, step: key })}
            pickHint="Click to open on the map"
          />
          {replyBars.length > 0 && (
            <AsTable>
              {() => (
                <SortTable rows={replyBars} columns={replyCols} rowKey={(b) => b.key} onRow={(b) => jump({ turn: turn.index, step: b.key })} initialSort={{ id: "n", desc: false }} />
              )}
            </AsTable>
          )}
        </Section>

        <Section title="Every request" intro="Click a request to open it. Click a column name to sort.">
          <SortTable
            rows={stats.byRequest}
            columns={requestCols}
            rowKey={(r) => r.key}
            onRow={(r) => jump(r.jumpTo)}
            highlight={(r) => r.jumpTo?.turn === turn.index}
            initialSort={{ id: "n", desc: false }}
          />
        </Section>

        <Section title={<TermText text="By [[model:model]]" />} intro="Which version of Claude did the work.">
          <SortTable rows={stats.byModel} columns={modelCols} rowKey={(r) => r.key} initialSort={{ id: "tokens", desc: true }} />
        </Section>

        <Section
          title="Claude and its helpers"
          intro={
            topHelper ? (
              <>
                <b className="font-medium text-foreground">{mask(topHelper.label)}</b> used the most tokens of {helpers.length === 1 ? "the one helper" : `all ${helpers.length} helpers`}:{" "}
                {fmt(totalTokens(topHelper.usage))} ({share(topHelper.usage)} of the session). Click a helper to see its brief.
              </>
            ) : (
              "Claude did everything itself in this session: no helpers."
            )
          }
        >
          <SortTable
            rows={stats.byAgent}
            columns={agentCols}
            rowKey={(r) => r.key}
            onRow={(r) => jump(r.jumpTo)}
            initialSort={{ id: "tokens", desc: true }}
            highlight={(r) => r.key === topHelper?.key}
          />
        </Section>

        <Section title="Actions Claude took most" intro="How often each kind of action was used, how often it worked, and the longest single one (click the time to see it).">
          <SortTable rows={stats.tools} columns={toolCols} rowKey={(r) => r.tool} initialSort={{ id: "count", desc: true }} empty="No actions yet." />
        </Section>
      </div>
    </div>
  );
}
