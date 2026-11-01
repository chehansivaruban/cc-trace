// Self-check for the token statistics, the context gauge, the tips and the cross-session overview.
//   node --no-warnings --experimental-strip-types scripts/stats.check.mts
import assert from "node:assert/strict";
import { buildSession, type AgentLog, type SessionModel, type Step, type Turn, type Usage } from "../src/lib/session.ts";
import { burnSeries, cacheHit, contextGauge, localDay, mergeOverview, modelLabel, sessionDigest, sessionStats } from "../src/lib/analytics/stats.ts";
import { tipsFor } from "../src/lib/analytics/tips.ts";

const t0 = Date.parse("2026-01-01T12:00:00.000Z");
const at = (s: number) => new Date(t0 + s * 1000).toISOString();
const u = (input: number, write: number, read: number, output: number) => ({
  input_tokens: input,
  cache_creation_input_tokens: write,
  cache_read_input_tokens: read,
  output_tokens: output,
});
const OPUS = "claude-opus-5-5";
const HAIKU = "claude-haiku-4-5-20251001";

// ── A two-model session: the lead on Opus, one helper on Haiku, two requests ──
const main = [
  { type: "user", timestamp: at(0), message: { content: "first ask" } },
  // One reply over two records sharing usage: counted once.
  { type: "assistant", timestamp: at(1), message: { id: "m1", model: OPUS, usage: u(100, 1000, 0, 50), stop_reason: "tool_use", content: [{ type: "text", text: "Looking" }] } },
  { type: "assistant", timestamp: at(1), message: { id: "m1", model: OPUS, usage: u(100, 1000, 0, 50), stop_reason: "tool_use", content: [{ type: "tool_use", id: "r1", name: "Read", input: { file_path: "/p/a.ts" } }] } },
  { type: "user", timestamp: at(3), message: { content: [{ type: "tool_result", tool_use_id: "r1", content: "code" }] } },
  { type: "assistant", timestamp: at(4), message: { id: "m2", model: OPUS, usage: u(10, 0, 1100, 20), stop_reason: "tool_use", content: [{ type: "tool_use", id: "ag", name: "Agent", input: { description: "Helper A", prompt: "do it" } }] } },
  { type: "user", timestamp: at(10), message: { content: [{ type: "tool_result", tool_use_id: "ag", content: [{ type: "text", text: "all done\nagentId: h1" }] }] } },
  { type: "assistant", timestamp: at(11), message: { id: "m3", model: OPUS, usage: u(5, 100, 1200, 30), stop_reason: "end_turn", content: [{ type: "text", text: "Done" }] } },
  { type: "user", timestamp: at(20), message: { content: "second ask" } },
  { type: "assistant", timestamp: at(21), message: { id: "m4", model: OPUS, usage: u(1, 50, 1300, 5), stop_reason: "tool_use", content: [{ type: "tool_use", id: "r2", name: "Read", input: { file_path: "/p/a.ts" } }] } },
  { type: "user", timestamp: at(22), message: { content: [{ type: "tool_result", tool_use_id: "r2", content: "code" }] } },
  // Malformed records are skipped, never crash.
  {},
  { type: "assistant" },
  { type: "mystery", timestamp: at(23) },
];
const helper: AgentLog = {
  meta: { description: "Helper A", toolUseId: "ag", model: "haiku" },
  records: [
    { type: "user", isSidechain: true, timestamp: at(5), message: { content: "do it" } },
    { type: "assistant", isSidechain: true, timestamp: at(6), message: { id: "hm1", model: HAIKU, usage: u(20, 500, 0, 40), stop_reason: "tool_use", content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "npm test" } }] } },
    { type: "user", isSidechain: true, timestamp: at(8), message: { content: [{ type: "tool_result", tool_use_id: "b1", is_error: true, content: "1 failed" }] } },
    { type: "assistant", isSidechain: true, timestamp: at(9), message: { id: "hm2", model: HAIKU, usage: u(2, 0, 520, 10), stop_reason: "end_turn", content: [{ type: "text", text: "report" }] } },
  ],
};
const m = buildSession(main as never, { h1: helper }, t0 + 3_600_000);
const U = (fresh: number, cached: number, written: number, input: number, cacheWrite5m: number): Usage => ({ fresh, cached, written, input, cacheWrite5m, cacheWrite1h: 0 });

