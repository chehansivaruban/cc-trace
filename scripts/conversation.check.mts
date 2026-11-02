// Self-check for the Conversation view's pure helpers: explanations, diffs, tool outcomes and rows.
//   node --no-warnings --experimental-strip-types scripts/conversation.check.mts
import assert from "node:assert/strict";
import { nearestExplanation } from "../src/lib/analytics/explanations.ts";
import {
  bashOutcome,
  conversationRows,
  diffRows,
  diffWords,
  editDiff,
  formatDuration,
  mcpLabel,
  modelLabel,
  rowText,
  toolOutcome,
  toolTime,
} from "../src/lib/conversation.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { findAll, joinPieces, markdownText, rowSearchText, toolBodyText } from "../src/lib/find-text.ts";
import { maskText, rememberHomes } from "../src/lib/mask.ts";
import { buildSession, type Actor, type Step, type Turn } from "../src/lib/session.ts";

const step = (id: string, kind: Step["kind"], actor: string, extra: Partial<Step> = {}): Step => ({
  id, kind, actor, icon: "tool", title: id, subtitle: "", doing: "", what: "", why: "", ts: 0, seq: 0, ...extra,
});
const turnOf = (steps: Step[]): Turn => ({ index: 0, text: "", ts: 0, end: 0, steps, actors: [], usage: { fresh: 0, cached: 0, written: 0, input: 0, cacheWrite5m: 0, cacheWrite1h: 0 }, context: 0 });

// ── nearestExplanation: the closest earlier note by the same actor, in the same turn ──
{
  const t = turnOf([
    step("p", "prompt", "you"),
    step("n1", "note", "lead", { quote: "Let me look at the tests" }),
    step("h1", "note", "h", { quote: "helper note" }),
    step("t1", "tool", "lead"),
    step("err", "note", "lead", { event: "api_error" }),
    step("t2", "tool", "lead"),
    step("t3", "tool", "h"),
    step("n2", "note", "lead", { quote: "Now the build" }),
    step("t4", "tool", "lead"),
  ]);
  assert.equal(nearestExplanation(t, "t1")?.id, "n1");
  assert.equal(nearestExplanation(t, "t2")?.id, "n1", "event notes (API errors, compaction) are not explanations");
  assert.equal(nearestExplanation(t, "t3")?.id, "h1", "helpers are explained by their own notes");
  assert.equal(nearestExplanation(t, "t4")?.id, "n2");
  assert.equal(nearestExplanation(t, "n1"), undefined, "nothing before the first note");
  assert.equal(nearestExplanation(t, "missing"), undefined);
  assert.equal(nearestExplanation(turnOf([step("t", "tool", "lead")]), "t"), undefined);
}

// ── diffWords: marked segments ──
{
  const segs = diffWords("the quick brown fox", "the slow brown fox");
  assert.equal(segs.filter((s) => s.type !== "added").map((s) => s.text).join(""), "the quick brown fox");
  assert.equal(segs.filter((s) => s.type !== "removed").map((s) => s.text).join(""), "the slow brown fox");
  assert.deepEqual(segs.filter((s) => s.type === "removed").map((s) => s.text), ["quick"]);
  assert.deepEqual(segs.filter((s) => s.type === "added").map((s) => s.text), ["slow"]);
  assert.ok(segs.some((s) => s.type === "same" && s.text.includes("brown fox")));
  assert.deepEqual(diffWords("", ""), []);
  // Huge strings aren't word-diffed (too slow): one removed and one added segment.
  const big = "x ".repeat(6000);
  assert.deepEqual(diffWords(big, big + "y").map((s) => s.type), ["removed", "added"]);
}

// ── editDiff: prefers the logged structuredPatch, else computes one ──
{
  const logged = [{ oldStart: 10, oldLines: 2, newStart: 10, newLines: 2, lines: [" keep", "-from log", "+to log"] }];
  const d = editDiff("Edit", { file_path: "/a.ts", old_string: "a", new_string: "b" }, { structuredPatch: logged });
  assert.equal(d?.fromLog, true);
  assert.deepEqual(d?.hunks, logged);
  assert.equal(d?.added, 1);
  assert.equal(d?.removed, 1);

  const c = editDiff("Edit", { file_path: "/a.ts", old_string: "one\ntwo\nthree", new_string: "one\n2\nthree" }, undefined);
  assert.equal(c?.fromLog, false);
  assert.equal(c?.hunks.length, 1);
  assert.deepEqual(c?.hunks[0].lines, [" one", "-two", "+2", " three"]);

  // An empty or malformed logged patch falls back to computing.
  assert.equal(editDiff("Edit", { old_string: "a", new_string: "b" }, { structuredPatch: [] })?.fromLog, false);
  assert.equal(editDiff("Edit", { old_string: "a", new_string: "b" }, { structuredPatch: [{ nope: 1 }] })?.fromLog, false);

  const m = editDiff("MultiEdit", { edits: [{ old_string: "a", new_string: "b" }, { old_string: "c", new_string: "d" }] }, undefined);
  assert.equal(m?.hunks.length, 2);
  assert.equal(m?.added, 2);

  // A Write that created a file has no diff; one that replaced a file uses its patch.
  assert.equal(editDiff("Write", { content: "x" }, { type: "create", structuredPatch: [] }), undefined);
  assert.equal(editDiff("Write", { content: "x" }, { type: "update", structuredPatch: logged })?.fromLog, true);
  assert.equal(editDiff("Read", {}, undefined), undefined);
  assert.equal(editDiff("Edit", null, null), undefined);
}

