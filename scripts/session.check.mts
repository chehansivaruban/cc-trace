// Self-check for the log -> session story mapping.
//   node --experimental-strip-types scripts/session.check.mts            built-in cases
//   node --experimental-strip-types scripts/session.check.mts --all      also every real session in ~/.claude/projects
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addUsage, buildSession, totalTokens, type AgentLog, type LogRecord, type SessionModel, type Usage } from "../src/lib/session.ts";
import { burnSeries, contextGauge, sessionDigest, sessionStats } from "../src/lib/analytics/stats.ts";
import { agentChat, agentTree, tasksOf, teamsOf, type AgentNode } from "../src/lib/analytics/agents.ts";
import { compare } from "../src/lib/analytics/compare.ts";
import { healthReport } from "../src/lib/analytics/health.ts";
import { sessionStory, storyOf } from "../src/lib/analytics/story.ts";
import { filesTouched } from "../src/lib/analytics/files.ts";
import { hookRuns } from "../src/lib/analytics/hooks.ts";
import { phasesOf } from "../src/lib/analytics/phases.ts";
import { tipsFor } from "../src/lib/analytics/tips.ts";
import { riskOf } from "../src/lib/analytics/risk.ts";
import { filterOptions } from "../src/lib/analytics/filters.ts";
import { conversationRows } from "../src/lib/conversation.ts";
import { needsAttention } from "../src/lib/attention.ts";
import { contextWindow } from "../src/lib/models.ts";
import { maskSecrets } from "../src/lib/redact.ts";

const t0 = Date.parse("2026-01-01T00:00:00.000Z");
const at = (s: number) => new Date(t0 + s * 1000).toISOString();
const now = t0 + 60_000;
const usage = { input_tokens: 10, cache_creation_input_tokens: 90, cache_read_input_tokens: 1000, output_tokens: 50 };

const main = [
  { type: "user", timestamp: at(0), message: { content: [{ type: "text", text: "<ide_opened_file>x</ide_opened_file>" }, { type: "text", text: "fix the bug" }] } },
  // One reply split over two records that share its usage: must be counted once.
  { type: "assistant", timestamp: at(1), message: { id: "m1", usage, stop_reason: "tool_use", content: [{ type: "text", text: "Let me look." }] } },
  { type: "assistant", timestamp: at(1), message: { id: "m1", usage, stop_reason: "tool_use", content: [{ type: "tool_use", id: "r1", name: "Read", input: { file_path: "/a/src/auth.ts" } }] } },
  { type: "user", timestamp: at(2), message: { content: [{ type: "tool_result", tool_use_id: "r1", content: "code" }] } },
  { type: "assistant", timestamp: at(3), message: { id: "m2", stop_reason: "tool_use", content: [{ type: "tool_use", id: "ag", name: "Agent", input: { description: "Fix login", prompt: "Fix the redirect", run_in_background: true } }] } },
  { type: "user", timestamp: at(3), message: { content: [{ type: "tool_result", tool_use_id: "ag", content: [{ type: "text", text: "Async agent launched successfully.\nagentId: h1" }] }] } },
  { type: "assistant", timestamp: at(9), message: { id: "m3", stop_reason: "tool_use", content: [{ type: "tool_use", id: "sm", name: "SendMessage", input: { to: "h1", message: "Also handle expiry" } }] } },
  { type: "user", timestamp: at(9), message: { content: [{ type: "tool_result", tool_use_id: "sm", content: "sent" }] } },
  { type: "assistant", timestamp: at(12), message: { id: "m4", stop_reason: "end_turn", content: [{ type: "text", text: "Fixed it." }] } },
  { type: "user", timestamp: at(20), message: { content: "thanks, now add a test" } },
];
const helper: AgentLog = {
  meta: { description: "Fix login", toolUseId: "ag", agentType: "general-purpose", model: "sonnet" },
  records: [
    { type: "user", isSidechain: true, timestamp: at(4), message: { content: "Fix the redirect" } },
    { type: "assistant", isSidechain: true, timestamp: at(5), message: { id: "h-m1", usage, stop_reason: "tool_use", content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "npm test", description: "Run tests" } }] } },
    { type: "user", isSidechain: true, timestamp: at(6), message: { content: [{ type: "tool_result", tool_use_id: "b1", is_error: true, content: "1 failed" }] } },
    { type: "assistant", isSidechain: true, timestamp: at(7), message: { id: "h-m2", stop_reason: "tool_use", content: [{ type: "tool_use", id: "hb", name: "SubagentHandback", input: { message: "Done, tests pass" } }] } },
  ],
};