const s = sessionStats(m);
// Hand-computed: opus = m1+m2+m3+m4, haiku = hm1+hm2.
const opus = U(1100 + 10 + 105 + 51, 0 + 1100 + 1200 + 1300, 50 + 20 + 30 + 5, 116, 1150);
const haiku = U(520 + 2, 520, 50, 22, 500);
assert.deepEqual(s.totals, U(1788, 4120, 155, 138, 1650));
assert.equal(Math.round(s.cacheHitPct * 100) / 100, 69.74); // 4120 / (4120 + 1788)
assert.equal(cacheHit(U(0, 0, 0, 0, 0)), 0);

assert.deepEqual(s.byModel.map((r) => [r.key, r.label, r.usage, r.replies]), [
  [OPUS, "Opus 5.5", opus, 4],
  [HAIKU, "Haiku 4.5", haiku, 2],
]);
assert.equal(s.byModel[1].steps, 2); // Bash + report

assert.deepEqual(s.byAgent.map((r) => [r.key, r.usage, r.toolCalls]), [
  ["lead", opus, 3], // Read, Agent, Read
  ["h1", haiku, 1], // Bash
]);
const h1 = s.byAgent.find((r) => r.key === "h1")!;
assert.equal(h1.label, "Helper A");
assert.equal(h1.durationMs, 5000); // brief at 4s to report at 9s
assert.deepEqual(h1.jumpTo, { turn: 0, step: "ag" });
// Active time adds up per request: the 10 s gap before request 2 doesn't count (1 s → 11 s, then a single step).
assert.equal(s.byAgent[0].durationMs, 10_000);

assert.deepEqual(s.byRequest.map((r) => [r.key, r.label, r.jumpTo]), [
  ["t0", "first ask", { turn: 0 }],
  ["t1", "second ask", { turn: 1 }],
]);
assert.equal(s.byRequest[1].usage.cached, 1300);
assert.equal(s.byRequest[0].durationMs, 11_000);
assert.equal(s.byRequest[0].steps, m.turns[0].steps.filter((x) => x.kind !== "memory").length);

assert.deepEqual(s.tools.map((t) => [t.tool, t.count, t.failed]), [
  ["Read", 2, 0],
  ["Agent", 1, 0],
  ["Bash", 1, 1],
]);
const read = s.tools[0];
assert.equal(read.longest?.id, "r1");
assert.equal(read.longest?.durationMs, 2000);
assert.equal(read.turn, 0);

// Cumulative tokens: ends at the session total; per request it starts from zero.
const burn = burnSeries(m);
assert.equal(burn[0].tokens, 0);
assert.equal(burn.at(-1)!.tokens, 6063);
for (let i = 1; i < burn.length; i++) assert.ok(burn[i].tokens >= burn[i - 1].tokens && burn[i].ts >= burn[i - 1].ts);
assert.deepEqual(burnSeries(m, 1).map((p) => p.tokens), [0, 1356]);
assert.deepEqual(burnSeries(m, 99), []);

// Context gauge: Opus 5.5 has a 1M window.
assert.deepEqual(contextGauge(m.turns[0], m), { used: 1100, window: 1_000_000, pct: 0.11 });
assert.equal(contextGauge(m.turns[1], m).used, 51 + 1300);

assert.equal(modelLabel("claude-sonnet-4-5-20250929"), "Sonnet 4.5");
assert.equal(modelLabel("claude-opus-4-1[1m]"), "Opus 4.1");
assert.equal(modelLabel("claude-fable-5"), "Fable 5");
assert.equal(modelLabel("gpt-x"), "gpt-x");
assert.equal(modelLabel(undefined), "Unknown model");

