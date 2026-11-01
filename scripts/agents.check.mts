// Self-check for agents, tasks, teams, story, compare, filters and export.
//   node --no-warnings --experimental-strip-types scripts/agents.check.mts
import assert from "node:assert/strict";
import { buildSession, totalTokens, type AgentLog, type LogRecord } from "../src/lib/session.ts";
import { agentChat, agentTree, tasksOf, teamsOf, type AgentNode } from "../src/lib/analytics/agents.ts";
import { sessionStory, storyOf } from "../src/lib/analytics/story.ts";
import { compare, compareModels, compareTools, scopeToTurn } from "../src/lib/analytics/compare.ts";
import { commandOf, emptyFilter, filterOptions, filterSteps, type StepFilter } from "../src/lib/analytics/filters.ts";
import { exportHtml } from "../src/lib/export/html.ts";
import { exportMarkdown } from "../src/lib/export/markdown.ts";
import { exportJson, homeOf } from "../src/lib/export/common.ts";

const t0 = Date.parse("2026-01-01T00:00:00.000Z");
const at = (s: number) => new Date(t0 + s * 1000).toISOString();
const now = t0 + 3_600_000;
const usage = { input_tokens: 10, cache_creation_input_tokens: 90, cache_read_input_tokens: 1000, output_tokens: 50 };
let n = 0;
const asst = (s: number, content: unknown[], stop = "tool_use", extra: LogRecord = {}): LogRecord => ({
  type: "assistant", timestamp: at(s), message: { id: `m${n++}`, model: "claude-sonnet-4-5", usage, stop_reason: stop, content }, ...extra,
});
const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input });
const res = (s: number, id: string, content: unknown = "ok", extra: LogRecord = {}): LogRecord => ({
  type: "user", timestamp: at(s), message: { content: [{ type: "tool_result", tool_use_id: id, content, ...(extra.is_error ? { is_error: true } : {}) }] },
});