let m = buildSession(main, { h1: helper }, now);
assert.equal(m.turns.length, 2);
const [t1, t2] = m.turns;
assert.equal(t1.text, "fix the bug");
assert.deepEqual(t1.actors, ["you", "lead", "h1"]);
const kinds = t1.steps.map((s) => `${s.kind}:${s.from ?? ""}>${s.actor}`);
assert.deepEqual(kinds, [
  "prompt:>you",
  "note:>lead",
  "tool:>lead",
  "brief:lead>h1",
  "tool:>h1",
  "report:h1>lead",
  "message:lead>h1",
  "reply:lead>you",
]);
const read = t1.steps.find((s) => s.tool === "Read")!;
assert.equal(read.title, "Reads a file");
assert.equal(read.subtitle, "auth.ts");
assert.equal(read.status, "success");
const test = t1.steps.find((s) => s.tool === "Bash")!;
assert.equal(test.title, "Runs the tests");
assert.equal(test.status, "error");
assert.equal(m.actors.h1.name, "Fix login");
assert.equal(m.actors.h1.parent, "lead");
assert.equal(m.actors.h1.role, "helper · sonnet");
// m1 counted once, plus the helper's reply.
assert.deepEqual(t1.usage, { fresh: 200, cached: 2000, written: 100, input: 20, cacheWrite5m: 180, cacheWrite1h: 0 });
assert.deepEqual(m.actors.lead.usage, { fresh: 100, cached: 1000, written: 50, input: 10, cacheWrite5m: 90, cacheWrite1h: 0 });
assert.equal(t2.steps[0].kind, "prompt");
// Request 2 starts with what Claude carried over from request 1.
assert.equal(t2.steps[1].kind, "memory");
assert.deepEqual(t2.steps[1].memory, { from: 0, to: 0, summarized: false, tokens: 0 });
assert.equal(t1.context, 1100); // input side of Claude's first reply in request 1
// The helper got a follow-up after its report, so it's working again until it reports.
assert.equal(m.actors.h1.state, "working");
assert.equal(m.live.active, true);
assert.match(m.live.sentence, /thinking/);

// A background helper that failed shows up from the lead's notification.
const failed = [...main.slice(0, 6), { type: "user", timestamp: at(8), origin: { kind: "task-notification" }, message: { content: "<task-notification>\n<task-id>h1</task-id>\n<status>failed</status>\n<summary>hit a usage limit</summary>\n</task-notification>" } }];
m = buildSession(failed, { h1: { ...helper, records: helper.records.slice(0, 3) } }, now);
assert.equal(m.actors.h1.state, "failed");
assert.ok(m.turns[0].steps.some((s) => s.title === "Stopped early" && s.quote === "hit a usage limit"));

// Stale sessions are not "live".
assert.equal(buildSession(main, { h1: helper }, now + 10 * 60_000).live.active, false);

