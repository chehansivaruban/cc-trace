// Self-check for the session browser: log head/tail scans, counting, date groups, worktrees, copy
// commands, search, and the live-session registry.
//   node --no-warnings --experimental-strip-types scripts/sessions.check.mts
import assert from "node:assert/strict";
import { maskText } from "../src/lib/redact.ts";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appName,
  cwdIsSafe,
  dropProblem,
  filterSessions,
  formatTokens,
  groupByDate,
  MAX_DROP_BYTES,
  modelName,
  parseLogText,
  permissionLabel,
  resumeCommand,
  sameSessionFile,
  siblingSession,
  sortSessions,
  withTimeout,
  worktreeParent,
} from "../src/lib/sessions-list.ts";

// ── [ and ]: the session next to this one, whichever slash the file was written with ──
{
  const list = [{ file: "C--proj/a.jsonl" }, { file: "C--proj/b.jsonl" }, { file: "C--proj/c.jsonl" }];
  assert.ok(sameSessionFile("C--proj\\b.jsonl", "C--proj/b.jsonl"));
  assert.ok(!sameSessionFile("C--proj/b.jsonl", "C--proj/c.jsonl"));
  assert.ok(!sameSessionFile(undefined, "C--proj/b.jsonl"));
  assert.equal(siblingSession(list, "C--proj\\b.jsonl", 1)?.file, "C--proj/c.jsonl", "a Windows spelling still finds its place");
  assert.equal(siblingSession(list, "C--proj/b.jsonl", -1)?.file, "C--proj/a.jsonl");
  assert.equal(siblingSession(list, "C--proj/c.jsonl", 1), undefined, "no wrap-around");
  assert.equal(siblingSession(list, "C--other/x.jsonl", 1), undefined);
  assert.equal(siblingSession(list, null, 1), undefined);
  console.log("✓ previous and next session");
}

// A fake ~/.claude, set before claude-logs.ts reads CLAUDE_CONFIG_DIR.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-trace-sessions-"));
process.env.CLAUDE_CONFIG_DIR = tmp;
const { countLines, countTokens, createCount, isAlive, listProjects, pickTitle, readLiveSessions, scanHead, scanTail } = await import(
  "../src/lib/claude-logs.ts"
);

const j = (...recs: unknown[]) => recs.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n") + "\n";
const t = (s: number) => new Date(Date.parse("2026-10-30T10:00:00.000Z") + s * 1000).toISOString();
const usage = { input_tokens: 10, cache_creation_input_tokens: 90, cache_read_input_tokens: 1000, output_tokens: 50 }; // 1150