// ── a lead with two helpers, one of which starts a helper of its own ──
const main: LogRecord[] = [
  { type: "user", timestamp: at(0), cwd: "/Users/chehan/app", message: { content: "fix the login bug" } },
  asst(1, [toolUse("td1", "TodoWrite", { todos: [{ content: "Find the bug", status: "in_progress" }, { content: "Fix it", status: "pending" }] })]),
  res(1, "td1"),
  asst(2, [toolUse("ag1", "Agent", { description: "Explorer", prompt: "Find where login breaks", subagent_type: "Explore" })]),
  res(2, "ag1", [{ type: "text", text: "Found it\nagentId: h1" }]),
  asst(20, [toolUse("ag2", "Agent", { description: "Reviewer", prompt: "Review the fix" })]),
  res(21, "ag2", [{ type: "text", text: "Looks good\nagentId: h2" }]),
  asst(22, [toolUse("r1", "Read", { file_path: "/Users/chehan/app/src/auth.ts" })]),
  res(23, "r1", "code"),
  asst(24, [toolUse("e1", "Edit", { file_path: "/Users/chehan/app/src/auth.ts", old_string: "a", new_string: "b" })]),
  res(25, "e1"),
  asst(26, [toolUse("b1", "Bash", { command: "cd /Users/chehan/app && npm test", description: "Run tests" })]),
  res(27, "b1", "all passed"),
  asst(28, [toolUse("b2", "Bash", { command: "git status" })]),
  res(28, "b2", "clean"),
  asst(29, [toolUse("tc1", "TaskCreate", { subject: "Write docs", description: "Document the fix" })]),
  res(29, "tc1", "Task #1 created successfully: Write docs"),
  asst(30, [toolUse("tu1", "TaskUpdate", { taskId: "1", status: "in_progress", owner: "h2" })]),
  res(30, "tu1"),
  asst(31, [toolUse("tu2", "TaskUpdate", { taskId: "1", status: "completed" })]),
  res(31, "tu2"),
  asst(32, [toolUse("up1", "mcp__ccd_turn__update_plan", { items: [{ content: "Plan A", status: "in_progress" }, { content: "Plan B", status: "pending" }] })]),
  res(32, "up1"),
  asst(33, [toolUse("up2", "mcp__ccd_turn__update_plan", { advance: true })]),
  res(33, "up2"),
  asst(34, [toolUse("td2", "TodoWrite", { todos: [{ content: "Find the bug", status: "completed" }, { content: "Fix it", status: "completed" }] })]),
  res(34, "td2"),
  asst(35, [{ type: "text", text: "All fixed." }], "end_turn"),
];
const h1: AgentLog = {
  meta: { description: "Explorer", toolUseId: "ag1", agentType: "Explore" },
  records: [
    { type: "user", isSidechain: true, timestamp: at(3), message: { content: "Find where login breaks" } },
    asst(4, [toolUse("h1r1", "Read", { file_path: "/Users/chehan/app/src/login.ts" })], "tool_use", { isSidechain: true }),
    res(5, "h1r1", "login code"),
    asst(6, [toolUse("ag3", "Agent", { description: "Deep diver", prompt: "Dig into tokens" })], "tool_use", { isSidechain: true }),
    res(12, "ag3", [{ type: "text", text: "deep result\nagentId: h3" }]),
    asst(13, [{ type: "text", text: "Found it in auth.ts" }], "end_turn", { isSidechain: true }),
  ],
};
const h3: AgentLog = {
  meta: { description: "Deep diver", toolUseId: "ag3" },
  records: [
    { type: "user", isSidechain: true, timestamp: at(7), message: { content: "Dig into tokens" } },
    asst(8, [toolUse("h3g", "Grep", { pattern: "token" })], "tool_use", { isSidechain: true }),
    res(9, "h3g", "src/auth.ts"),
    asst(10, [toolUse("h3s", "SendMessage", { to: "h1", message: "Halfway there" })], "tool_use", { isSidechain: true }),
    res(10, "h3s", "sent"),
    asst(11, [{ type: "text", text: "deep result" }], "end_turn", { isSidechain: true }),
  ],
};
const h2: AgentLog = {
  meta: { description: "Reviewer", toolUseId: "ag2" },
  records: [
    { type: "user", isSidechain: true, timestamp: at(20.5), message: { content: "Review the fix" } },
    asst(20.8, [{ type: "text", text: "Looks good" }], "end_turn", { isSidechain: true }),
  ],
};

const m = buildSession(main, { h1, h2, h3 }, now);
assert.equal(m.turns.length, 1);
const turn = m.turns[0];

// Tree: lead → Explorer → Deep diver, lead → Reviewer.
const tree = agentTree(m);
assert.equal(tree.actor.id, "lead");
const names = (node: AgentNode): unknown => ({ [node.actor.name]: node.children.map(names) });
assert.deepEqual(names(tree), { Claude: [{ Explorer: [{ "Deep diver": [] }] }, { Reviewer: [] }] });
const explorer = tree.children[0];
assert.ok(explorer.stats.steps >= 3, "Explorer's own steps are counted");
assert.equal(totalTokens(explorer.stats.usage), totalTokens(m.actors.h1.usage));
assert.equal(explorer.stats.durationMs, 11_000); // briefed at 2 s, reported back at 13 s
// A helper whose parent is unknown still hangs off the lead; a cycle never loops.
const odd = buildSession(main, { h1, h2, h3 }, now);
odd.actors.h2.parent = "nobody";
odd.actors.h1.parent = "h3";
odd.actors.h3.parent = "h1";
const oddTree = agentTree(odd);
const count = (node: AgentNode): number => 1 + node.children.reduce((s, c) => s + count(c), 0);
assert.equal(count(oddTree), 4, "every agent appears exactly once");
console.log("✓ agent tree nests helpers started by helpers");