// Richer model: tokens per reply, session details, timings, thinking, images and system events.
const tok = { input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 1_000_000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } };
const toolUseResult = { stdout: "a.log", stderr: "", interrupted: false };
const rich = [
  { type: "custom-title", customTitle: "cc-trace tool setup", sessionId: "x" },
  { type: "ai-title", aiTitle: "Set up the tool", sessionId: "x" },
  // Real logs: the mode is on your messages ("permissionMode"); "mode" records only ever say "normal".
  { type: "mode", mode: "normal", sessionId: "x" },
  { type: "attachment", timestamp: at(0), cwd: "/p/app", attachment: { type: "hook_non_blocking_error", hookName: "Stop", hookEvent: "Stop", exitCode: 1, stderr: "boom", command: "notify" } },
  { type: "user", timestamp: at(0), cwd: "/p/app", gitBranch: "main", version: "2.1.309", entrypoint: "cli", permissionMode: "plan",
    message: { content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }, { type: "text", text: "check the logs" }] } },
  { type: "assistant", timestamp: at(1), cwd: "/p/app", message: { id: "r1", model: "claude-sonnet-4-5", usage: tok, stop_reason: "tool_use", content: [{ type: "thinking", thinking: "Look at the log first.", signature: "x" }] } },
  { type: "assistant", timestamp: at(1), cwd: "/p/app", message: { id: "r1", model: "claude-sonnet-4-5", usage: tok, stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } },
  { type: "user", timestamp: at(3.5), cwd: "/p/app/sub", gitBranch: "feature", toolUseResult, message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "a.log" }] } },
  { type: "system", subtype: "api_error", timestamp: at(4), level: "error", error: { message: "Connection error.", formatted: "No response from API" }, retryAttempt: 1, maxRetries: 10 },
  { type: "assistant", timestamp: at(5), message: { id: "r2", model: "mystery-1", stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: "Done." }] } },
  { type: "user", timestamp: at(6), message: { content: [{ type: "text", text: "[Request interrupted by user]" }] } },
  { type: "user", timestamp: at(7), isCompactSummary: true, message: { content: "This session is being continued..." } },
  { type: "mode", mode: "normal", sessionId: "x" },
];
m = buildSession(rich, {}, now);
const steps = m.turns.flatMap((t) => t.steps);
const bash = steps.find((s) => s.tool === "Bash")!;
assert.deepEqual(bash.usage, { input: 1000, cacheWrite5m: 0, cacheWrite1h: 0, fresh: 1000, cached: 1_000_000, written: 1000 });
assert.equal(bash.model, "claude-sonnet-4-5");
assert.equal(bash.durationMs, 2500);
assert.equal(bash.thinking, "Look at the log first.");
assert.deepEqual(bash.result, toolUseResult);
const done = steps.find((s) => s.kind === "reply")!;
assert.equal(done.model, "mystery-1");
assert.equal(done.thinking, undefined); // hidden thinking is recorded as an empty string
assert.deepEqual(steps.find((s) => s.kind === "prompt")!.images, [{ mediaType: "image/png", data: "AAAA" }]);
assert.equal(contextWindow("mystery-1"), 200_000);
assert.equal(contextWindow(undefined), 200_000);
assert.deepEqual(m.meta, {
  customTitle: "cc-trace tool setup", aiTitle: "Set up the tool", permissionMode: "plan", gitBranch: "feature", cwds: ["/p/app", "/p/app/sub"],
  version: "2.1.309", entrypoint: "cli", models: ["claude-sonnet-4-5", "mystery-1"], firstTs: t0, lastTs: t0 + 7000,
});
// The latest permissionMode wins; "mode" records never override it.
assert.equal(buildSession([...rich, { type: "user", timestamp: at(8), permissionMode: "bypassPermissions", message: { content: "go" } }, { type: "mode", mode: "normal" }], {}, now).meta.permissionMode, "bypassPermissions");
assert.equal(buildSession([{ type: "mode", mode: "normal" }, { type: "user", timestamp: at(0), message: { content: "hi" } }], {}, now).meta.permissionMode, undefined);
const apiError = steps.find((s) => s.event === "api_error")!;
assert.equal(apiError.actor, "lead");
assert.equal(apiError.status, "error");
assert.ok(m.events.some((e) => e.type === "system" && e.subtype === "api_error" && e.actor === "lead" && e.ts === t0 + 4000));
const hook = m.events.find((e) => e.type === "hook")!;
assert.equal(hook.subtype, "hook_non_blocking_error");
assert.equal(hook.data.exitCode, 1);
assert.equal(steps.find((s) => s.kind === "stop")!.event, "interrupted");
assert.equal(steps.find((s) => s.title === "Tidies its memory")!.event, "compact");
assert.deepEqual(addUsage(bash.usage!, bash.usage!), { input: 2000, cacheWrite5m: 0, cacheWrite1h: 0, fresh: 2000, cached: 2_000_000, written: 2000 });

// Broken or unknown records are skipped, never fatal.
const junk = [{}, { type: "weird" }, { type: "assistant" }, { type: "user", message: null }];
buildSession(junk, {});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
buildSession([null, ...junk, { type: "assistant", message: { content: [null, { type: "tool_use" }] } }] as any, { x: { records: junk } });

