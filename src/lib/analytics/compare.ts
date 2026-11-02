// Compare two sessions or requests (H2): the same numbers side by side, with the difference.
// Lower is counted as better for every metric: less effort for the job. No money: tokens, not cost.
import { SESSION_START, addUsage, totalTokens, type SessionModel, type Usage } from "../session.ts";

export type CompareMetric = "requests" | "tokens" | "durationMs" | "helpers" | "toolCalls" | "errors";
export type CompareRow = { metric: string; a: number; b: number; delta: number; better: "a" | "b" | "same" };

export const METRIC_LABELS: Record<CompareMetric, string> = {
  requests: "Requests",
  tokens: "Tokens",
  durationMs: "Time Claude spent working",
  helpers: "Helpers",
  toolCalls: "Tool calls",
  errors: "Steps with errors",
};
const METRICS = Object.keys(METRIC_LABELS) as CompareMetric[];

const zero = (): Usage => ({ fresh: 0, cached: 0, written: 0, input: 0, cacheWrite5m: 0, cacheWrite1h: 0 });

/** The numbers compared, for a whole session or a model scoped to one request. */
export function sessionNumbers(m: SessionModel): Record<CompareMetric, number> {
  let usage = zero();
  let durationMs = 0;
  let toolCalls = 0;
  let errors = 0;
  const helpers = new Set<string>();
  for (const t of m.turns) {
    usage = addUsage(usage, t.usage ?? zero());
    durationMs += Math.max(0, (t.end || t.ts) - t.ts);
    for (const id of t.actors) if (m.actors[id]?.kind === "helper") helpers.add(id);
    for (const s of t.steps) {
      if (s.kind === "tool") toolCalls++;
      if (s.status === "error") errors++;
    }
  }
  return { requests: m.turns.filter((t) => t.text !== SESSION_START).length, tokens: totalTokens(usage), durationMs, helpers: helpers.size, toolCalls, errors };
}

export function compare(a: SessionModel, b: SessionModel): CompareRow[] {
  const na = sessionNumbers(a);
  const nb = sessionNumbers(b);
  return METRICS.map((metric) => ({
    metric,
    a: na[metric],
    b: nb[metric],
    delta: nb[metric] - na[metric],
    better: na[metric] === nb[metric] ? "same" : na[metric] < nb[metric] ? "a" : "b",
  }));
}

/** Tool calls per tool name, most used first. */
export function topTools(m: SessionModel, n = 10): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of m.turns) for (const s of t.steps) if (s.kind === "tool" && s.tool) counts.set(s.tool, (counts.get(s.tool) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((x, y) => y.count - x.count || x.name.localeCompare(y.name)).slice(0, n);
}

/** The most used tools of either side, with both counts. */
export function compareTools(a: SessionModel, b: SessionModel, n = 10): { name: string; a: number; b: number }[] {
  const ta = new Map(topTools(a, Infinity).map((t) => [t.name, t.count]));
  const tb = new Map(topTools(b, Infinity).map((t) => [t.name, t.count]));
  return [...new Set([...ta.keys(), ...tb.keys()])]
    .map((name) => ({ name, a: ta.get(name) ?? 0, b: tb.get(name) ?? 0 }))
    .sort((x, y) => y.a + y.b - (x.a + x.b) || x.name.localeCompare(y.name))
    .slice(0, n);
}

const modelsOf = (m: SessionModel) => [...new Set(m.turns.flatMap((t) => t.steps.map((s) => s.model)).filter((x): x is string => !!x))];

/** Which models wrote the replies on each side. */
export function compareModels(a: SessionModel, b: SessionModel): { a: string[]; b: string[]; both: string[] } {
  const ma = modelsOf(a);
  const mb = modelsOf(b);
  return { a: ma, b: mb, both: ma.filter((x) => mb.includes(x)) };
}

/** A model holding only request `i`, to compare single requests with the same functions. */
export function scopeToTurn(m: SessionModel, i: number): SessionModel {
  const t = m.turns[i];
  if (!t) return { ...m, turns: [], usage: zero(), hiddenUsage: [] };
  return { ...m, turns: [t], usage: t.usage, meta: { ...m.meta, firstTs: t.ts, lastTs: t.end }, hiddenUsage: (m.hiddenUsage ?? []).filter((h) => h.turn === t.index) };
}
