// Self-check for the URL hash <-> route mapping.
//   node --experimental-strip-types scripts/route.check.mts
import assert from "node:assert/strict";
import { formatRoute, parseRoute } from "../src/lib/route.ts";
import { DEFAULT_SETTINGS, parseSettings } from "../src/lib/settings.ts";

const DEFAULT = { page: "session", view: "map" };
const enc = encodeURIComponent;

// Every hash form round-trips unchanged.
const posix = "-Users-me-app/a.jsonl";
const forms = [
  `#/s/${enc(posix)}/map`,
  `#/s/${enc(posix)}/3/map`,
  `#/s/${enc(posix)}/0/conversation?step=t1-5`,
  `#/s/${enc(posix)}/2/stats`,
  `#/s/${enc(posix)}/health`,
  `#/s/${enc(posix)}/files`,
  `#/s/${enc(posix)}/agents`,
  `#/s/${enc(posix)}/flow`,
  `#/s?project=${enc("-Users-me-app")}`,
  `#/s?view=stats`,
  "#/dashboard",
  "#/live",
  "#/search",
  "#/search?q=",
  `#/search?q=${enc("fix the bug & more?")}`,
  `#/compare?a=${enc(posix)}&b=${enc("-Users-me-app/b.jsonl")}`,
  "#/bookmarks",
];
for (const h of forms) assert.equal(formatRoute(parseRoute(h)), h, h);

assert.deepEqual(parseRoute(`#/s/${enc(posix)}/3/conversation?step=t1-5`), {
  page: "session",
  file: posix,
  turn: 3,
  view: "conversation",
  step: "t1-5",
});
assert.deepEqual(parseRoute("#/search?q=hello%20world"), { page: "search", view: "map", q: "hello world" });
assert.deepEqual(parseRoute(`#/compare?a=${enc("x/a.jsonl")}&b=${enc("x/b.jsonl")}`), {
  page: "compare",
  view: "map",
  file: "x/a.jsonl",
  other: "x/b.jsonl",
});

// Awkward file names survive the trip both ways.
const awkward = [
  "-Users-me-my project/#1 100% done.jsonl",
  "C:\\Users\\me\\.claude\\projects\\C--Users-me-app\\a.jsonl",
  "C--Users-me-app\\a b#c%d?e&f=g.jsonl",
];
for (const file of awkward) {
  for (const r of [
    { page: "session", file, turn: 4, view: "files", step: "s#1%" },
    { page: "session", file, view: "map" },
    { page: "compare", file, other: file + "2", view: "map" },
  ] as const) {
    const h = formatRoute(r);
    assert.ok(h.startsWith("#/") && !h.slice(1).includes("#"), `no raw # in ${h}`);
    assert.deepEqual(parseRoute(h), r, h);
    assert.equal(formatRoute(parseRoute(h)), h);
  }
}

// Empty and garbage fall back to the default route.
for (const h of ["", "#", "#/", "/", "#/nope", "#/session", "#/s/%E0%A4%A/map", "#/search?q=%ZZ", "garbage", "#/s/a.jsonl/notaview"]) {
  const r = parseRoute(h);
  if (h === "#/s/a.jsonl/notaview") assert.deepEqual(r, { page: "session", file: "a.jsonl", view: "map" }, h);
  else assert.deepEqual(r, DEFAULT, h);
}
assert.equal(formatRoute({ page: "session", view: "map" }), "");
// An unknown view in a hand-made route never reaches the URL.
assert.equal(formatRoute({ page: "session", file: "a.jsonl", view: "bogus" as "map" }), "#/s/a.jsonl/map");

console.log("route checks passed");

// Settings read from storage: bad or unknown values fall back to the defaults.
assert.deepEqual(parseSettings(null), DEFAULT_SETTINGS);
assert.deepEqual(parseSettings("not json"), DEFAULT_SETTINGS);
assert.deepEqual(parseSettings("null"), DEFAULT_SETTINGS);
assert.deepEqual(parseSettings(JSON.stringify({ theme: "pink", textScale: 2, maskSensitive: "yes", extra: 1 })), DEFAULT_SETTINGS);
assert.deepEqual(parseSettings(JSON.stringify({ theme: "light", textScale: 1.15, maskSensitive: true })), {
  ...DEFAULT_SETTINGS,
  theme: "light",
  textScale: 1.15,
  maskSensitive: true,
});
console.log("settings checks passed");