// Hiding sensitive text before showing or sharing it.
const secret = maskSecrets("key sk-ant-api03-abc123def456 and ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 password=hunter2 me@x.com /Users/chehan/a", "/Users/chehan");
for (const s of ["sk-ant-api03-abc123def456", "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", "hunter2", "me@x.com", "/Users/chehan"]) assert.ok(!secret.includes(s), `${s} still visible in: ${secret}`);
assert.ok(secret.includes("~/a"));
assert.ok(secret.includes("password=•••"));
assert.equal(maskSecrets("AKIAABCDEFGHIJKLMNOP xoxb-123-abc eyJhbGc.eyJzdWIi.c2ln API_KEY: abc"), "••• ••• ••• API_KEY: •••");
assert.equal(maskSecrets("/Users/chehanx/b and /Users/chehan", "/Users/chehan"), "/Users/chehanx/b and ~");
assert.equal(maskSecrets("disk-usage-monitoring-service-name KEY=sk-proj-abcdefghijklmnopqrstuvwxyz"), "disk-usage-monitoring-service-name KEY=•••");

// Quoted (JSON-style) keys keep their name readable and hide the value.
for (const [input, keep] of [['{"password": "hunter2"}', '"password"'], ['{"api_key":"abc123"}', '"api_key"'], ["'secret' = 'x'", "'secret'"]] as const) {
  const out = maskSecrets(input);
  assert.ok(!/hunter2|abc123/.test(out) && out.includes(keep) && out.includes("•••"), `quoted secret not masked: ${out}`);
}
assert.ok(!maskSecrets("'secret' = 'x'").includes("'x'"));

// Cache writes: an all-zero split with a non-zero total falls back to the total (5-minute kind).
const cw = (cache_creation: unknown) => buildSession([
  { type: "user", timestamp: at(0), message: { content: "hi" } },
  { type: "assistant", timestamp: at(1), message: { id: "c1", model: "m", stop_reason: "end_turn", usage: { input_tokens: 5, cache_creation_input_tokens: 100, cache_creation, output_tokens: 1 }, content: [{ type: "text", text: "ok" }] } },
], {}, now).turns[0].steps.find((s) => s.kind !== "prompt")!.usage!;
assert.deepEqual(cw({ ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }), { input: 5, cacheWrite5m: 100, cacheWrite1h: 0, fresh: 105, cached: 0, written: 1 });
assert.equal(cw({ ephemeral_5m_input_tokens: 30, ephemeral_1h_input_tokens: 70 }).fresh, 105);

// Retries collapse into one step; a step in between starts a new one. Every record stays in events.
const apiErr = (s: number, n: number) => ({ type: "system", subtype: "api_error", timestamp: at(s), error: { formatted: "No response" }, retryAttempt: n, maxRetries: 10 });
const retries = buildSession([{ type: "user", timestamp: at(0), message: { content: "go" } }, apiErr(1, 1), apiErr(2, 2), apiErr(3, 3)], {}, now);
const retrySteps = retries.turns.flatMap((t) => t.steps).filter((s) => s.event === "api_error");
assert.equal(retrySteps.length, 1);
assert.ok(retrySteps[0].what.includes("try 3 of 10") && retrySteps[0].status === "error");
assert.equal(retries.events.filter((e) => e.subtype === "api_error").length, 3);
const split = buildSession([
  { type: "user", timestamp: at(0), message: { content: "go" } }, apiErr(1, 1),
  { type: "assistant", timestamp: at(2), message: { id: "q1", content: [{ type: "tool_use", id: "q", name: "Bash", input: { command: "ls" } }] } },
  apiErr(3, 1),
], {}, now);
assert.equal(split.turns.flatMap((t) => t.steps).filter((s) => s.event === "api_error").length, 2);

// A synthetic API-error reply is an error step too.
const synth = buildSession([
  { type: "user", timestamp: at(0), message: { content: "go" } },
  { type: "assistant", timestamp: at(1), isApiErrorMessage: true, message: { id: "e1", model: "<synthetic>", content: [{ type: "text", text: "API Error: 529 overloaded" }] } },
], {}, now).turns[0].steps.find((s) => s.event === "api_error")!;
assert.equal(synth.status, "error");