try {
  // ── Head and tail scans: title is /rename > Claude's auto title > first prompt ──
  const head = scanHead(
    j(
      "{}",
      "null",
      "garbage",
      { type: "weird" },
      { type: "user", isMeta: true, cwd: "/Users/me/app", timestamp: t(0), message: { content: "<command-name>/clear</command-name>" } },
      { type: "user", cwd: "/Users/me/app", gitBranch: "main", version: "2.1.0", entrypoint: "cli", timestamp: t(1), message: { content: "fix the login bug" } },
      { type: "ai-title", aiTitle: "Early AI title" },
    ) + '{"type":"user","message":{"content":"cut off',
  );
  assert.equal(head.cwd, "/Users/me/app");
  assert.deepEqual(head.cwds, ["/Users/me/app"]);
  assert.equal(head.firstPrompt, "fix the login bug");
  assert.equal(head.firstTs, Date.parse(t(0)));
  assert.equal(head.gitBranch, "main");
  assert.equal(head.entrypoint, "cli");
  // The tail starts mid-file: its first line is a fragment and is ignored.
  const tail = scanTail(
    'ext":"half a line"}]}}\n' +
      j(
        { type: "ai-title", aiTitle: "Fixing the login bug" },
        { type: "assistant", timestamp: t(50), message: { model: "claude-opus-4-1", usage } },
        { type: "assistant", timestamp: t(51), message: { model: "<synthetic>" } },
        { type: "custom-title", customTitle: "Login fix" },
        { type: "user", gitBranch: "feat/login", version: "2.1.3", timestamp: t(60), message: { content: "thanks" } },
        { message: null },
      ),
  );
  assert.equal(tail.customTitle, "Login fix");
  assert.equal(tail.aiTitle, "Fixing the login bug");
  assert.equal(tail.model, "claude-opus-4-1", "the synthetic model is ignored");
  assert.equal(tail.lastTs, Date.parse(t(60)));
  assert.equal(tail.gitBranch, "feat/login", "latest branch wins");
  assert.equal(tail.version, "2.1.3");
  assert.equal(pickTitle(head, tail), "Login fix");
  assert.equal(pickTitle(head, { ...tail, customTitle: undefined }), "Fixing the login bug");
  assert.equal(pickTitle(head, {}), "Early AI title", "a title in the head counts when the tail has none");
  assert.equal(pickTitle({ ...head, aiTitle: undefined }, {}), "fix the login bug");
  assert.equal(pickTitle({}, {}), "Untitled session");
  // Long titles are cut after a whole word with a visible "…", so masking later still sees whole words.
  assert.equal(pickTitle({ firstPrompt: "word ".repeat(100) }, {}), `${"word ".repeat(61).trim()}…`);
  const longKey = pickTitle({ firstPrompt: "a".repeat(290) + " sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWX tail" }, {});
  assert.ok(!maskText(longKey).includes("sk-ant") && longKey.endsWith("…"), longKey);
  // One very long word is kept (not a bare "…" title).
  assert.ok(pickTitle({ firstPrompt: "z".repeat(400) }, {}).startsWith("zzzz"));
  assert.deepEqual(scanTail(""), {});
  console.log("✓ head and tail scans pick the title");

  // ── Counting requests and tokens over the whole log, in pieces ──
  const count = createCount();
  const log = j(
    { type: "user", timestamp: t(0), message: { content: "first ask" } },
    // One reply split over two records: counted once, the later usage wins.
    { type: "assistant", timestamp: t(1), message: { id: "m1", model: "claude-sonnet-4-5", usage: { ...usage, output_tokens: 1 } } },
    { type: "assistant", timestamp: t(1), message: { id: "m1", model: "claude-sonnet-4-5", usage } },
    { type: "user", timestamp: t(2), message: { content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] } },
    { type: "user", isMeta: true, timestamp: t(3), message: { content: "meta" } },
    { type: "user", isSidechain: true, timestamp: t(3), message: { content: "old-style helper prompt" } },
    { type: "user", timestamp: t(4), message: { content: "[Request interrupted by user]" } },
    { type: "user", isCompactSummary: true, timestamp: t(5), message: { content: "summary" } },
    { type: "user", timestamp: t(5), message: { content: "<task-notification><status>completed</status></task-notification>" } },
    { type: "user", timestamp: t(6), message: { content: [{ type: "text", text: "second ask" }] } },
    { type: "assistant", timestamp: t(7), message: { id: "m2", model: "claude-opus-4-1", usage: { input_tokens: 5, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 20 }, cache_creation_input_tokens: 20 } } },
    "{}",
    "[1,2]",
  );
  // Fed in two pieces of whole lines, as an appending log is read.
  const cut = log.indexOf("\n", 400) + 1;
  countLines(count, log.slice(0, cut), true);
  countLines(count, log.slice(cut), true);
  assert.equal(count.requests, 2);
  assert.equal(countTokens(count), 1150 + 25);
  assert.equal(count.model, "claude-opus-4-1");
  const helper = createCount();
  countLines(helper, j({ type: "user", isSidechain: true, message: { content: "brief" } }, { type: "assistant", message: { id: "h1", usage } }), false);
  assert.equal(helper.requests, 0, "helper logs add tokens, not requests");
  assert.equal(countTokens(helper), 1150);
  console.log("✓ counts requests and tokens");

  // ── Date groups ──
  const now = new Date(2026, 9, 30, 15, 0).getTime(); // Fri 30 Oct 2026, 15:00 local
  const at = (d: number, h: number) => new Date(2026, 9, 30 - d, h).getTime();
  const rows = [
    { id: "a", mtime: at(0, 9), started: at(40, 9) },
    { id: "b", mtime: at(1, 23), started: at(1, 1) },
    { id: "c", mtime: at(3, 12), started: at(3, 12) },
    { id: "d", mtime: at(20, 12), started: at(20, 12) },
    { id: "e", mtime: at(45, 12), started: at(45, 12) },
    { id: "f", mtime: at(0, 0), started: at(0, 0) },
  ];
  assert.deepEqual(
    groupByDate(rows, now).map((g) => [g.label, g.sessions.map((s) => s.id)]),
    [
      ["Today", ["a", "f"]],
      ["Yesterday", ["b"]],
      ["This week", ["c"]],
      ["This month", ["d"]],
      ["Older", ["e"]],
    ],
  );
  assert.deepEqual(
    groupByDate(rows, now, "started").map((g) => [g.label, g.sessions.map((s) => s.id)]),
    [
      ["Today", ["f"]],
      ["Yesterday", ["b"]],
      ["This week", ["c"]],
      ["This month", ["d"]],
      ["Older", ["a", "e"]],
    ],
  );
  assert.deepEqual(groupByDate([], now), []);
  assert.deepEqual(sortSessions(rows, "started").map((s) => s.id), ["f", "b", "c", "d", "a", "e"]);
  assert.deepEqual(sortSessions(rows, "recent").map((s) => s.id), ["a", "f", "b", "c", "d", "e"]);
  console.log("✓ groups sessions by date");

  // ── Worktrees ──
  assert.equal(worktreeParent("/Users/me/app/.claude/worktrees/feat-x"), "/Users/me/app");
  assert.equal(worktreeParent("/Users/me/app/.claude/worktrees/feat-x/src"), "/Users/me/app");
  assert.equal(worktreeParent("C:\\Users\\me\\app\\.claude\\worktrees\\feat-x"), "C:\\Users\\me\\app");
  assert.equal(worktreeParent("/Users/me/wt/task-1", "gitdir: /Users/me/app/.git/worktrees/task-1\n"), "/Users/me/app");
  assert.equal(worktreeParent("C:\\wt\\task-1", "gitdir: C:/Users/me/app/.git/worktrees/task-1\n"), "C:\\Users\\me\\app");
  assert.equal(worktreeParent("/Users/me/app"), undefined);
  assert.equal(worktreeParent("/Users/me/app", "gitdir: /Users/me/app/.git/modules/sub"), undefined, "a submodule is not a worktree");
  assert.equal(worktreeParent(""), undefined);
  // A hung check (a dead network folder) gives up after the time limit.
  const never = new Promise<string>(() => {});
  const t0 = Date.now();
  assert.equal(await withTimeout(never, 50, undefined), undefined);
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(await withTimeout(Promise.resolve("/Users/me/app"), 50, undefined), "/Users/me/app");
  assert.equal(await withTimeout(Promise.reject(new Error("x")), 50, "fallback"), "fallback", "a failed check gives the fallback");
  console.log("✓ detects worktrees on POSIX and Windows paths");

  // ── Copy commands ──
  assert.equal(resumeCommand("/Users/me/my app", "abc"), "cd '/Users/me/my app' && claude --resume abc");
  assert.equal(resumeCommand("/Users/me/it's", "abc", true), "cd '/Users/me/it'\\''s' && claude --resume abc --fork-session");
  assert.equal(resumeCommand("C:\\Users\\me\\my app", "abc"), 'cd "C:\\Users\\me\\my app" && claude --resume abc');
  assert.equal(resumeCommand("\\\\server\\share\\app", "abc"), 'cd "\\\\server\\share\\app" && claude --resume abc');
  assert.equal(resumeCommand(undefined, "abc"), "claude --resume abc");
  // A cwd comes from the log, so it may be crafted: anything a shell could expand inside the quotes drops the cd part.
  for (const bad of ['C:\\x" && calc && echo "', "C:\\a`b", "C:\\$(calc)", "C:\\%PATH%", "C:\\a\nb", "C:\\a\rb"]) {
    assert.equal(resumeCommand(bad, "abc"), "claude --resume abc", JSON.stringify(bad));
    assert.equal(cwdIsSafe(bad), false, JSON.stringify(bad));
  }
  for (const bad of ["/Users/me/a\nrm -rf ~", "/Users/me/a\rb"]) {
    assert.equal(resumeCommand(bad, "abc", true), "claude --resume abc --fork-session", JSON.stringify(bad));
    assert.equal(cwdIsSafe(bad), false);
  }
  // Inside POSIX single quotes $, ` and % are literal, so those folders keep their cd.
  assert.equal(resumeCommand("/Users/me/$HOME `x` 50%", "abc"), "cd '/Users/me/$HOME `x` 50%' && claude --resume abc");
  assert.equal(cwdIsSafe("/Users/me/$HOME"), true);
  assert.equal(cwdIsSafe(undefined), true);
  // The id comes from the log's file name: anything but letters, digits, _ and - gives no command at all.
  for (const id of ["abc; rm -rf ~", "a b", "", "$(calc)", "../x", "abc\n"]) {
    assert.equal(resumeCommand("/Users/me/app", id), null, JSON.stringify(id));
    assert.equal(resumeCommand("/Users/me/app", id, true), null, JSON.stringify(id));
  }
  assert.equal(resumeCommand("/Users/me/app", "6f1c-ab_9"), "cd '/Users/me/app' && claude --resume 6f1c-ab_9");
  console.log("✓ builds resume and fork commands");

  // ── Labels ──
  assert.equal(appName("cli"), "Terminal");
  assert.equal(appName("claude-vscode"), "VS Code");
  assert.equal(appName("something-new"), "something-new");
  assert.equal(appName(undefined), undefined);
  assert.equal(permissionLabel("bypassPermissions").risky, true);
  assert.equal(permissionLabel("default").risky, false);
  assert.equal(permissionLabel("madeUp").label, "madeUp");
  assert.equal(modelName("claude-opus-4-1-20250805"), "Opus 4.1");
  assert.equal(modelName("claude-opus-4-20250514"), "Opus 4");
  assert.equal(modelName("claude-sonnet-4-5"), "Sonnet 4.5");
  assert.equal(modelName("claude-3-5-sonnet-20241022"), "Sonnet 3.5");
  assert.equal(modelName("gpt-x"), "gpt-x");
  assert.equal(formatTokens(950), "950");
  assert.equal(formatTokens(12_400), "12k");
  assert.equal(formatTokens(3_250_000), "3.3M");

  // ── Dropped files: size cap on the total, one session at a time ──
  const MB = 1024 * 1024;
  assert.equal(MAX_DROP_BYTES, 150 * MB);
  assert.equal(dropProblem([{ name: "s.jsonl", size: 10 * MB }]), null);
  assert.equal(dropProblem([{ name: "s.jsonl", size: 100 * MB }, { name: "agent-a.jsonl", size: 40 * MB }, { name: "agent-a.meta.json", size: 1 }]), null);
  assert.match(dropProblem([{ name: "s.jsonl", size: 100 * MB }, { name: "agent-a.jsonl", size: 60 * MB }])!, /150 MB/, "the total counts, not each file");
  assert.match(dropProblem([{ name: "s.jsonl", size: 151 * MB }])!, /too big/);
  assert.match(dropProblem([{ name: "notes.txt", size: 1 }])!, /\.jsonl/);
  assert.match(dropProblem([])!, /\.jsonl/);
  assert.match(dropProblem([{ name: "a.jsonl", size: 1 }, { name: "b.jsonl", size: 1 }])!, /one session at a time/);
  assert.equal(dropProblem([{ name: "agent-x.jsonl", size: 1 }]), null, "a helper log on its own opens as the main log");
  assert.deepEqual(parseLogText('{"type":"user"}\n\nnull\n[1]\ngarbage\n{"type":"assistant"}\n{"cut'), [{ type: "user" }, { type: "assistant" }]);
  console.log("✓ checks dropped files");

  // ── Search and filters ──
  const listed = [
    { id: "11111111-aaaa", file: "-Users-me-app/11111111-aaaa.jsonl", title: "Login fix", firstPrompt: "fix the login bug", model: "claude-opus-4-1", live: true },
    { id: "22222222-bbbb", file: "-Users-me-site/22222222-bbbb.jsonl", title: "Untitled session", firstPrompt: "make the header blue", model: "claude-sonnet-4-5", live: false },
  ];
  const ids = (q: string, o = {}) => filterSessions(listed, { q, ...o }).map((s) => s.id[0]);
  assert.deepEqual(ids(""), ["1", "2"]);
  assert.deepEqual(ids("LOGIN"), ["1"], "title, any case");
  assert.deepEqual(ids("header blue"), ["2"], "first prompt");
  assert.deepEqual(ids("2222"), ["2"], "session id");
  assert.deepEqual(ids("sonnet"), ["2"], "model");
  assert.deepEqual(ids("", { liveOnly: true }), ["1"]);
  assert.deepEqual(ids("", { projects: ["-Users-me-site"] }), ["2"]);
  assert.deepEqual(ids("nothing matches"), []);
  console.log("✓ searches by title, first prompt, id and model; filters project and live");

  // ── Live registry ──
  assert.deepEqual(await readLiveSessions(path.join(tmp, "missing")), [], "no sessions folder: empty list");
  assert.equal(isAlive(process.pid), true);
  const dead = spawnSync(process.execPath, ["-e", ""]).pid!;
  assert.equal(isAlive(dead), false);
  assert.equal(isAlive(-1), false);
  assert.equal(isAlive(Number.NaN), false);

  const proj = path.join(tmp, "projects", "-Users-me-app");
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(
    path.join(proj, "live-1.jsonl"),
    j(
      { type: "user", cwd: "/Users/me/app", gitBranch: "main", version: "2.1.0", entrypoint: "cli", timestamp: t(0), message: { content: "fixture prompt" } },
      { type: "assistant", timestamp: t(30), message: { id: "m1", model: "claude-opus-4-1", usage } },
      { type: "custom-title", customTitle: "Fixture title" },
    ),
  );
  // Starts in a scratch folder, then works in the project: the project's own folder is the one to resume in.
  fs.writeFileSync(
    path.join(proj, "moved.jsonl"),
    j(
      { type: "user", cwd: "/tmp/scratch-1", timestamp: t(-100), message: { content: "start elsewhere" } },
      { type: "user", cwd: "/Users/me/app", timestamp: t(-90), message: { content: "then here" } },
    ),
  );
  fs.utimesSync(path.join(proj, "moved.jsonl"), new Date(Date.now() - 86_400_000), new Date(Date.now() - 86_400_000));
  fs.mkdirSync(path.join(proj, "live-1", "subagents"), { recursive: true });
  fs.writeFileSync(path.join(proj, "live-1", "subagents", "agent-h1.jsonl"), j({ type: "assistant", message: { id: "h1", usage } }));
  const wt = path.join(tmp, "projects", "-Users-me-app--claude-worktrees-x");
  fs.mkdirSync(wt);
  fs.writeFileSync(path.join(wt, "w-1.jsonl"), j({ type: "user", cwd: "/Users/me/app/.claude/worktrees/x", timestamp: t(0), message: { content: "in a worktree" } }));
  fs.writeFileSync(path.join(tmp, "projects", "stray.txt"), "not a folder");

  const reg = path.join(tmp, "sessions");
  fs.mkdirSync(reg);
  fs.writeFileSync(path.join(reg, "1.json"), JSON.stringify({ pid: process.pid, sessionId: "live-1", cwd: "/Users/me/app", startedAt: 5, version: "2.1.0", entrypoint: "cli", status: "busy" }));
  fs.writeFileSync(path.join(reg, "2.json"), JSON.stringify({ pid: dead, sessionId: "gone", cwd: "/x", startedAt: 1 }));
  fs.writeFileSync(path.join(reg, "3.json"), "{ not json");
  fs.writeFileSync(path.join(reg, "4.json"), JSON.stringify({ pid: "nope", sessionId: 3 }));
  fs.writeFileSync(path.join(reg, "5.json"), JSON.stringify({ pid: process.pid, sessionId: "../../etc/passwd", cwd: "/x", startedAt: 1 }));
  fs.writeFileSync(path.join(reg, "6.json"), JSON.stringify({ pid: process.pid, sessionId: "no-log", cwd: "/x", startedAt: 2 }));
  fs.writeFileSync(path.join(reg, "1.abc.key"), "secret");

  const live = await readLiveSessions();
  assert.deepEqual(
    live.map((l) => [l.sessionId, l.file]),
    [
      ["live-1", "-Users-me-app/live-1.jsonl"],
      ["no-log", undefined],
    ],
    "only running, well-formed entries; the log is found by id",
  );
  assert.equal(live[0].pid, process.pid);
  assert.equal(live[0].startedAt, 5);
  assert.equal(live[0].version, "2.1.0");
  console.log("✓ reads the live-session registry");

  // ── The full listing ──
  const projects = await listProjects();
  const app = projects.find((p) => p.dir === "-Users-me-app")!;
  const s = app.sessions[0];
  assert.equal(s.title, "Fixture title");
  assert.equal(s.firstPrompt, "fixture prompt");
  assert.equal(s.cwd, "/Users/me/app");
  assert.equal(s.model, "claude-opus-4-1");
  assert.equal(s.requests, 1);
  assert.equal(s.tokens, 2300, "main log plus the helper's log");
  assert.equal(s.helpers, 1);
  assert.equal(s.durationMs, 30_000);
  assert.equal(s.started, Date.parse(t(0)));
  assert.equal(s.gitBranch, "main");
  assert.equal(s.version, "2.1.0");
  assert.equal(s.entrypoint, "cli");
  assert.equal(s.live, true);
  assert.equal(s.worktreeOf, undefined);
  assert.equal(app.path, "/Users/me/app");
  assert.equal(app.sessions.find((x) => x.id === "moved")!.cwd, "/Users/me/app", "the folder that names the project wins");
  const w = projects.find((p) => p.dir === "-Users-me-app--claude-worktrees-x")!;
  assert.equal(w.worktreeOf, "/Users/me/app");
  assert.equal(w.sessions[0].worktreeOf, "/Users/me/app");
  assert.equal(w.sessions[0].live, false);

  // Appending to a log is picked up (the count cache reads only the new bytes).
  fs.appendFileSync(path.join(proj, "live-1.jsonl"), j({ type: "user", timestamp: t(90), message: { content: "one more" } }));
  const again = (await listProjects()).find((p) => p.dir === "-Users-me-app")!.sessions[0];
  assert.equal(again.requests, 2);
  assert.equal(again.durationMs, 90_000);
  console.log("✓ lists sessions with titles, counts, live state and worktrees");

  console.log("sessions checks passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
