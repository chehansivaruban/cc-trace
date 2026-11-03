// Self-check for settings, bookmarks, attention alerts, keyboard shortcuts and the debug log helpers.
//   node --no-warnings --experimental-strip-types scripts/ux.check.mts
import assert from "node:assert/strict";
import { ATTENTION_NOTIFIES, needsAttention } from "../src/lib/attention.ts";
import { createBookmarkStore } from "../src/lib/bookmarks.ts";
import { createMasker } from "../src/lib/redact.ts";
import { DEBUG_LOG_MAX_BYTES, debugLogName, parseDebugLog, tailText } from "../src/lib/debug-log.ts";
import { buildSession } from "../src/lib/session.ts";
import { DEFAULT_SETTINGS, SETTINGS_KEY, parseSettings, readSettings, resolveTheme, subscribeSettings } from "../src/lib/settings.ts";
import { SHORTCUTS, isTypingTarget, matchShortcut } from "../src/hooks/use-shortcuts.ts";
import { createLayerStack } from "../src/hooks/use-escape.ts";
import { appear, slide } from "../src/lib/motion.ts";
import fs from "node:fs";
import path from "node:path";

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
  // Spacing: comfortable unless "compact" was chosen; junk falls back.
  assert.equal(DEFAULT_SETTINGS.density, "comfortable");
  assert.equal(parseSettings(JSON.stringify({ density: "compact" })).density, "compact");
  assert.equal(parseSettings(JSON.stringify({ density: "tiny" })).density, "comfortable");
  // The script that runs before paint applies it, like the text size.
  const layout = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "app", "layout.tsx"), "utf8");
  assert.match(layout, /data-density/);
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
  // Home folders by their shape always, and the open session's user names when the page passes its masker.
  a.toggle({ file: "p/b.jsonl", step: "h1", label: "Reads /Users/bob/app/x.ts" });
  assert.equal(a.get().items[0].label, "Reads ~/app/x.ts");
  a.toggle({ file: "p/b.jsonl", step: "h2", label: "Ask alice about C:\\Users\\alice\\a" }, createMasker({ names: ["alice"] }));
  assert.equal(a.get().items[0].label, "Ask ••• about ~\\a");
  for (const junk of ["{", "null", "[]", '{"items":"x"}', '{"items":[{},{"file":3},null]}']) {
    mem.set("cc-trace:bookmarks", junk);
    assert.deepEqual(createBookmarkStore(() => ok).get().items, [], junk);
  }
  // Storage that throws: the in-memory copy survives every listener leaving and coming back.
  const mem2 = createBookmarkStore(() => throwing);
  const off1 = mem2.subscribe(() => {});
  mem2.toggle({ file: "p/c.jsonl", label: "Keep me" });
  mem2.setTags("p/c.jsonl", ["kept"]);
  off1();
  const off2 = mem2.subscribe(() => {});
  assert.ok(mem2.has("p/c.jsonl"), "memory-only bookmarks survive unmount");
  assert.deepEqual(mem2.tags("p/c.jsonl"), ["kept"]);
  off2();
  // A store whose writes fail (full or blocked) keeps its copy too, even though reads work.
  const readOnly = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
  const mem3 = createBookmarkStore(() => readOnly);
  mem3.subscribe(() => {})();
  mem3.toggle({ file: "p/d.jsonl", label: "x" });
  const off3 = mem3.subscribe(() => {});
  off3();
  mem3.subscribe(() => {});
  assert.ok(mem3.has("p/d.jsonl"), "a failed write never loses the change");

  // A dropped file isn't in the Claude folder, so it can't be reopened later: never bookmarked.
  const dropStore = createBookmarkStore(() => ok);
  const before = dropStore.get().items.length;
  dropStore.toggle({ file: "dropped:session.jsonl", label: "x" });
  dropStore.toggle({ file: "dropped:session.jsonl", step: "s1", label: "x" });
  assert.equal(dropStore.get().items.length, before, "dropped files are never bookmarked");
  assert.ok(!dropStore.has("dropped:session.jsonl"));

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
  // An unanswered question still needs you after the session goes idle.
  const later = needsAttention(buildSession(base, {}, t0 + 10 * 60_000), t0 + 10 * 60_000);
  assert.equal(later?.reason, "question", "a question left unanswered keeps needing you");

  const plan = [base[0], { type: "assistant", timestamp: at(1), message: { id: "m1", stop_reason: "tool_use", content: [{ type: "tool_use", id: "p1", name: "ExitPlanMode", input: { plan: "1. do it" } }] } }];
  assert.equal(needsAttention(buildSession(plan, {}, t0 + 5_000), t0 + 5_000)?.reason, "plan");
  assert.equal(needsAttention(buildSession(plan, {}, t0 + 60 * 60_000), t0 + 60 * 60_000)?.reason, "plan", "a plan waiting an hour still needs you");

  // Logs never record a permission prompt, so it's a guess, and a careful one. Commands (tests, builds,
  // installs) often run for minutes: never guessed.
  const call = (name: string, input: unknown, extra: Record<string, unknown> = {}) => ({ type: "assistant", timestamp: at(1), ...extra, message: { id: "m1", stop_reason: "tool_use", content: [{ type: "tool_use", id: "c1", name, input }] } });
  const ask1 = (mode: string | undefined, name = "Edit", input: unknown = { file_path: "/a", old_string: "x", new_string: "y" }) => [
    { type: "user", timestamp: at(0), ...(mode ? { permissionMode: mode } : {}), message: { content: "go" } },
    call(name, input),
  ];
  const guess = (recs: unknown[], s: number) => needsAttention(buildSession(recs as never[], {}, t0 + s * 1000), t0 + s * 1000)?.reason;
  assert.equal(guess(ask1("default", "Bash", { command: "npm test" }), 30), undefined, "a long command is just running");
  assert.equal(guess(ask1("default", "PowerShell", { command: "dir" }), 30), undefined);
  // The lead's own edit, web fetch or MCP tool, waiting 20 s in a mode that asks, with the whole session quiet.
  assert.equal(guess(ask1("default"), 15), undefined, "under 20 s it's still working");
  assert.equal(guess(ask1("default"), 30), "permission");
  assert.equal(guess(ask1("plan", "WebFetch", { url: "https://x" }), 30), "permission");
  assert.equal(guess(ask1("default", "mcp__github__create_issue", {}), 30), "permission");
  assert.equal(guess(ask1(undefined), 30), "permission", "older logs without a mode ran in the default mode");
  assert.equal(guess(ask1("acceptEdits"), 30), undefined, "edits don't ask in acceptEdits");
  assert.equal(guess(ask1("acceptEdits", "WebFetch", { url: "https://x" }), 30), "permission");
  for (const mode of ["auto", "dontAsk", "bypassPermissions"]) assert.equal(guess(ask1(mode), 30), undefined, `no prompts in ${mode}`);
  assert.equal(guess(ask1("default", "Read", { file_path: "/a" }), 30), undefined, "reading never asks");
  assert.equal(guess(ask1("default"), 10 * 60), undefined, "the permission guess stops once the session is stale");
  // Anything newer from anyone (a helper still working, a system record) means the session isn't waiting.
  const busy = [...ask1("default"), { type: "system", subtype: "turn_duration", timestamp: at(25) }];
  assert.equal(guess(busy, 30), undefined, "the session isn't quiet");
  assert.equal(guess(busy, 50), "permission", "quiet again for 20 s");
  const helperEdit = needsAttention(
    buildSession([ask1("default")[0]] as never[], { h1: { records: [{ type: "assistant", timestamp: at(1), message: { id: "h", stop_reason: "tool_use", content: [{ type: "tool_use", id: "e9", name: "Edit", input: { file_path: "/b" } }] } }] } }, t0 + 30_000),
    t0 + 30_000,
  );
  assert.equal(helperEdit, undefined, "only the lead's own tools are guessed");
  // The guess shows the badge only; questions and plans may also notify.
  assert.deepEqual(ATTENTION_NOTIFIES, { question: true, plan: true, permission: false });

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
  assert.equal(press("j", { isComposing: true }).action, undefined, "typing with an input method is never a shortcut");
  assert.equal(press("g", { isComposing: true }).pending, null);

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

