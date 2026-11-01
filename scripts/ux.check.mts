// Self-check for settings, bookmarks, attention alerts, keyboard shortcuts and the debug log helpers.
//   node --no-warnings --experimental-strip-types scripts/ux.check.mts
import assert from "node:assert/strict";
import { needsAttention } from "../src/lib/attention.ts";
import { createBookmarkStore } from "../src/lib/bookmarks.ts";
import { DEBUG_LOG_MAX_BYTES, debugLogName, parseDebugLog, tailText } from "../src/lib/debug-log.ts";
import { buildSession } from "../src/lib/session.ts";
import { DEFAULT_SETTINGS, SETTINGS_KEY, readSettings, resolveTheme, subscribeSettings } from "../src/lib/settings.ts";
import { SHORTCUTS, isTypingTarget, matchShortcut } from "../src/hooks/use-shortcuts.ts";

// ── settings: no stale cache after the last subscriber leaves ──
{
  const store = new Map<string, string>();
  const handlers = new Set<unknown>();
  (globalThis as Record<string, unknown>).window = {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    addEventListener: (_: string, h: unknown) => handlers.add(h),
    removeEventListener: (_: string, h: unknown) => handlers.delete(h),
  };
  store.set(SETTINGS_KEY, JSON.stringify({ theme: "dark" }));
  const off = subscribeSettings(() => {});
  assert.equal(readSettings().theme, "dark");
  assert.equal(handlers.size, 1, "listens to other tabs while subscribed");
  off();
  assert.equal(handlers.size, 0);
  // Another tab changes it while nobody listens: the next reader must see the new value.
  store.set(SETTINGS_KEY, JSON.stringify({ theme: "light", textScale: 1.3 }));
  const off2 = subscribeSettings(() => {});
  assert.equal(readSettings().theme, "light");
  assert.equal(readSettings().textScale, 1.3);
  off2();
  delete (globalThis as Record<string, unknown>).window;

  assert.equal(resolveTheme("dark", null, false), "dark");
  assert.equal(resolveTheme("light", "dark", true), "light");
  assert.equal(resolveTheme("system", null, true), "dark");
  assert.equal(resolveTheme("system", null, false), "light");
  assert.equal(resolveTheme("system", "light", true), "light", "the 0.1 header toggle is honoured until Settings picks one");
  assert.equal(resolveTheme("system", "junk", false), "light");
  assert.deepEqual(DEFAULT_SETTINGS.notifications, false, "notifications are off until switched on");
  console.log("settings store checks passed");
}

// ── bookmarks ──
{
  const throwing = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  const s = createBookmarkStore(() => throwing);
  assert.deepEqual(s.get().items, []);
  s.toggle({ file: "p/a.jsonl", label: "Fix the login" });
  s.toggle({ file: "p/a.jsonl", step: "t1", turn: 2, label: "Reads auth.ts" });
  assert.equal(s.get().items.length, 2, "works in memory when storage throws");
  assert.ok(s.has("p/a.jsonl"));
  assert.ok(s.has("p/a.jsonl", "t1"));
  assert.ok(!s.has("p/a.jsonl", "t2"));
  s.toggle({ file: "p/a.jsonl", step: "t1", label: "x" });
  assert.ok(!s.has("p/a.jsonl", "t1"), "toggling again removes it");
  s.setTags("p/a.jsonl", [" Work ", "work", "", "bug"]);
  assert.deepEqual(s.tags("p/a.jsonl"), ["work", "bug"], "tags are trimmed, lower-cased and unique");
  s.rename("p/a.jsonl", "  Login fix ");
  assert.equal(s.nameOf("p/a.jsonl"), "Login fix");
  s.rename("p/a.jsonl", "  ");
  assert.equal(s.nameOf("p/a.jsonl"), undefined, "an empty name clears it");

  // A storage that works persists, and a second store reads it back; junk in storage is ignored.
  const mem = new Map<string, string>();
  const ok = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  const a = createBookmarkStore(() => ok);
  a.toggle({ file: "p/b.jsonl", label: "token sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 here" });
  a.setTags("p/b.jsonl", ["demo"]);
  const b = createBookmarkStore(() => ok);
  assert.equal(b.get().items.length, 1);
  assert.deepEqual(b.tags("p/b.jsonl"), ["demo"]);
  assert.ok(!b.get().items[0].label.includes("abcdefghijklmnop"), "secrets are masked before they are saved");
  for (const junk of ["{", "null", "[]", '{"items":"x"}', '{"items":[{},{"file":3},null]}']) {
    mem.set("cc-trace:bookmarks", junk);
    assert.deepEqual(createBookmarkStore(() => ok).get().items, [], junk);
  }
  // No storage at all (server render).
  assert.deepEqual(createBookmarkStore(() => undefined).get().items, []);
  console.log("bookmark checks passed");
}