// ── diffRows: line numbers and word highlights for paired lines ──
{
  const rows = diffRows({ oldStart: 5, oldLines: 3, newStart: 5, newLines: 3, lines: [" a", "-let x = 1;", "+let x = 2;", " b", "\\ No newline at end of file"] });
  assert.deepEqual(rows.map((r) => r.type), ["same", "removed", "added", "same"]);
  assert.deepEqual(rows.map((r) => [r.oldNo, r.newNo]), [[5, 5], [6, undefined], [undefined, 6], [7, 7]]);
  assert.ok(rows[1].words?.some((w) => w.type === "removed" && w.text.includes("1")));
  assert.ok(rows[2].words?.some((w) => w.type === "added" && w.text.includes("2")));
  assert.ok(!rows[1].words?.some((w) => w.type === "added"), "a removed line only shows removed words");
  assert.equal(rows[0].words, undefined);
}

// ── bashOutcome / toolOutcome ──
{
  const ok = bashOutcome(step("b", "tool", "lead", { tool: "Bash", status: "success", output: "hi", result: { stdout: "hi", stderr: "", interrupted: false } }));
  assert.equal(ok.exitCode, 0);
  assert.equal(ok.stdout, "hi");
  const bad = bashOutcome(step("b", "tool", "lead", { tool: "Bash", status: "error", output: "Exit code 2\nboom", result: "Error: Exit code 2\nboom" }));
  assert.equal(bad.exitCode, 2);
  assert.equal(bad.stdout, "boom");
  const rc = bashOutcome(step("b", "tool", "lead", { tool: "Bash", status: "success", result: { stdout: "", stderr: "", returnCodeInterpretation: "Command failed with exit code 145" } }));
  assert.equal(rc.exitCode, 145);
  const bg = bashOutcome(step("b", "tool", "lead", { tool: "Bash", status: "success", result: { stdout: "", stderr: "", backgroundTaskId: "abc" } }));
  assert.equal(bg.background, "abc");
  assert.equal(bashOutcome(step("b", "tool", "lead", { tool: "Bash", status: "running" })).exitCode, undefined);

  assert.equal(toolOutcome(step("t", "tool", "lead", { status: "error", output: "The user doesn't want to proceed with this tool use." }), false), "denied");
  assert.equal(toolOutcome(step("t", "tool", "lead", { status: "error", output: "[Request interrupted by user for tool use]" }), false), "interrupted");
  assert.equal(toolOutcome(step("t", "tool", "lead", { status: "running" }), false), "orphan");
  assert.equal(toolOutcome(step("t", "tool", "lead", { status: "running" }), true), undefined, "still running while the request is open");
  assert.equal(toolOutcome(step("t", "tool", "lead", { status: "success", output: "fine" }), false), undefined);
}

// ── labels ──
assert.equal(modelLabel("claude-opus-4-5-20251101"), "Opus 4.5");
assert.equal(modelLabel("claude-sonnet-4-20250514"), "Sonnet 4");
assert.equal(modelLabel("claude-3-5-haiku-20241022"), "Haiku 3.5");
assert.equal(modelLabel("claude-opus-5-5[1m]"), "Opus 5.5");
assert.equal(modelLabel("gpt-x"), "gpt-x");
assert.equal(modelLabel(undefined), undefined);
assert.deepEqual(mcpLabel("mcp__claude-in-chrome__navigate"), { server: "claude in chrome", tool: "navigate" });
assert.deepEqual(mcpLabel("mcp__plugin_playwright_playwright__browser_click"), { server: "playwright", tool: "browser click" });
assert.equal(mcpLabel("Bash"), undefined);