// ── Escape: one layer at a time ──
{
  const closed: string[] = [];
  const layers = createLayerStack();
  const esc = (target: unknown = { closest: () => null }, extra: Record<string, unknown> = {}) => layers.handle({ key: "Escape", target, ...extra });
  const offDrawer = layers.push(() => closed.push("drawer"));
  const offDialog = layers.push(() => closed.push("dialog"));
  const offOverlay = layers.push(() => closed.push("overlay"));
  assert.ok(esc());
  assert.deepEqual(closed, ["overlay"], "the newest layer closes first, and only it");
  offOverlay();
  assert.ok(esc());
  offDialog();
  assert.ok(esc());
  assert.deepEqual(closed, ["overlay", "dialog", "drawer"]);
  offDrawer();
  assert.equal(esc(), false, "nothing open: Escape is left alone");
  assert.equal(layers.size, 0);

  layers.push(() => closed.push("dialog2"));
  const field = (value: string) => ({ value, closest: (sel: string) => (/input/.test(sel) ? { value } : null) });
  assert.equal(esc(field("half a search")), false, "a box with text keeps its Escape");
  assert.equal(esc({ isContentEditable: true, closest: () => null }), false, "editable text keeps its Escape");
  assert.equal(esc({ closest: (sel: string) => (/menu/.test(sel) ? {} : null) }), false, "a menu closes itself");
  assert.equal(esc(undefined, { isComposing: true }), false, "input method typing");
  assert.equal(esc(undefined, { defaultPrevented: true }), false, "already handled (find bar)");
  assert.equal(esc(undefined, { key: "Enter" }), false);
  assert.deepEqual(closed.slice(3), [], "none of those closed anything");
  assert.ok(esc(field("")), "an empty box lets Escape close its layer");
  assert.deepEqual(closed.slice(3), ["dialog2"]);
  console.log("escape checks passed");
}