// Tasks: the latest status wins, from TodoWrite, TaskCreate/TaskUpdate and update_plan.
const tasks = tasksOf(m);
const task = (title: string) => tasks.find((t) => t.title === title);
assert.equal(task("Find the bug")?.status, "completed");
assert.equal(task("Fix it")?.status, "completed");
assert.equal(task("Find the bug")?.owner, "Claude");
assert.equal(task("Write docs")?.status, "completed");
assert.equal(task("Write docs")?.owner, "Reviewer"); // the TaskUpdate owner, resolved to a name
assert.equal(task("Write docs")?.id, "task:1");
assert.equal(task("Plan A")?.status, "completed"); // advance: in progress → done
assert.equal(task("Plan B")?.status, "in_progress"); // …and the next one starts
assert.equal(task("Write docs")?.ts, t0 + 31_000);
assert.equal(tasks.length, 5);
// Codex-style update_plan and a deleted task.
const codex = buildSession([
  { type: "user", timestamp: at(0), message: { content: "plan it" } },
  asst(1, [toolUse("p1", "update_plan", { plan: [{ step: "Read code", status: "completed" }, { step: "Write code", status: "in_progress" }] })]),
  asst(2, [toolUse("c1", "TaskCreate", { subject: "Temp" })]),
  res(2, "c1", "Task #7 created successfully: Temp"),
  asst(3, [toolUse("c2", "TaskUpdate", { taskId: "7", status: "deleted" })]),
], {}, now);
assert.deepEqual(tasksOf(codex).map((t) => `${t.title}:${t.status}`), ["Read code:completed", "Write code:in_progress"]);
// A replacement list drops unfinished items it no longer has (superseded); finished ones stay.
const replaced = buildSession([
  { type: "user", timestamp: at(0), message: { content: "plan it" } },
  asst(1, [toolUse("q1", "TodoWrite", { todos: [{ content: "Old idea", status: "pending" }, { content: "Done bit", status: "completed" }] })]),
  asst(2, [toolUse("q2", "TodoWrite", { todos: [{ content: "New idea", status: "in_progress" }] })]),
  asst(3, [toolUse("q3", "mcp__ccd_turn__update_plan", { items: [{ content: "Step 1", status: "in_progress" }] })]),
  asst(4, [toolUse("q4", "mcp__ccd_turn__update_plan", { items: [{ content: "Step 2", status: "pending" }] })]),
], {}, now);
assert.deepEqual(tasksOf(replaced).map((t) => `${t.title}:${t.status}`), ["Done bit:completed", "New idea:in_progress", "Step 2:pending"]);
console.log("✓ tasks follow their latest status");

// Teams: created with TeamCreate, joined by agents started with a team name.
const teamLog = [
  { type: "user", timestamp: at(0), message: { content: "build it as a team" } },
  asst(1, [toolUse("tm", "TeamCreate", { team_name: "web-team", description: "Builds the site" })]),
  res(1, "tm"),
  asst(2, [toolUse("ag9", "Agent", { description: "Designer", name: "designer", team_name: "web-team", prompt: "Design it" })]),
  res(2, "ag9", [{ type: "text", text: "Spawned\nagentId: d1" }]),
  asst(3, [toolUse("ag8", "Agent", { description: "Coder", name: "coder", team_name: "web-team", prompt: "Code it" })]),
  res(3, "ag8", [{ type: "text", text: "Spawned\nagentId: c1" }]),
];
const teams = teamsOf(buildSession(teamLog, {}, now));
assert.equal(teams.length, 1);
assert.equal(teams[0].name, "web-team");
assert.deepEqual(teams[0].members.map((x) => x.name), ["designer", "coder"]);
assert.ok(teams[0].members.every((x) => typeof x.colour === "string" && x.colour.length > 0));
assert.deepEqual(teamsOf(m), []);
console.log("✓ teams and their members");

// Agent chat: the messages between agents, in order.
const chat = agentChat(m);
assert.deepEqual(chat.map((s) => `${s.kind}:${s.from}>${s.actor}`), [
  "brief:lead>h1",
  "brief:h1>h3",
  "message:h3>h1",
  "report:h3>h1",
  "report:h1>lead",
  "brief:lead>h2",
  "report:h2>lead",
  "reply:lead>you",
]);
assert.deepEqual(agentChat(m, turn).map((s) => s.id), chat.map((s) => s.id));
console.log("✓ agent chat in order");

