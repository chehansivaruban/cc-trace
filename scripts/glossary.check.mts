// Every [[key:label]] marker in the app must name a word in GLOSSARY, or it would show as plain text with no
// explanation. Scans src/ (code, not comments) and checks each entry reads as plain sentences.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GLOSSARY } from "../src/lib/explain.ts";

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const MARKER = /\[\[(\w+):/g;
const COMMENT = /^\s*(\/\/|\/\*|\*)/;

function* files(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (/\.(ts|tsx|mts)$/.test(e.name)) yield p;
  }
}

const unknown: string[] = [];
let seen = 0;
for (const file of files(src)) {
  fs.readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (COMMENT.test(line)) return;
      for (const m of line.matchAll(MARKER)) {
        seen++;
        if (!(m[1] in GLOSSARY)) unknown.push(`${path.relative(src, file)}:${i + 1} [[${m[1]}:`);
      }
    });
}
assert.deepEqual(unknown, [], `markers with no glossary entry:\n${unknown.join("\n")}`);
assert.ok(seen > 20, "the scan found the app's markers");

assert.ok(!fs.existsSync(path.join(src, "lib", "glossary")), "glossary words live in GLOSSARY only");
for (const [k, v] of Object.entries(GLOSSARY)) {
  assert.ok(/^\w+$/.test(k), `key ${k} can be used in a marker`);
  assert.ok(v.length > 20 && /[.!?)]$/.test(v), `${k} is a full sentence`);
  assert.ok(!/\$|\bdollars?\b|\bcheap(er|est|ly)?\b|\bexpensive\b|\bpric(e|es|ed|ing)\b|\bcost(s|ly)?\b|\bbill(ed|ing)?\b/i.test(v), `${k} says nothing about money: ${v}`);
}
console.log(`glossary checks passed (${seen} markers, ${Object.keys(GLOSSARY).length} words)`);