// ── attention ──
{
  const t0 = Date.parse("2026-01-01T00:00:00.000Z");
  const at = (s: number) => new Date(t0 + s * 1000).toISOString();
  const ask = { type: "tool_use", id: "q1", name: "AskUserQuestion", input: { questions: [{ question: "Which colour?" }] } };
  const base = [
    { type: "user", timestamp: at(0), message: { content: "make it pretty" } },
    { type: "assistant", timestamp: at(1), message: { id: "m1", stop_reason: "tool_use", content: [ask] } },
  ];
  const asking = needsAttention(buildSession(base, {}, t0 + 5_000), t0 + 5_000);
  assert.equal(asking?.reason, "question");
  assert.equal(asking?.step?.tool, "AskUserQuestion");

  const answered = [...base, { type: "user", timestamp: at(9), message: { content: [{ type: "tool_result", tool_use_id: "q1", content: "blue" }] } }];
  assert.equal(needsAttention(buildSession(answered, {}, t0 + 10_000), t0 + 10_000), undefined, "answered");
  assert.equal(needsAttention(buildSession(base, {}, t0 + 10 * 60_000), t0 + 10 * 60_000), undefined, "stale session");

  const plan = [base[0], { type: "assistant", timestamp: at(1), message: { id: "m1", stop_reason: "tool_use", content: [{ type: "tool_use", id: "p1", name: "ExitPlanMode", input: { plan: "1. do it" } }] } }];
  assert.equal(needsAttention(buildSession(plan, {}, t0 + 5_000), t0 + 5_000)?.reason, "plan");

  // A command that has been waiting a while with nothing after it is probably a permission prompt.
  const bash = [base[0], { type: "assistant", timestamp: at(1), message: { id: "m1", stop_reason: "tool_use", content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "rm -rf build" } }] } }];
  assert.equal(needsAttention(buildSession(bash, {}, t0 + 3_000), t0 + 3_000), undefined, "a command that just started is still running");
  assert.equal(needsAttention(buildSession(bash, {}, t0 + 30_000), t0 + 30_000)?.reason, "permission");
  const bypass = [{ type: "user", timestamp: at(0), permissionMode: "bypassPermissions", message: { content: "go" } }, bash[1]];
  assert.equal(needsAttention(buildSession(bypass, {}, t0 + 30_000), t0 + 30_000), undefined, "no prompts in bypass mode");
  const reading = [base[0], { type: "assistant", timestamp: at(1), message: { id: "m1", stop_reason: "tool_use", content: [{ type: "tool_use", id: "r1", name: "Read", input: { file_path: "/a" } }] } }];
  assert.equal(needsAttention(buildSession(reading, {}, t0 + 30_000), t0 + 30_000), undefined, "reading never asks");

  // Malformed logs never crash.
  assert.equal(needsAttention(buildSession([{}, null, { type: "assistant" }, { type: "zzz", message: null }] as never[], {}, t0), t0), undefined);
  assert.equal(needsAttention(buildSession([], {}, t0), t0), undefined);
  console.log("attention checks passed");
}