// Empty and malformed models don't crash.
const empty = buildSession([], {}, t0);
assert.deepEqual(sessionStats(empty).byRequest, []);
assert.deepEqual(burnSeries(empty), []);
console.log("stats checks passed");

// ── Tips: fire at the thresholds, not below ──
const zero = U(0, 0, 0, 0, 0);
function step(p: Partial<Step>): Step {
  return { id: `x${Math.random()}`, kind: "tool", actor: "lead", icon: "tool", title: "", subtitle: "", doing: "", what: "", why: "", ts: t0, seq: 0, ...p } as Step;
}
function fakeTurn(p: Partial<Turn>): [Turn, SessionModel] {
  const t: Turn = { index: 0, text: "x", ts: t0, end: t0, steps: [], actors: ["you", "lead"], usage: zero, context: 0, ...p };
  const model = { actors: m.actors, turns: [t], live: m.live, usage: t.usage, stale: true, meta: { cwds: [], models: [], firstTs: t0, lastTs: t0 }, events: [] } as SessionModel;
  return [t, model];
}
const ids = (t: Turn, mm: SessionModel) => tipsFor(t, mm).map((x) => x.id);
const reads = (n: number, file = "/p/big.ts") => Array.from({ length: n }, () => step({ tool: "Read", input: { file_path: file } }));

// Memory: unknown model -> 200k window; > 70 % fires.
assert.deepEqual(ids(...fakeTurn({ context: 140_001 })), ["memory-full"]);
assert.deepEqual(ids(...fakeTurn({ context: 140_000 })), []);
const memTip = tipsFor(...fakeTurn({ context: 190_000 }))[0];
assert.equal(memTip.severity, "warn");
assert.match(memTip.text, /\/compact/);
assert.match(memTip.text, /\/clear/);
// Same file read 3 times fires, twice doesn't; Windows and POSIX spellings of different files don't merge.
assert.deepEqual(ids(...fakeTurn({ steps: reads(3) })), ["reread:/p/big.ts"]);
assert.deepEqual(ids(...fakeTurn({ steps: reads(2) })), []);
assert.match(tipsFor(...fakeTurn({ steps: reads(4) }))[0].text, /big\.ts.*4 times/);
// Helper briefs over 20k characters.
const brief = (n: number) => step({ id: "bf", kind: "brief", actor: "h1", from: "lead", tool: "Agent", quote: "a".repeat(n) });
assert.deepEqual(ids(...fakeTurn({ steps: [brief(20_001)] })), ["brief:bf"]);
assert.deepEqual(ids(...fakeTurn({ steps: [brief(20_000)] })), []);
// Low cache hit on a long request (>= 100k tokens read), not on a short one.
assert.deepEqual(ids(...fakeTurn({ usage: U(51_000, 49_000, 10, 0, 0) })), ["cache-low"]);
assert.deepEqual(ids(...fakeTurn({ usage: U(50_000, 50_000, 10, 0, 0) })), []);
assert.deepEqual(ids(...fakeTurn({ usage: U(9_000, 1_000, 10, 0, 0) })), []);
// The real fixture is healthy.
assert.deepEqual(tipsFor(m.turns[0], m), []);
console.log("tips checks passed");

