// Self-check for the token statistics, the context gauge, the tips and the cross-session overview.
//   node --no-warnings --experimental-strip-types scripts/stats.check.mts
import assert from "node:assert/strict";
import { buildSession, type AgentLog, type SessionModel, type Step, type Turn, type Usage } from "../src/lib/session.ts";
import { burnSeries, cacheHit, contextGauge, localDay, mergeOverview, modelLabel, sessionDigest, sessionStats, tooBigForOverview } from "../src/lib/analytics/stats.ts";
import { tipsFor } from "../src/lib/analytics/tips.ts";
import { scopeToTurn } from "../src/lib/analytics/compare.ts";
import { assignSlots, foldSlices } from "../src/components/charts/slots.ts";

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
// Not "/p/...": the shared path normaliser reads a one-letter top folder as a Git Bash drive (P:).
const reads = (n: number, file = "/proj/big.ts") => Array.from({ length: n }, () => step({ tool: "Read", input: { file_path: file } }));

// Memory: unknown model -> 200k window; > 70 % fires.
assert.deepEqual(ids(...fakeTurn({ context: 140_001 })), ["memory-full"]);
assert.deepEqual(ids(...fakeTurn({ context: 140_000 })), []);
const memTip = tipsFor(...fakeTurn({ context: 190_000 }))[0];
assert.equal(memTip.severity, "warn");
assert.match(memTip.text, /\/compact/);
assert.match(memTip.text, /\/clear/);
// Same file read 3 times fires, twice doesn't; Windows and POSIX spellings of different files don't merge.
assert.deepEqual(ids(...fakeTurn({ steps: reads(3) })), ["reread:/proj/big.ts"]);
assert.deepEqual(ids(...fakeTurn({ steps: reads(2) })), []);
assert.match(tipsFor(...fakeTurn({ steps: reads(4) }))[0].text, /big\.ts.*4 times/);
// Windows paths: separators and case don't matter, so these are one file read 3 times.
assert.deepEqual(ids(...fakeTurn({ steps: [...reads(1, "C:\\Proj\\Big.ts"), ...reads(1, "c:/proj/big.ts"), ...reads(1, "C:/Proj/BIG.ts")] })), ["reread:c:/proj/big.ts"]);
// POSIX paths are case-sensitive: three different files.
assert.deepEqual(ids(...fakeTurn({ steps: [...reads(1, "/proj/Big.ts"), ...reads(1, "/proj/big.ts"), ...reads(1, "/proj/BIG.ts")] })), []);
// "/proj//big.ts" and "/proj/./big.ts" are the same file.
assert.deepEqual(ids(...fakeTurn({ steps: [...reads(1, "/proj//big.ts"), ...reads(1, "/proj/./big.ts"), ...reads(1)] })), ["reread:/proj/big.ts"]);
// Reading a big file in chunks (offset/limit) isn't re-reading it.
const chunk = (offset: number) => step({ tool: "Read", input: { file_path: "/p/big.ts", offset, limit: 200 } });
assert.deepEqual(ids(...fakeTurn({ steps: [chunk(1), chunk(201), chunk(401)] })), []);
assert.deepEqual(ids(...fakeTurn({ steps: [...reads(2), chunk(1), chunk(201)] })), []);
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
// Logs too big to read whole (a string tops out near 512 MB) are skipped, and the overview says so.
assert.equal(tooBigForOverview([10, 299 * 1024 * 1024]), false);
assert.equal(tooBigForOverview([10, 301 * 1024 * 1024]), true, "a big helper log counts too");
assert.equal(tooBigForOverview([]), false);
const today = mergeOverview([d1, d2], { days: 1, now, projects: {} }, day);
assert.equal(totalOf(today.totals), 10);
assert.deepEqual(today.byProject.map((r) => [r.key, r.label]), [["other", "other"]]);
assert.equal(localDay(Date.parse("2026-03-04T12:00:00")), "2026-03-04");
function totalOf(x: Usage) {
  return x.fresh + x.cached + x.written;
}
// Replies with only thinking (no step) still count, in Stats and on the Dashboard alike.
{
  const thinkOnly = (id: string, sec: number, usage: object, model = OPUS) => ({
    type: "assistant", timestamp: at(sec), message: { id, model, usage, stop_reason: null, content: [{ type: "thinking", thinking: "hmm" }] },
  });
  // One model: the leftover belongs to it.
  const single = buildSession(
    [
      { type: "user", timestamp: at(0), message: { content: "think" } },
      thinkOnly("k1", 1, u(3, 0, 500, 9)),
      { type: "assistant", timestamp: at(2), message: { id: "k2", model: OPUS, usage: u(1, 0, 510, 4), stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] } },
    ] as never,
    {},
    t0,
  );
  const st = sessionStats(single);
  assert.equal(totalOf(st.totals), 512 + 515);
  assert.deepEqual(st.byModel.map((r) => [r.key, totalOf(r.usage)]), [[OPUS, 1027]]);
  const ov1 = mergeOverview([sessionDigest(single, { file: "p/s.jsonl", project: "p", title: "think" }, day)], { days: 1, now: t0, projects: {} }, day);
  assert.deepEqual(ov1.totals, st.totals);
  assert.equal(ov1.days[0].tokens, 1027);
  assert.deepEqual(ov1.byModel.map((r) => [r.key, totalOf(r.usage)]), [[OPUS, 1027]]);
  // Several models: the session remembers which model wrote the thinking-only reply, so it's credited to it
  // (not "Unknown model"), in both places.
  const multi = buildSession([...main, thinkOnly("m9", 12, u(0, 0, 100, 7), HAIKU)] as never, { h1: helper }, t0 + 3_600_000);
  assert.deepEqual(multi.hiddenUsage?.map((h) => [h.model, h.turn, totalOf(h.usage)]), [[HAIKU, 0, 107]]);
  const sm = sessionStats(multi);
  const om = mergeOverview([sessionDigest(multi, { file: "p/m.jsonl", project: "p", title: "x" }, day)], { days: 1, now: t0, projects: {} }, day);
  assert.deepEqual(om.totals, sm.totals);
  assert.equal(totalOf(sm.totals), 6063 + 107);
  assert.deepEqual(sm.byModel.map((r) => [r.key, totalOf(r.usage)]), om.byModel.map((r) => [r.key, totalOf(r.usage)]));
  assert.equal(sm.byModel.find((r) => r.key === "unknown"), undefined, "no Unknown model row");
  const haikuShown = buildSession(main as never, { h1: helper }, t0 + 3_600_000);
  const before = totalOf(sessionStats(haikuShown).byModel.find((r) => r.key === HAIKU)?.usage ?? { fresh: 0, cached: 0, written: 0, input: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
  assert.equal(totalOf(sm.byModel.find((r) => r.key === HAIKU)!.usage), before + 107);
  // A request on its own (Compare, exports) only carries its own hidden replies.
  assert.deepEqual(scopeToTurn(multi, 1).hiddenUsage, []);
  assert.equal(scopeToTurn(multi, 0).hiddenUsage?.length, 1);
  // A reply with no model at all still falls back to "unknown".
  const noModel = buildSession(
    [...main, { type: "assistant", timestamp: at(12), message: { id: "m8", usage: u(0, 0, 100, 7), stop_reason: null, content: [{ type: "thinking", thinking: "hmm" }] } }] as never,
    { h1: helper },
    t0 + 3_600_000,
  );
  assert.equal(totalOf(sessionStats(noModel).byModel.find((r) => r.key === "unknown")!.usage), 107);
}
console.log("overview checks passed");

// ── Chart colour slots: colour follows the entity ──
assert.deepEqual(assignSlots([], ["b", "a"], 6), ["b", "a"]);
assert.deepEqual(assignSlots(["b", "a"], ["a", "c"], 6), ["b", "a", "c"]); // a keeps slot 2, c takes the next one
assert.deepEqual(assignSlots(["a", "b"], ["c", "d"], 3), ["a", "b", "c"]); // out of slots: d gets none
const known = ["a"];
assert.equal(assignSlots(known, ["a"], 6), known, "unchanged list is returned as is (no re-render loop)");
const folded = foldSlices([1, 2, 3, 4, 5, 6, 7].map((v) => ({ key: `k${v}`, label: `k${v}`, value: v })));
assert.deepEqual(folded.shown.map((x) => x.key), ["k7", "k6", "k5", "k4", "k3"]);
assert.deepEqual(folded.folded.map((x) => x.key), ["k2", "k1"]);
assert.equal(foldSlices([{ key: "a", label: "a", value: 0 }, { key: "b", label: "b", value: 2 }]).shown.length, 1);
console.log("colour slot checks passed");

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