// ── keyboard shortcuts ──
{
  const keys = ["?", "/", "g d", "g l", "1", "j", "ArrowDown", "b", "Escape", "G"];
  const el = (match: boolean) => ({ closest: (sel: string) => (match && /input/.test(sel) ? {} : null) });
  const press = (key: string, extra: Record<string, unknown> = {}, pending: string | null = null) => matchShortcut({ key, target: el(false), ...extra }, pending, keys);

  assert.equal(press("j").action, "j");
  assert.equal(press("ArrowDown").action, "ArrowDown");
  assert.equal(press("?", { shiftKey: true }).action, "?");
  assert.equal(press("G", { shiftKey: true }).action, "G");
  assert.equal(press("j", { target: el(true) }).action, undefined, "typing in a field is ignored");
  assert.equal(press("Escape", { target: el(true) }).action, undefined, "Esc in a field belongs to the field");
  assert.equal(press("j", { target: { isContentEditable: true, closest: () => null } }).action, undefined);
  assert.ok(isTypingTarget(el(true)));
  assert.ok(!isTypingTarget(null));
  assert.ok(!isTypingTarget(el(false)));
  for (const m of ["ctrlKey", "metaKey", "altKey"]) assert.equal(press("j", { [m]: true }).action, undefined, m);
  assert.equal(press("j", { repeat: true }).action, "j", "holding j keeps moving");

  // Two-key sequences.
  const g = press("g");
  assert.equal(g.action, undefined);
  assert.equal(g.pending, "g");
  assert.equal(press("d", {}, "g").action, "g d");
  assert.equal(press("l", {}, "g").action, "g l");
  const miss = press("x", {}, "g");
  assert.equal(miss.action, undefined);
  assert.equal(miss.pending, null);
  assert.equal(press("j", {}, "g").action, "j", "a broken sequence still runs the key on its own");
  assert.equal(press("z").action, undefined);

  // Inside a dialog only Esc works.
  const dialog = { closest: (sel: string) => (/dialog/.test(sel) ? {} : null) };
  assert.equal(press("j", { target: dialog }).action, undefined);
  assert.equal(press("Escape", { target: dialog }).action, "Escape");

  assert.ok(SHORTCUTS.length >= 10 && SHORTCUTS.every((s) => s.keys && s.label));
  console.log("shortcut checks passed");
}

// ── debug log ──
{
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
  assert.equal(debugLogName(`/x/.claude/projects/p/${id}.jsonl`), `${id}.txt`);
  assert.equal(debugLogName(`C:\\Users\\me\\.claude\\projects\\p\\${id}.jsonl`), `${id}.txt`);
  for (const bad of ["/x/s1.jsonl", "/x/../../etc.jsonl", `/x/${id}.txt`, `/x/${id}x.jsonl`, "/x/.jsonl", ""]) assert.equal(debugLogName(bad), null, bad);

  const text = [
    "orphan line before any entry",
    "2026-01-01T00:00:00.000Z [DEBUG] Loading settings",
    "2026-01-01T00:00:01.000Z [WARN] Slow response",
    "2026-01-01T00:00:02.000Z [ERROR] Request failed",
    "    at stack line",
    "",
    "2026-01-01T00:00:03.000Z [INFO] Done",
  ].join("\n");
  const entries = parseDebugLog(text);
  assert.deepEqual(entries.map((e) => e.level), ["debug", "debug", "warn", "error", "info"]);
  assert.equal(entries[3].text, "Request failed\n    at stack line", "continuation lines join the entry above");
  assert.equal(entries[1].ts, Date.parse("2026-01-01T00:00:00.000Z"));
  assert.deepEqual(parseDebugLog(""), []);

  const big = Buffer.from("first line\n" + "x".repeat(50) + "\nlast line\n");
  const start = big.length - 20;
  assert.equal(tailText(big.subarray(start), start), "last line\n", "a cut-off first line is dropped");
  assert.equal(tailText(Buffer.from("a\nb\n"), 0), "a\nb\n", "read from the start: nothing dropped");
  assert.equal(DEBUG_LOG_MAX_BYTES, 2 * 1024 * 1024);
  console.log("debug log checks passed");
}

console.log("ux checks passed");