// ── toolTime: parallel calls are counted once ──
assert.equal(
  toolTime([
    step("a", "tool", "lead", { tool: "Read", ts: 1000, durationMs: 4000 }),
    step("b", "tool", "lead", { tool: "Read", ts: 2000, durationMs: 1000 }), // inside a
    step("c", "tool", "lead", { tool: "Bash", ts: 4000, durationMs: 2000 }), // overlaps a's end
    step("d", "tool", "lead", { tool: "Bash", ts: 10000, durationMs: 500 }),
    step("e", "note", "lead", { ts: 0, durationMs: 99999 }), // not a tool
  ]),
  5000 + 500,
);
assert.equal(toolTime([]), 0);
assert.equal(formatDuration(400), "0.4 s");
assert.equal(formatDuration(12_400), "12 s");
assert.equal(formatDuration(185_000), "3 min 5 s");
assert.equal(formatDuration(120_000), "2 min");
assert.equal(formatDuration(80 * 60_000), "1 h 20 min");
assert.equal(formatDuration(-1), "");

// ── maskText: secrets and home folders ──
{
  const m = maskText("open /Users/alice/app/x.ts and C:\\Users\\bob\\app and /home/carol/src; key sk-ant-abcdefghijklmnop mail a@b.com");
  assert.ok(!/alice|bob|carol|sk-ant-abc|a@b\.com/.test(m), m);
  assert.ok(m.includes("~/app/x.ts"), m);
  assert.equal(maskText("/Users/Shared/data"), "/Users/Shared/data");
  assert.equal(maskText("/tmp/x/-Users-alice-Developer-app/s.jsonl"), "/tmp/x/-Users-~-Developer-app/s.jsonl");
  assert.equal(maskText("C--Users-bob-app and -home-carol-src"), "C--Users-~-app and -home-~-src");
  assert.equal(maskText("disk-usage-monitor"), "disk-usage-monitor");
  // Home folders only at a path boundary: not inside a URL.
  assert.equal(maskText("see https://example.com/home/page and https://x.io/Users/bob/1"), "see https://example.com/home/page and https://x.io/Users/bob/1");
  assert.equal(maskText('cd /home/carol && x="/Users/dan/a" (C:\\Users\\eve\\b) PATH=/Users/fay/bin:/home/gus/bin'), 'cd ~ && x="~/a" (~\\b) PATH=~/bin:~/bin');
  // Private keys, including a block cut off before its end, keep their line count.
  const key = "a\n-----BEGIN RSA PRIVATE KEY-----\nMIIEabc\nQWERTY\n-----END RSA PRIVATE KEY-----\nb";
  const mk = maskText(key);
  assert.ok(!/MIIE|QWERTY/.test(mk), mk);
  assert.equal(mk.split("\n").length, key.split("\n").length);
  assert.ok(!/MIIE/.test(maskText("-----BEGIN PRIVATE KEY-----\nMIIEcut")));
  // A user name seen in a home folder is masked anywhere after that (ls -l owners, prompts), as a whole word.
  rememberHomes(["/Users/zelda/app", "C:\\Users\\yorick\\x", "/tmp"]);
  assert.equal(maskText("-rw-r--r-- 1 zelda staff 10 a.txt; yorick@host; zeldas"), "-rw-r--r-- 1 ••• staff 10 a.txt; •••@host; zeldas");
  maskText("cd /home/quentin/src");
  assert.equal(maskText("owner quentin"), "owner •••");
  // Short names would hide ordinary words, so they're left alone.
  rememberHomes(["/Users/bo/x"]);
  assert.equal(maskText("bo knows"), "bo knows");
  assert.equal(maskText("plain words"), "plain words");
}