// Story: plain English, built from the data.
const story = storyOf(turn, m);
assert.match(story, /^You asked Claude: “fix the login bug”\./);
for (const word of ["Explorer", "Reviewer", "Deep diver"]) assert.ok(story.includes(word), `story mentions ${word}: ${story}`);
assert.match(story, /read 2 \[\[file:files\]\]/); // auth.ts by Claude, login.ts by Explorer
assert.match(story, /asked 2 \[\[helper:helpers\]\] \(Explorer and Reviewer\) for help, who brought in 1 more \(Deep diver\)/);
assert.match(story, /changed 1 file/);
assert.match(story, /ran the \[\[tests:tests\]\] once/);
assert.match(story, /It finished without errors\./);
assert.equal(storyOf(turn, m), story, "deterministic");
const failing = buildSession([
  { type: "user", timestamp: at(0), message: { content: "run tests" } },
  asst(1, [toolUse("x1", "Bash", { command: "npm test" })]),
  res(2, "x1", "1 failed", { is_error: true }),
  asst(3, [toolUse("x2", "Bash", { command: "npm test" })]),
  res(4, "x2", "1 failed", { is_error: true }),
  asst(5, [{ type: "text", text: "Still failing." }], "end_turn"),
], {}, now);
const failStory = storyOf(failing.turns[0], failing);
assert.match(failStory, /ran the \[\[tests:tests\]\] twice/);
assert.match(failStory, /last test run still found problems/);
const stopped = buildSession([
  { type: "user", timestamp: at(0), message: { content: "go" } },
  asst(1, [toolUse("y1", "Read", { file_path: "a.ts" })]),
  { type: "user", timestamp: at(2), message: { content: [{ type: "text", text: "[Request interrupted by user]" }] } },
], {}, now);
assert.match(storyOf(stopped.turns[0], stopped), /You stopped Claude before it finished\./);
const whole = sessionStory(m);
assert.match(whole, /^Over 1 request,/);
assert.ok(whole.includes("Explorer") && whole.includes("tokens"), whole);
assert.equal(sessionStory(buildSession([], {}, now)), "Nothing has happened in this session yet.");
console.log("✓ story summaries");

// Compare: differences, lower is better.
const rows = compare(m, failing);
const row = (k: string) => rows.find((r) => r.metric === k)!;
assert.deepEqual(rows.map((r) => r.metric), ["requests", "tokens", "durationMs", "helpers", "toolCalls", "errors"]);
assert.equal(row("helpers").a, 3);
assert.equal(row("helpers").b, 0);
assert.equal(row("helpers").delta, -3);
assert.equal(row("helpers").better, "b");
assert.equal(row("errors").a, 0);
assert.equal(row("errors").b, 2);
assert.equal(row("errors").better, "a");
assert.equal(row("requests").better, "same");
assert.equal(row("tokens").a, totalTokens(m.usage));
assert.equal(row("durationMs").a, 35_000);
assert.ok(rows.every((r) => r.delta === r.b - r.a));
const tools = compareTools(m, failing);
assert.deepEqual(tools.find((t) => t.name === "Bash"), { name: "Bash", a: 2, b: 2 });
assert.deepEqual(compareModels(m, failing), { a: ["claude-sonnet-4-5"], b: ["claude-sonnet-4-5"], both: ["claude-sonnet-4-5"] });
const scoped = scopeToTurn(m, 0);
assert.equal(scoped.turns.length, 1);
assert.equal(compare(scoped, m).every((r) => r.better === "same"), true);
console.log("✓ compare");