// ── reduce motion: every animation goes through framer's positional keys or the app's own setting ──
{
  // MotionConfig reducedMotion stops x/y/scale but not a raw `transform` string, and framer's own
  // useReducedMotion only reads the system, not Settings → Reduce motion.
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "src");
  const bad: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) {
        const text = fs.readFileSync(p, "utf8");
        if (/(initial|animate|exit)=\{\{[^}]*\btransform:/.test(text)) bad.push(`${e.name}: raw transform in a motion prop`);
        // Moves go through appear()/slide() in lib/motion.ts, which fade only when motion is reduced. The story
        // map's envelope is the one exception: it isn't drawn at all then.
        if (e.name !== "story-map.tsx" && /(initial|animate|exit)=\{\{[^}]*\b(x|y|scale|rotate):/.test(text)) bad.push(`${e.name}: a move that ignores reduce motion`);
        if (/import \{[^}]*\buseReducedMotion\b[^}]*\} from "framer-motion"/.test(text)) bad.push(`${e.name}: framer's useReducedMotion ignores the setting`);
      }
    }
  };
  walk(root);
  assert.deepEqual(bad, []);
  const moves = (o: object) => JSON.stringify(o).match(/"(x|y|scale)"/g) ?? [];
  assert.deepEqual(moves(appear(true, { y: 8, scale: 0.98 })), [], "reduced: a fade, no move");
  assert.deepEqual(moves(slide(true, { x: "-100%" })), []);
  assert.deepEqual(appear(false, { scale: 0.98 }).animate, { opacity: 1, scale: 1 });
  assert.deepEqual(slide(false, { y: "100%" }).animate, { y: 0 });
  console.log("reduce motion checks passed");
}

console.log("ux checks passed");