// ── conversationRows on a real-shaped session ──
{
  const t0 = Date.parse("2026-11-01T10:00:00Z");
  const at = (s: number) => new Date(t0 + s * 1000).toISOString();
  const main = [
    { type: "user", timestamp: at(0), message: { content: "fix the bug" } },
    { type: "assistant", timestamp: at(1), message: { id: "m1", model: "claude-opus-4-5-20251101", stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "Let me look." }, { type: "tool_use", id: "r1", name: "Read", input: { file_path: "/a.ts" } }] } },
    { type: "user", timestamp: at(2), message: { content: [{ type: "tool_result", tool_use_id: "r1", content: "ok" }] } },
    { type: "assistant", timestamp: at(3), message: { id: "m2", stop_reason: "tool_use", content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "ls" } }] } },
    { type: "system", subtype: "api_error", timestamp: at(4), error: { message: "overloaded" } },
    {}, { type: "weird" }, { type: "assistant" }, null,
    { type: "user", timestamp: at(5), message: { content: [{ type: "tool_result", tool_use_id: "b1", content: "The user doesn't want to proceed with this tool use.", is_error: true }] } },
    { type: "assistant", timestamp: at(6), message: { id: "m3", stop_reason: "tool_use", content: [{ type: "tool_use", id: "a1", name: "Agent", input: { description: "Checker", prompt: "check it" } }] } },
    { type: "assistant", timestamp: at(8), message: { id: "m4", stop_reason: "end_turn", content: [{ type: "text", text: "**Done**" }] } },
  ];
  const agents = {
    x1: { meta: { toolUseId: "a1", description: "Checker" }, records: [
      { type: "user", timestamp: at(6), message: { content: "check it" } },
      { type: "assistant", timestamp: at(7), message: { id: "h1", stop_reason: "tool_use", content: [{ type: "tool_use", id: "g1", name: "Grep", input: { pattern: "x" } }] } },
    ] },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = buildSession(main as any, agents, t0 + 3600_000);
  const turn = model.turns[0];
  const rows = conversationRows(turn, model.actors, { open: false });
  const kinds = rows.map((r) => `${r.kind}:${r.step.tool ?? r.step.kind}`);
  assert.deepEqual(kinds, ["you:prompt", "text:note", "tool:Read", "tool:Bash", "error:note", "text:Agent", "tool:Grep", "text:reply"], kinds.join(" "));
  const byTool = (name: string) => rows.find((r) => r.step.tool === name)!;
  assert.equal(byTool("Bash").outcome, "denied");
  assert.equal(byTool("Grep").outcome, "orphan", "a helper call with no result in a finished request");
  assert.equal(byTool("Grep").depth, 1);
  assert.equal(byTool("Grep").speaker, "x1");
  assert.equal(byTool("Read").depth, 0);
  assert.equal(rows[1].step.thinking, "hmm");
  assert.equal(rows[1].step.model, "claude-opus-4-5-20251101");
  assert.equal(rowText(rows[0]), "fix the bug");
  assert.ok(rowText(byTool("Read")).includes("a.ts"));
  // A brief is spoken by the lead, not the helper it goes to.
  assert.equal(rows[5].speaker, "lead");
  assert.equal(rows[5].depth, 0);
  // Open requests don't call running tools orphans.
  assert.equal(conversationRows(turn, model.actors, { open: true }).find((r) => r.step.tool === "Grep")?.outcome, undefined);
  // The "Remembers earlier" step only appears from the second request on, as a memory row.
  const two = buildSession([...main, { type: "user", timestamp: at(20), message: { content: "again" } }] as never, agents, t0 + 3600_000);
  assert.deepEqual(conversationRows(two.turns[1], two.actors, { open: false }).map((r) => r.kind), ["you", "memory"]);
  // Malformed actors map never crashes.
  const lonely: Record<string, Actor> = {};
  assert.equal(conversationRows(turn, lonely, { open: false }).length, rows.length);
}

// ── big edits: plain before/after instead of a slow diff; row limit ──
{
  const big = "line\n".repeat(30_000); // 150 KB each side, 300 KB together
  const d = editDiff("Edit", { old_string: big, new_string: big + "more\n" }, undefined)!;
  assert.equal(d.hunks.length, 1);
  assert.equal(d.removed, 30_000);
  assert.equal(d.added, 30_001);
  const t0 = Date.now();
  assert.equal(diffRows(d.hunks[0], 400).length, 400);
  assert.ok(Date.now() - t0 < 500);
  const h = { oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: ["-a1", "-a2", "+b1", "+b2", " c"] };
  assert.deepEqual(diffRows(h, 3).map((r) => r.text), ["a1", "a2", "b1"]);
}