// Very big sessions: no spreading huge arrays into Math.max (a RangeError past ~65k-130k items), and no
// per-step scan over every request.
{
  const N = 150_000;
  const big: LogRecord[] = [];
  for (let r = 0; r < 300; r++) big.push({ type: "user", timestamp: new Date(t0 + r * N * 2).toISOString(), message: { content: `request ${r}` } });
  for (let i = 0; i < N; i++) {
    const ts = new Date(t0 + i * 600).toISOString();
    big.push({ type: "assistant", timestamp: ts, message: { id: `b${i}`, stop_reason: "tool_use", content: [{ type: "tool_use", id: `bt${i}`, name: "Read", input: { file_path: "/a" } }] } });
    big.push({ type: "user", timestamp: ts, message: { content: [{ type: "tool_result", tool_use_id: `bt${i}`, content: "ok" }] } });
  }
  big.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const started = Date.now();
  const bm = buildSession(big, { h1: { records: big.slice(0, 2000).map((r) => ({ ...r, message: r.message && { ...r.message, id: `h${r.message.id}` } })) } }, now);
  const took = Date.now() - started;
  assert.equal(bm.turns.reduce((n, t) => n + t.steps.filter((x) => x.tool === "Read").length, 0) >= N, true);
  assert.ok(took < 10_000, `150k steps built in ${took} ms`);
  console.log(`✓ 150k steps built in ${took} ms`);
}

/**
 * Every analytics function on one real session, and the token totals every view shows agree: Stats by
 * model, by agent and by request, the agents tree, the dashboard digest and the cumulative chart.
 */
function checkAnalytics(m: SessionModel, name: string) {
  const total = totalTokens(m.usage);
  const sum = (us: Usage[]) => us.reduce((n, u) => n + totalTokens(u), 0);
  const st = sessionStats(m);
  assert.equal(sum(st.byModel.map((r) => r.usage)), total, `${name}: Stats by model`);
  assert.equal(sum(st.byAgent.map((r) => r.usage)), total, `${name}: Stats by agent`);
  if (m.turns.length) assert.equal(sum(st.byRequest.map((r) => r.usage)), total, `${name}: Stats by request`);
  const nodes: AgentNode[] = [];
  const walk = (n: AgentNode) => (nodes.push(n), n.children.forEach(walk));
  walk(agentTree(m));
  assert.equal(sum(nodes.map((n) => n.stats.usage)), total, `${name}: agents tree`);
  const digest = sessionDigest(m, { file: name, project: "p", title: "t" });
  if (digest.lastTs) assert.equal(sum(Object.values(digest.days).map((d) => d.bucket.usage)), total, `${name}: dashboard digest`);
  const burn = burnSeries(m);
  if (burn.length) assert.equal(burn.at(-1)!.tokens, total, `${name}: cumulative chart`);
  assert.equal(compare(m, m).find((r) => r.metric === "tokens")!.a, total, `${name}: compare`);
  healthReport(m);
  sessionStory(m);
  filesTouched(m);
  hookRuns(m);
  tasksOf(m);
  teamsOf(m);
  agentChat(m);
  needsAttention(m);
  const cwds = m.meta.cwds;
  for (const t of m.turns) {
    healthReport(m, t);
    storyOf(t, m);
    phasesOf(t);
    tipsFor(t, m);
    contextGauge(t, m);
    burnSeries(m, t.index);
    conversationRows(t, m.actors, { open: false });
    filterOptions(t.steps);
    for (const x of t.steps) riskOf(x, { cwds });
  }
}

if (process.argv.includes("--all")) {
  const root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");
  const read = (f: string) => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  let sessions = 0, steps = 0, helpers = 0, orphans = 0;
  for (const dir of fs.readdirSync(root)) {
    const abs = path.join(root, dir);
    if (!fs.statSync(abs).isDirectory()) continue;
    for (const name of fs.readdirSync(abs).filter((n) => n.endsWith(".jsonl"))) {
      const sub = path.join(abs, name.slice(0, -6), "subagents");
      const agents: Record<string, AgentLog> = {};
      for (const f of fs.existsSync(sub) ? fs.readdirSync(sub) : []) {
        const id = /^agent-(.+)\.jsonl$/.exec(f)?.[1];
        if (!id) continue;
        const metaFile = path.join(sub, `agent-${id}.meta.json`);
        agents[id] = { records: read(path.join(sub, f)), meta: fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, "utf8")) : undefined };
      }
      const s = buildSession(read(path.join(abs, name)), agents);
      sessions++;
      checkAnalytics(s, `${dir}/${name}`);
      steps += s.turns.reduce((n, t) => n + t.steps.length, 0);
      helpers += Object.keys(agents).length;
      // Every helper with a log should have a brief from whoever started it.
      orphans += Object.keys(agents).filter((id) => !s.turns.some((t) => t.steps.some((x) => x.kind === "brief" && x.actor === id))).length;
    }
  }
  console.log(`${sessions} real sessions: ${steps} steps, ${helpers} helpers, ${orphans} helpers without a visible brief`);
}
console.log("session check passed");
