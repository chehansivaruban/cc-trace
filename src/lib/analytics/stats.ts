// Token statistics for one session (Stats view) and across sessions (Dashboard). Pure functions, O(steps).
// Token counts only: cc-trace never shows prices or costs.
import { contextWindow } from "../models.ts";
import { isFailed, totalTokens, type SessionModel, type Step, type Turn, type Usage } from "../session.ts";
import { safeClip } from "../redact.ts";

export type Row = {
  key: string;
  label: string;
  usage: Usage;
  steps: number;
  durationMs: number;
  jumpTo?: { turn: number; step?: string };
  /** Claude's replies counted in this row (each reply carries one usage record). */
  replies?: number;
  /** Tool uses (incl. briefs and messages to other agents). */
  toolCalls?: number;
  /** Overview rows: sessions that contributed, and the newest one to open. */
  sessions?: number;
  file?: string;
};

export type ToolRow = { tool: string; count: number; failed: number; longest?: Step; /** request (0-based) of the longest call */ turn?: number };

export type SessionStats = {
  totals: Usage;
  cacheHitPct: number;
  byModel: Row[];
  byAgent: Row[];
  byRequest: Row[];
  tools: ToolRow[];
};

export const ZERO: Usage = Object.freeze({ fresh: 0, cached: 0, written: 0, input: 0, cacheWrite5m: 0, cacheWrite1h: 0 });

/** Share of what Claude read that came from its cache, 0–100. */
export function cacheHit(u: Usage): number {
  const read = u.fresh + u.cached;
  return read ? (u.cached / read) * 100 : 0;
}

/** "claude-opus-4-5-20251101" -> "Opus 4.5"; anything unrecognised is shown as is. */
export function modelLabel(id?: string): string {
  if (!id) return "Unknown model";
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[.*\])?$/i.exec(id);
  if (!m) return id;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

/** Who did a step: the sender for messages, else its lane. */
const doer = (s: Step) => s.from ?? s.actor;
/** Synthetic error replies have no model and no tokens: nothing to show. */
const worthShowing = (r: Row) => r.key !== "unknown" || totalTokens(r.usage) > 0;
const byTokens = (a: Row, b: Row) => totalTokens(b.usage) - totalTokens(a.usage) || a.label.localeCompare(b.label);
const sub = (a: Usage, b: Usage): Usage => ({
  fresh: a.fresh - b.fresh,
  cached: a.cached - b.cached,
  written: a.written - b.written,
  input: a.input - b.input,
  cacheWrite5m: a.cacheWrite5m - b.cacheWrite5m,
  cacheWrite1h: a.cacheWrite1h - b.cacheWrite1h,
});
// Adds in place: Usage objects in the model are shared, so only ever mutate our own copies.
function addInto(a: Usage, b: Usage) {
  a.fresh += b.fresh;
  a.cached += b.cached;
  a.written += b.written;
  a.input += b.input;
  a.cacheWrite5m += b.cacheWrite5m;
  a.cacheWrite1h += b.cacheWrite1h;
}
/** Who to credit for tokens no step carries: the session's only model, else "unknown". */
const leftoverModel = (m: SessionModel) => (m.meta.models.length === 1 ? m.meta.models[0] : "unknown");
const row = (key: string, label: string): Row => ({ key, label, usage: { ...ZERO }, steps: 0, durationMs: 0, replies: 0, toolCalls: 0 });
// Cut at a word boundary: the page masks labels afterwards, and a key cut in half wouldn't be recognised.
const clip = (s: string, n = 90) => safeClip(s.replace(/\s+/g, " ").trim(), n);