// ── find text: markdown renders to the same blocks react-markdown makes ──
{
  // Blocks of rendered HTML: text inside the same block element is joined, a new block element starts a new one.
  const BLOCK = /^(p|li|h[1-6]|td|th|pre|blockquote|ul|ol|table|thead|tbody|tr|div)$/;
  const decode = (t: string) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  const htmlBlocks = (html: string) => {
    const pieces: { text: string; block: unknown }[] = [];
    const stack: number[] = [0];
    let id = 0;
    for (const m of html.matchAll(/<(\/?)([a-z0-9]+)[^>]*?(\/?)>|([^<]+)/g)) {
      if (m[4]) pieces.push({ text: decode(m[4]), block: stack.at(-1) });
      else if (BLOCK.test(m[2]) && !m[3]) {
        if (m[1]) stack.pop();
        else stack.push(++id);
      }
    }
    return joinPieces(pieces).text.split("\n").map((b) => b.replace(/\n$/, "")).filter((b) => b.trim());
  };
  const render = (src: string) => htmlBlocks(renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkGfm] }, src)));
  const samples = [
    "Just one line.",
    "## Summary\n\nI fixed **two** bugs in `src/app.ts`:\n\n1. The [login page](https://x.com) crashed when *empty*.\n2. Tests: `pnpm test` all ~~fail~~ pass.",
    "- [x] done item\n- nested\n  - inner item\n\n> Note: snake_case_name stays.",
    "| File | Change |\n|------|--------|\n| a.ts | added `x` |\n| b.ts | **removed** |",
    "Line one\nline two with &amp; entity and <b>html</b>.\n\n---\nFinal *words*.",
    "Title\n=====\n\nText with an image ![alt](http://x/y.png) inside and <https://auto.link>.",
  ];
  for (const src of samples) {
    const html = render(src).join("\n");
    // Code panels are compared without their trailing newline; everything else exactly.
    assert.equal(markdownText(src).join("\n"), html, src);
  }
  // Fenced code is one block, kept as written.
  assert.deepEqual(markdownText("Run:\n\n```sh\nnpm i\nnpm test\n```\nDone."), ["Run:", "npm i\nnpm test", "Done."]);

  // joinPieces / findAll
  const j = joinPieces([{ text: "const ", block: 1 }, { text: "x", block: 1 }, { text: "next", block: 2 }]);
  assert.equal(j.text, "const x\nnext");
  assert.deepEqual(j.starts, [0, 6, 8]);
  assert.deepEqual(findAll("Foo foo FOO", "foo"), [0, 4, 8]);
  assert.deepEqual(findAll("aaaa", "aa"), [0, 2]);
  assert.deepEqual(findAll("x", ""), []);
}

// ── find text: rows, including folded tool details and masking ──
{
  const id = (t: string) => t;
  const bash = step("b", "tool", "lead", { tool: "Bash", title: "Runs a command", subtitle: "list files", what: "Claude typed a [[command:command]] into the terminal.",
    input: { command: "ls /Users/alice" }, result: { stdout: "notes.txt\nsecret.md\n", stderr: "warn: x", interrupted: false }, status: "success" });
  const toolRow = { id: "b", kind: "tool" as const, step: bash, speaker: "lead", depth: 0 };
  const text = rowSearchText(toolRow, id);
  assert.deepEqual(text.split("\n"), ["Runs a command", "list files", "Claude typed a command into the terminal.", "ls /Users/alice", "notes.txt", "secret.md", "warn: x"]);
  assert.ok(rowSearchText(toolRow, maskText).includes("ls ~"), "masked like the page");
  // The exit-code line is a badge in the page, not output text.
  assert.deepEqual(toolBodyText({ ...bash, result: "Error: Exit code 2\nboom", status: "error" }, id), ["ls /Users/alice", "boom"]);
  // A message row searches the rendered markdown and its thinking, not the markdown source or UI words.
  const reply = step("r", "reply", "you", { from: "lead", quote: "Fixed **the bug** in [app](http://x)", thinking: "check tests first" });
  assert.equal(rowSearchText({ id: "r", kind: "text", step: reply, speaker: "lead", depth: 0 }, id), "Fixed the bug in app\ncheck tests first");
  // Edits: the path and each diff line.
  const edit = step("e", "tool", "lead", { tool: "Edit", title: "Changes a file", subtitle: "a.ts", what: "w", input: { file_path: "/p/a.ts", old_string: "x = 1", new_string: "x = 2" }, status: "success" });
  assert.deepEqual(toolBodyText(edit, id), ["/p/a.ts", "x = 1", "x = 2"]);
  // Questions: question, options, descriptions, your own answer.
  const ask = step("q", "message", "you", { tool: "AskUserQuestion", status: "success",
    input: { questions: [{ question: "Which name?", header: "Name", options: [{ label: "cc-trace", description: "short" }, { label: "other" }] }] },
    result: { answers: { "Which name?": "my own" } } });
  assert.deepEqual(toolBodyText(ask, id), ["Which name?", "cc-trace", "short", "other", "my own"]);
  // Special rows other than errors have no searchable text; your message is searched as written.
  const you = step("p", "prompt", "you", { quote: "make it **blue**" });
  assert.equal(rowSearchText({ id: "p", kind: "you", step: you, speaker: "you", depth: 0 }, id), "make it **blue**");
  assert.equal(rowSearchText({ id: "m", kind: "memory", step: step("m", "memory", "lead"), speaker: "lead", depth: 0 }, id), "");
}

console.log("conversation checks passed");