// ── Overview across sessions ──
const day = (ts: number) => new Date(ts).toISOString().slice(0, 10); // UTC days keep the check timezone-proof
const d1 = sessionDigest(m, { file: "proj/a.jsonl", project: "proj", title: "first ask" }, day);
assert.deepEqual(Object.keys(d1.days), ["2026-01-01"]);
assert.equal(d1.lastTs, t0 + 23_000); // the last record with a timestamp
const late = buildSession(
  [
    { type: "user", timestamp: "2026-01-03T09:00:00.000Z", message: { content: "later" } },
    { type: "assistant", timestamp: "2026-01-03T09:00:01.000Z", message: { id: "z1", model: HAIKU, usage: u(1, 0, 9, 0), stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] } },
  ],
  {},
  t0,
);
const d2 = sessionDigest(late, { file: "other/b.jsonl", project: "other", title: "later" }, day);
const now = Date.parse("2026-01-03T18:00:00.000Z");
const ov = mergeOverview([d1, d2], { days: 3, now, projects: { proj: "/p", other: "/o" } }, day);
assert.deepEqual(ov.days, [
  { date: "2026-01-01", tokens: 6063, sessions: 1 },
  { date: "2026-01-02", tokens: 0, sessions: 0 },
  { date: "2026-01-03", tokens: 10, sessions: 1 },
]);
assert.equal(ov.totals.cached, 4120 + 9);
assert.deepEqual(ov.byModel.map((r) => [r.key, r.replies]), [[OPUS, 4], [HAIKU, 3]]);
assert.deepEqual(ov.byProject.map((r) => [r.key, r.label, r.sessions, r.file]), [["proj", "/p", 1, "proj/a.jsonl"], ["other", "/o", 1, "other/b.jsonl"]]);
assert.deepEqual(ov.tools.map((t) => [t.tool, t.count, t.failed]), [["Read", 2, 0], ["Agent", 1, 0], ["Bash", 1, 1]]);
assert.deepEqual(ov.sessions.map((x) => x.file), ["proj/a.jsonl", "other/b.jsonl"]);
// A 1-day window keeps only today's work.
const today = mergeOverview([d1, d2], { days: 1, now, projects: {} }, day);
assert.equal(totalOf(today.totals), 10);
assert.deepEqual(today.byProject.map((r) => [r.key, r.label]), [["other", "other"]]);
assert.equal(localDay(Date.parse("2026-03-04T12:00:00")), "2026-03-04");
function totalOf(x: Usage) {
  return x.fresh + x.cached + x.written;
}
console.log("overview checks passed");

// ── Performance: a 50k-step session ──
{
  const N = 50_000;
  const turns: Turn[] = [];
  const actors = { ...m.actors };
  for (let k = 0; k < 20; k++) actors[`g${k}`] = { ...m.actors.h1, id: `g${k}`, name: `Gen ${k}` };
  for (let i = 0; i < N; i++) {
    const ti = Math.floor(i / 250);
    if (!turns[ti]) turns[ti] = { index: ti, text: `ask ${ti}`, ts: t0 + i * 1000, end: 0, steps: [], actors: ["you", "lead"], usage: zero, context: 50_000 + ti };
    const actor = i % 3 ? "lead" : `g${i % 20}`;
    turns[ti].steps.push(
      step({ id: `s${i}`, seq: i, ts: t0 + i * 1000, actor, tool: ["Read", "Bash", "Edit", "Grep"][i % 4], status: i % 17 ? "success" : "error", durationMs: i % 900,
        input: { file_path: `/p/f${i % 300}.ts` }, model: i % 2 ? OPUS : HAIKU, usage: i % 2 ? U(10, 1000, 20, 10, 0) : undefined }),
    );
    turns[ti].end = t0 + i * 1000;
  }
  const big = { actors, turns, live: m.live, usage: zero, stale: true, meta: { cwds: [], models: [OPUS], firstTs: t0, lastTs: t0 + N * 1000 }, events: [] } as SessionModel;
  const start = performance.now();
  const bs = sessionStats(big);
  const series = burnSeries(big);
  const ms = performance.now() - start;
  assert.equal(bs.byRequest.length, 200);
  assert.equal(series.length, N / 2 + 1);
  assert.ok(ms < 1000, `sessionStats + burnSeries on ${N} steps took ${ms.toFixed(0)} ms`);
  const tipStart = performance.now();
  for (const t of turns) tipsFor(t, big);
  assert.ok(performance.now() - tipStart < 1000, "tips for every request under 1 s");
  console.log(`performance check passed (${N} steps in ${ms.toFixed(0)} ms)`);
}