export function sessionStats(m: SessionModel): SessionStats {
  const models = new Map<string, Row>();
  const agents = new Map<string, Row>();
  const spans = new Map<string, { first: number; last: number }>();
  const tools = new Map<string, ToolRow>();
  const byRequest: Row[] = [];
  const attributed = { ...ZERO };

  for (const id of Object.keys(m.actors)) {
    const a = m.actors[id];
    if (a.kind === "you") continue;
    agents.set(id, { ...row(id, a.name), usage: { ...a.usage } });
    spans.set(id, { first: Infinity, last: -Infinity });
  }

  // Active time per agent: its first-to-last activity within each request, summed, so days between requests don't count.
  const seen = (a: Row, ts: number) => {
    const sp = spans.get(a.key)!;
    sp.first = Math.min(sp.first, ts);
    sp.last = Math.max(sp.last, ts);
  };
  const closeSpans = () => {
    for (const [id, sp] of spans) {
      if (sp.last > sp.first) agents.get(id)!.durationMs += sp.last - sp.first;
      sp.first = Infinity;
      sp.last = -Infinity;
    }
  };

  for (const t of m.turns) {
    closeSpans();
    const req = row(`t${t.index}`, clip(t.text));
    req.usage = { ...t.usage };
    req.durationMs = Math.max(0, t.end - t.ts);
    req.jumpTo = { turn: t.index };
    for (const s of t.steps) {
      if (s.kind === "memory") continue;
      req.steps++;
      if (s.tool) req.toolCalls!++;
      if (s.usage) req.replies!++;

      if (s.model || s.usage) {
        const key = s.model ?? "unknown";
        let r = models.get(key);
        if (!r) models.set(key, (r = row(key, modelLabel(s.model))));
        r.steps++;
        if (s.tool) r.toolCalls!++;
        if (s.durationMs) r.durationMs += s.durationMs;
        if (s.usage) {
          r.replies!++;
          addInto(r.usage, s.usage);
          addInto(attributed, s.usage);
        }
      }

      const who = doer(s);
      const a = agents.get(who);
      if (a) {
        a.steps++;
        if (s.tool) a.toolCalls!++;
        if (s.usage) a.replies!++;
        seen(a, s.ts);
        a.jumpTo ??= { turn: t.index };
      }
      // A helper's work starts when it receives its brief.
      const lane = s.actor !== who ? agents.get(s.actor) : undefined;
      if (lane && s.from) {
        seen(lane, s.ts);
        if (s.kind === "brief" && !lane.jumpTo?.step) lane.jumpTo = { turn: t.index, step: s.id };
      }

      if (s.tool) {
        let tr = tools.get(s.tool);
        if (!tr) tools.set(s.tool, (tr = { tool: s.tool, count: 0, failed: 0 }));
        tr.count++;
        if (isFailed(s)) tr.failed++;
        if (s.durationMs !== undefined && s.durationMs > (tr.longest?.durationMs ?? -1)) {
          tr.longest = s;
          tr.turn = t.index;
        }
      }
    }
    byRequest.push(req);
  }
  closeSpans();

  // Replies with nothing to show (e.g. only thinking) still used tokens: credit the model that wrote them,
  // and anything left (older models without that record) to the session's only model, else "unknown".
  for (const h of m.hiddenUsage ?? []) {
    const key = h.model ?? "unknown";
    let r = models.get(key);
    if (!r) models.set(key, (r = row(key, modelLabel(h.model))));
    addInto(r.usage, h.usage);
    addInto(attributed, h.usage);
  }
  const rest = sub(m.usage, attributed);
  if (totalTokens(rest) > 0) {
    const key = leftoverModel(m);
    let r = models.get(key);
    if (!r) models.set(key, (r = row(key, modelLabel(key === "unknown" ? undefined : key))));
    addInto(r.usage, rest);
  }

  const byAgent = [...agents.values()].filter((a) => a.steps || totalTokens(a.usage));

  return {
    totals: { ...m.usage },
    cacheHitPct: cacheHit(m.usage),
    byModel: [...models.values()].filter(worthShowing).sort(byTokens),
    byAgent: byAgent.sort(byTokens),
    byRequest,
    tools: [...tools.values()].sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool)),
  };
}

/** Cumulative tokens after each of Claude's replies, starting from 0: the whole session, or one request. */
/** A point on the cumulative chart; `turn` and `step` say which reply it came from (absent on the starting 0). */
export type BurnPoint = { ts: number; tokens: number; turn?: number; step?: string };