// Filters: AND across groups, OR within a group.
const steps = m.turns.flatMap((t) => t.steps);
const f = (patch: Partial<StepFilter>): StepFilter => ({ ...emptyFilter(), ...patch });
assert.equal(filterSteps(steps, emptyFilter()).length, steps.length);
assert.deepEqual(filterSteps(steps, f({ tools: new Set(["Read"]) })).map((s) => s.id), ["h1r1", "r1"]);
assert.deepEqual(filterSteps(steps, f({ tools: new Set(["Read", "Grep"]) })).map((s) => s.id).sort(), ["h1r1", "h3g", "r1"]);
assert.deepEqual(filterSteps(steps, f({ tools: new Set(["Read"]), agents: new Set(["h1"]) })).map((s) => s.id), ["h1r1"]);
assert.deepEqual(filterSteps(steps, f({ commands: new Set(["npm"]) })).map((s) => s.id), ["b1"]);
assert.deepEqual(filterSteps(steps, f({ commands: new Set(["npm", "git"]) })).map((s) => s.id), ["b1", "b2"]);
assert.equal(filterSteps(steps, f({ categories: new Set(["you"]) })).every((s) => s.actor === "you" || s.from === "you"), true);
const helperSteps = filterSteps(steps, f({ categories: new Set(["helpers"]) }));
assert.ok(helperSteps.length > 0 && helperSteps.every((s) => !["you", "lead"].includes(s.actor) || !["you", "lead", undefined].includes(s.from)));
const toolsOrYou = filterSteps(steps, f({ categories: new Set(["tools", "you"]) }));
assert.ok(toolsOrYou.some((s) => s.kind === "prompt") && toolsOrYou.some((s) => s.kind === "tool"));
// Text matches titles, quotes and what came back (Grep found src/auth.ts).
assert.deepEqual(filterSteps(steps, f({ categories: new Set(["tools"]), text: "AUTH.TS" })).map((s) => s.id), ["h3g", "r1", "e1"]);
assert.deepEqual(filterSteps(steps, f({ categories: new Set(["errors"]) })), []);
assert.equal(commandOf(steps.find((s) => s.id === "b1")!), "npm");
assert.equal(commandOf(steps.find((s) => s.id === "r1")!), undefined);
const opts = filterOptions(steps);
assert.ok(opts.tools.some((t) => t.name === "Read" && t.count === 2));
assert.deepEqual(opts.commands.map((c) => c.name).sort(), ["git", "npm"]);
assert.ok(opts.agents.some((a) => a.id === "h3"));
assert.equal(opts.categories.tools, steps.filter((s) => s.kind === "tool").length);
// A text filter with regex characters is a plain substring, never a pattern.
assert.deepEqual(filterSteps(steps, f({ text: "(.*" })), []);
console.log("✓ filters");

