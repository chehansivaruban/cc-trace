// Self-check for the log -> session story mapping.
//   node --experimental-strip-types scripts/session.check.mts            built-in cases
//   node --experimental-strip-types scripts/session.check.mts --all      also every real session in ~/.claude/projects
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSession, type AgentLog } from "../src/lib/session.ts";

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
assert.deepEqual(t1.usage, { fresh: 200, cached: 2000, written: 100 });
assert.deepEqual(m.actors.lead.usage, { fresh: 100, cached: 1000, written: 50 });
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
      steps += s.turns.reduce((n, t) => n + t.steps.length, 0);
      helpers += Object.keys(agents).length;
      // Every helper with a log should have a brief from whoever started it.
      orphans += Object.keys(agents).filter((id) => !s.turns.some((t) => t.steps.some((x) => x.kind === "brief" && x.actor === id))).length;
    }
  }
  console.log(`${sessions} real sessions: ${steps} steps, ${helpers} helpers, ${orphans} helpers without a visible brief`);
}
console.log("session check passed");