export function burnSeries(m: SessionModel, turn?: number): BurnPoint[] {
  const turns = turn === undefined ? m.turns : m.turns[turn] ? [m.turns[turn]] : [];
  const out: BurnPoint[] = [];
  // Replies with a step, plus replies with nothing to show (hiddenUsage), merged in time order, so the last
  // point is the same total as the Tokens card.
  const wanted = new Set(turns.map((t) => t.index));
  const hidden = (m.hiddenUsage ?? [])
    .filter((x) => wanted.has(x.turn))
    .map((x) => ({ ...x, ts: x.ts || m.turns[x.turn]?.ts || 0 })) // a record without a time sits at its request's start
    .sort((a, b) => a.ts - b.ts);
  let h = 0;
  let acc = 0;
  const start = (ts: number, t: Turn) => {
    if (!out.length) out.push({ ts: Math.min(t.ts, ts), tokens: 0 });
  };
  const hiddenUpTo = (ts: number) => {
    for (; h < hidden.length && hidden[h].ts <= ts; h++) {
      const x = hidden[h];
      const t = m.turns[x.turn];
      if (t) start(x.ts, t);
      acc += totalTokens(x.usage);
      out.push({ ts: x.ts, tokens: acc, turn: x.turn });
    }
  };
  for (const t of turns) {
    for (const s of t.steps) {
      if (!s.usage) continue;
      hiddenUpTo(s.ts - 1);
      start(s.ts, t);
      acc += totalTokens(s.usage);
      out.push({ ts: s.ts, tokens: acc, turn: t.index, step: s.id });
    }
  }
  hiddenUpTo(Infinity);
  return out;
}

/** The model Claude (the lead) used for a request, falling back to the session's first model. */
export function turnModel(turn: Turn, m: SessionModel): string | undefined {
  for (const s of turn.steps) if (s.model && doer(s) === "lead") return s.model;
  for (const s of turn.steps) if (s.model) return s.model;
  return m.meta.models[0];
}

/** How full Claude's working memory was when it started on this request. */
export function contextGauge(turn: Turn, m: SessionModel): { used: number; window: number; pct: number } {
  const used = turn.context;
  let window = contextWindow(turnModel(turn, m));
  // More than the listed window means Claude Code asked for the 1M one.
  if (used > window && window < 1_000_000) window = 1_000_000;
  return { used, window, pct: Math.round((used / window) * 10_000) / 100 };
}

// ── Across sessions ──

type Bucket = { usage: Usage; replies: number; steps: number; toolCalls: number };
export type DayDigest = { bucket: Bucket; byModel: Record<string, Bucket>; tools: Record<string, { count: number; failed: number }> };
/** What the dashboard keeps per session: numbers per day, no log text except the title. */
// The overview reads each log whole, and a JS string tops out near 512 MB: bigger sessions are skipped.
export const OVERVIEW_MAX_LOG_BYTES = 300 * 1024 * 1024;
/** True when any of a session's logs (main and helpers, by size in bytes) is too big for the overview. */
export const tooBigForOverview = (sizes: readonly number[]) => sizes.some((n) => n > OVERVIEW_MAX_LOG_BYTES);

export type SessionDigest = { file: string; project: string; title: string; lastTs: number; days: Record<string, DayDigest> };

const pad = (n: number) => String(n).padStart(2, "0");
/** "YYYY-MM-DD" in this computer's time zone. */
export const localDay = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const bucket = (): Bucket => ({ usage: { ...ZERO }, replies: 0, steps: 0, toolCalls: 0 });

export function sessionDigest(m: SessionModel, info: { file: string; project: string; title: string }, dayKey = localDay): SessionDigest {
  const days: Record<string, DayDigest> = {};
  let lastTs = m.meta.lastTs;
  for (const t of m.turns) {
    for (const s of t.steps) {
      if (s.kind === "memory" || !s.ts) continue;
      lastTs = Math.max(lastTs, s.ts);
      const key = dayKey(s.ts);
      const d = (days[key] ??= { bucket: bucket(), byModel: {}, tools: {} });
      d.bucket.steps++;
      if (s.tool) {
        d.bucket.toolCalls++;
        const tr = (d.tools[s.tool] ??= { count: 0, failed: 0 });
        tr.count++;
        if (isFailed(s)) tr.failed++;
      }
      if (s.model || s.usage) {
        const b = (d.byModel[s.model ?? "unknown"] ??= bucket());
        b.steps++;
        if (s.tool) b.toolCalls++;
        if (s.usage) {
          b.replies++;
          addInto(b.usage, s.usage);
        }
      }
      if (s.usage) {
        d.bucket.replies++;
        addInto(d.bucket.usage, s.usage);
      }
    }
  }
  // Same hidden replies and leftover as in sessionStats, so the Dashboard and Stats agree: hidden replies on
  // their own day and model, anything left on the session's last day.
  for (const h of m.hiddenUsage ?? []) {
    if (!h.ts) continue;
    const d = (days[dayKey(h.ts)] ??= { bucket: bucket(), byModel: {}, tools: {} });
    addInto(d.bucket.usage, h.usage);
    addInto((d.byModel[h.model ?? "unknown"] ??= bucket()).usage, h.usage);
  }
  const attributed = { ...ZERO };
  for (const d of Object.values(days)) addInto(attributed, d.bucket.usage);
  const rest = sub(m.usage, attributed);
  if (totalTokens(rest) > 0 && lastTs) {
    const d = (days[dayKey(lastTs)] ??= { bucket: bucket(), byModel: {}, tools: {} });
    addInto(d.bucket.usage, rest);
    addInto((d.byModel[leftoverModel(m)] ??= bucket()).usage, rest);
  }
  return { ...info, lastTs, days };
}