// ── export: secrets never leave when masked, and the file needs no network ──
const SECRETS = ["sk-ant-api03-abc123def456", "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", "hunter2", "me@x.com", "/Users/chehan", "s3cr3tvalue"];
const secretLog: LogRecord[] = [
  { type: "attachment", timestamp: at(0), cwd: "/Users/chehan/app", attachment: { type: "hook_non_blocking_error", hookName: "Stop", exitCode: 1, stderr: "token=s3cr3tvalue at /Users/chehan/.hooks" } },
  { type: "user", timestamp: at(0), cwd: "/Users/chehan/app", message: { content: [{ type: "text", text: "my key is sk-ant-api03-abc123def456 <script>alert(1)</script>" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }] } },
  asst(1, [{ type: "thinking", thinking: "Mail me@x.com about ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" }, toolUse("z1", "Bash", { command: "export password=hunter2 && ls /Users/chehan/app" })]),
  res(2, "z1", "wrote /Users/chehan/app/.env with {\"api_key\": \"s3cr3tvalue\"}"),
  { type: "system", subtype: "api_error", timestamp: at(3), error: { formatted: "bad key sk-ant-api03-abc123def456" }, retryAttempt: 1 },
  asst(4, [{ type: "text", text: "Done. Contact me@x.com" }], "end_turn"),
];
const sm = buildSession(secretLog, {}, now);
assert.equal(homeOf(sm), "/Users/chehan");
const outputs = {
  html: exportHtml(sm, { mask: true }),
  htmlTurn: exportHtml(sm, { mask: true, turn: 0 }),
  md: exportMarkdown(sm, { mask: true }),
  mdTurn: exportMarkdown(sm, { mask: true, turn: 0 }),
  json: exportJson(sm, { mask: true }),
};
for (const [kind, out] of Object.entries(outputs)) {
  for (const s of SECRETS) assert.ok(!out.includes(s), `${kind} export leaks ${s}`);
}
assert.doesNotThrow(() => JSON.parse(outputs.json));
const plain = exportHtml(sm, { mask: false });
assert.ok(plain.includes("sk-ant-api03-abc123def456"), "unmasked export keeps the text");
assert.ok(plain.includes("data:image/png;base64,AAAA"), "unmasked export inlines images");
assert.ok(!outputs.html.includes("data:image/"), "masked export leaves images out");
for (const html of [outputs.html, plain]) {
  assert.match(html, /^<!doctype html>/i);
  assert.ok(!/<script\b/i.test(html), "no scripts");
  assert.ok(!/<link\b/i.test(html), "no linked stylesheets or fonts");
  assert.ok(!/@import|url\(/i.test(html), "no CSS loaded from elsewhere");
  assert.ok(!/(src|href)\s*=\s*["']?(https?:)?\/\//i.test(html), "nothing loaded from the network");
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "log text is escaped");
}
assert.ok(outputs.htmlTurn.includes("Request 1"));
assert.ok(outputs.md.startsWith("# "));
assert.ok(!outputs.md.includes("<script>"), "markdown escapes HTML");
console.log("✓ exports mask secrets and work offline");

// ── malformed records never crash anything ──
const junk = buildSession([{}, { type: "weird" }, { type: "assistant" }, { type: "user", message: null },
  asst(1, [null, { type: "tool_use" }, toolUse("j1", "TodoWrite", { todos: [null, { status: 3 }, "x"] }), toolUse("j2", "TaskUpdate", null), toolUse("j3", "update_plan", { done: ["x"], start: -1 }), toolUse("j4", "TeamCreate", {})])] as LogRecord[], {}, now);
for (const mm of [junk, buildSession([], {}, now)]) {
  agentTree(mm);
  tasksOf(mm);
  teamsOf(mm);
  agentChat(mm);
  sessionStory(mm);
  for (const t of mm.turns) storyOf(t, mm);
  compare(mm, m);
  compareTools(mm, mm);
  filterSteps(mm.turns.flatMap((t) => t.steps), f({ text: "x", categories: new Set(["permissions", "connectors", "memory"]) }));
  filterOptions(mm.turns.flatMap((t) => t.steps));
  exportHtml(mm, { mask: true });
  exportHtml(mm, { mask: false, turn: 99 });
  exportMarkdown(mm, { mask: true });
  exportJson(mm, { mask: true });
}
console.log("✓ malformed records are skipped");

// ── big sessions stay quick ──
const big: LogRecord[] = [{ type: "user", timestamp: at(0), message: { content: "big job" } }];
for (let i = 0; i < 20_000; i++) {
  big.push(asst(1 + i / 100, [toolUse(`k${i}`, i % 2 ? "Read" : "Bash", i % 2 ? { file_path: `/p/f${i % 300}.ts` } : { command: `npm test ${i}` })]));
  big.push(res(1 + i / 100, `k${i}`, "fine"));
}
const bm = buildSession(big, {}, now);
const started = performance.now();
agentTree(bm);
tasksOf(bm);
agentChat(bm);
sessionStory(bm);
storyOf(bm.turns[0], bm);
compare(bm, bm);
const bigSteps = bm.turns.flatMap((t) => t.steps);
filterOptions(bigSteps);
filterSteps(bigSteps, f({ text: "f12", commands: new Set(["npm"]), categories: new Set(["tools"]) }));
const took = performance.now() - started;
assert.ok(took < 1000, `analytics on 20k steps took ${Math.round(took)} ms`);
console.log(`✓ 20k steps analysed in ${Math.round(took)} ms`);

console.log("agents checks passed");