export type OverviewSession = { file: string; project: string; title: string; tokens: number; lastTs: number };
export type Overview = {
  days: { date: string; tokens: number; sessions: number }[];
  byModel: Row[];
  byProject: Row[];
  tools: { tool: string; count: number; failed: number }[];
  totals: Usage;
  /** Sessions with work in the window, most tokens first. */
  sessions: OverviewSession[];
};

/** The last `days` calendar days, oldest first, as "YYYY-MM-DD" (pure date arithmetic, no time zone). */
function dayRange(today: string, days: number) {
  const [y, mo, d] = today.split("-").map(Number);
  return Array.from({ length: days }, (_, i) => new Date(Date.UTC(y, mo - 1, d - (days - 1 - i))).toISOString().slice(0, 10));
}

export function mergeOverview(
  digests: SessionDigest[],
  opts: { days: number; now: number; projects: Record<string, string> },
  dayKey = localDay,
): Overview {
  const range = dayRange(dayKey(opts.now), opts.days);
  const first = range[0];
  const last = range.at(-1)!;
  const perDay = new Map(range.map((date) => [date, { date, tokens: 0, sessions: 0 }]));
  const models = new Map<string, Row>();
  const projects = new Map<string, Row>();
  const newest = new Map<string, number>();
  const tools = new Map<string, { tool: string; count: number; failed: number }>();
  const totals = { ...ZERO };
  const sessions: OverviewSession[] = [];

  for (const dg of digests) {
    let tokens = 0;
    let used = false;
    const sessionUsage = { ...ZERO };
    let steps = 0;
    for (const [date, d] of Object.entries(dg.days)) {
      if (date < first || date > last) continue;
      used = true;
      const day = perDay.get(date)!;
      const t = totalTokens(d.bucket.usage);
      day.tokens += t;
      day.sessions++;
      tokens += t;
      steps += d.bucket.steps;
      addInto(sessionUsage, d.bucket.usage);
      for (const [model, b] of Object.entries(d.byModel)) {
        let r = models.get(model);
        if (!r) models.set(model, (r = row(model, modelLabel(model === "unknown" ? undefined : model))));
        addInto(r.usage, b.usage);
        r.steps += b.steps;
        r.replies! += b.replies;
        r.toolCalls! += b.toolCalls;
      }
      for (const [tool, c] of Object.entries(d.tools)) {
        const tr = tools.get(tool) ?? { tool, count: 0, failed: 0 };
        tr.count += c.count;
        tr.failed += c.failed;
        tools.set(tool, tr);
      }
    }
    if (!used) continue;
    addInto(totals, sessionUsage);
    sessions.push({ file: dg.file, project: dg.project, title: dg.title, tokens, lastTs: dg.lastTs });
    let p = projects.get(dg.project);
    if (!p) projects.set(dg.project, (p = { ...row(dg.project, opts.projects[dg.project] ?? dg.project), sessions: 0 }));
    addInto(p.usage, sessionUsage);
    p.steps += steps;
    p.sessions!++;
    if (dg.lastTs > (newest.get(dg.project) ?? -Infinity)) {
      newest.set(dg.project, dg.lastTs);
      p.file = dg.file;
    }
  }

  return {
    days: range.map((d) => perDay.get(d)!),
    byModel: [...models.values()].filter(worthShowing).sort(byTokens),
    byProject: [...projects.values()].sort(byTokens),
    tools: [...tools.values()].sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool)),
    totals,
    sessions: sessions.sort((a, b) => b.tokens - a.tokens || b.lastTs - a.lastTs),
  };
}

