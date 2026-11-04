// Find in this request: the plain text each chat row shows, worked out from the data so rows that are
// off screen (virtualized) or folded (a tool step's details) can be searched too.
//
// The rule both sides follow: text is split into blocks (paragraphs, list items, table cells, code panels,
// lines of a diff...). A match never crosses a block. Inside a block, text is joined exactly as it renders.
// UI wording ("You", "Copy", "Why?", "Show all", labels and badges) is not searched: in the page it carries
// `data-find-skip`, and it doesn't appear here. The page side lives in src/components/find-bar.tsx.
import {
  CAPS,
  codeText,
  markdownSource,
  maskLines,
  outputText,
  questionData,
  readData,
  searchData,
  shortUrl,
  stepDiff,
  textBoxText,
  todoItems,
  webFetchData,
  webSearchData,
  diffRows,
  type ConvRow,
} from "./conversation.ts";
import { SESSION_START, type Step } from "./session.ts";
import { pushAll } from "./num.ts";

/* eslint-disable @typescript-eslint/no-explicit-any -- tool inputs are untyped JSON */

type Mask = (text: string) => string;

// ── markdown ──

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** Inline markdown as it renders: links show their text, emphasis and code marks go, images show nothing. */
function inline(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g, "")
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, "$1")
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, "$1")
    .replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, _t, code: string) => (/^ .* $/.test(code) ? code.slice(1, -1) : code))
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, "$1$2")
    .replace(/(^|[^\w_])_(?=\S)([^_\n]*?\S)_(?![\w_])/g, "$1$2")
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_, e: string) => ENTITIES[e]);
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const SETEXT = /^\s{0,3}(=+|-+)\s*$/;
const HEADING = /^\s{0,3}#{1,6}(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])\s+(\[[ xX]\]\s+)?(.*)$/;
const QUOTE = /^\s{0,3}>\s?/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((c) => inline(c.trim().replace(/\\\|/g, "|")));

/** The blocks of text a markdown document renders, in order (good enough for find; not a full parser). */
export function markdownText(md: string): string[] {
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) {
      const t = inline(para.join("\n"));
      if (t.trim()) out.push(t);
    }
    para = [];
  };
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const close = new RegExp(`^\\s{0,3}${fence[1][0] === "`" ? "`" : "~"}{${fence[1].length},}\\s*$`);
      const code: string[] = [];
      for (i++; i < lines.length && !close.test(lines[i]); i++) code.push(lines[i]);
      if (code.join("\n")) out.push(code.join("\n"));
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (para.length && SETEXT.test(line)) {
      flush(); // the paragraph above was a heading
      continue;
    }
    if (HR.test(line)) {
      flush();
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      flush();
      pushAll(out, cells(line).filter(Boolean));
      for (i += 2; i < lines.length && lines[i].includes("|") && lines[i].trim(); i++) pushAll(out, cells(lines[i]).filter(Boolean));
      i--;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      if (heading[1]?.trim()) out.push(inline(heading[1].trim()));
      continue;
    }
    while (QUOTE.test(line)) line = line.replace(QUOTE, "");
    const item = ITEM.exec(line);
    if (item && !HR.test(line)) {
      flush();
      // A task item renders its checkbox, then " text".
      para = [(item[1] ? " " : "") + item[2].trim()];
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return out;
}

// ── page side: joining text nodes into searchable text ──

/**
 * Joins a unit's text pieces the way find sees them: pieces in the same block are glued together,
 * a new block starts after a newline. `starts[i]` is where piece i begins in `text`.
 */
export function joinPieces(pieces: { text: string; block: unknown }[]): { text: string; starts: number[] } {
  let text = "";
  const starts: number[] = [];
  pieces.forEach((p, i) => {
    if (i > 0 && p.block !== pieces[i - 1].block) text += "\n";
    starts.push(text.length);
    text += p.text;
  });
  return { text, starts };
}

/** Where `needle` occurs in `hay`, ignoring case, without overlaps. */
export function findAll(hay: string, needle: string, max = 5000): number[] {
  const out: number[] = [];
  if (!needle) return out;
  const h = hay.toLowerCase();
  const n = needle.toLowerCase();
  for (let i = h.indexOf(n); i !== -1 && out.length < max; i = h.indexOf(n, i + n.length)) out.push(i);
  return out;
}

// ── data side: each row's blocks ──

const plainTerms = (t: string) => t.replace(/\[\[(\w+):([^\]]+)\]\]/g, "$2");
const md = (text: string, mask: Mask) => markdownText(markdownSource(text, mask));
const code = (value: unknown, mask: Mask) => {
  const t = codeText(value, mask);
  return t ? [t] : [];
};
const str = (v: unknown) => (typeof v === "string" ? v : "");

function diffBlocks(step: Step, mask: Mask): string[] {
  const d = stepDiff(step);
  if (!d) return [];
  const out: string[] = [];
  let budget: number = CAPS.diffRows;
  for (const h of d.hunks) {
    if (budget <= 0) break;
    const rows = diffRows(h, budget);
    budget -= rows.length;
    pushAll(out, maskLines(rows.map((r) => r.text), mask).map((t) => t || " "));
  }
  return out;
}

/** What a tool step's renderer shows, as blocks. Mirrors src/components/tools/*. */
export function toolBodyText(step: Step, mask: Mask): string[] {
  const input = (step.input ?? {}) as any;
  switch (step.tool) {
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit": {
      const path = str(input.file_path ?? input.notebook_path);
      return [...(path ? [mask(path)] : []), ...diffBlocks(step, mask)];
    }
    case "Write": {
      const path = str(input.file_path);
      const diff = diffBlocks(step, mask);
      return [...(path ? [mask(path)] : []), ...(diff.length ? diff : str(input.content) ? code(input.content, mask) : [])];
    }
    case "Read": {
      const r = readData(step);
      return [...(r.path ? [mask(r.path)] : []), ...(!r.isImage && r.content ? code(r.content, mask) : [])];
    }
    case "Bash":
    case "bash":
    case "PowerShell": {
      const out: string[] = code(str(input.command) || JSON.stringify(input), mask).slice();
      const r = step.result as any;
      // Same split as bashOutcome, without the exit-code line.
      const stdout = (r && typeof r === "object" && !Array.isArray(r) ? str(r.stdout) : typeof r === "string" ? r : outputText(step.output)).replace(/^(?:Error: )?Exit code \d+\r?\n?/, "");
      const stderr = r && typeof r === "object" && !Array.isArray(r) ? str(r.stderr) : "";
      if (stdout.trim()) pushAll(out, code(stdout.replace(/\s+$/, ""), mask));
      if (stderr.trim()) pushAll(out, code(stderr.replace(/\s+$/, ""), mask));
      return out;
    }
    case "Grep":
    case "Glob": {
      const s = searchData(step);
      return [mask(s.pattern), ...(s.content ? code(s.content, mask) : s.files.length ? s.files.slice(0, CAPS.files).map(mask) : s.text ? code(s.text, mask) : [])];
    }
    case "WebSearch": {
      const w = webSearchData(step);
      return [
        mask(w.query),
        ...w.links.slice(0, CAPS.webResults).flatMap((l) => [mask(l.title), mask(shortUrl(l.url))]),
        ...(w.summary ? md(w.summary, mask) : []),
      ];
    }
    case "WebFetch": {
      const w = webFetchData(step);
      return [...(w.url ? [mask(w.url)] : []), ...(w.prompt ? [textBoxText(`What Claude wanted to know: ${w.prompt}`, mask)] : []), ...(w.text ? md(w.text, mask) : [])];
    }
    case "AskUserQuestion": {
      const q = questionData(step);
      const out = q.questions.flatMap((x) => [
        mask(x.question),
        ...x.options.flatMap((o) => [mask(o.label), ...(o.description ? [mask(o.description)] : [])]),
        ...(x.other.length ? [mask(x.other.join(", "))] : []),
      ]);
      if (step.status !== "running" && step.status !== "error" && !q.answered && q.out) out.push(mask(q.out));
      return out;
    }
    case "TodoWrite":
    case "TaskCreate":
    case "TaskUpdate":
    case "mcp__ccd_turn__update_plan": {
      const items = todoItems(input);
      if (items.length) return items.map((t) => mask(t.text));
      const subject = str(input.subject) || str(input.description);
      return subject ? [mask(subject)] : [];
    }
    case "Agent":
    case "Task": {
      const out = outputText(step.output);
      return [...(str(input.prompt) ? md(input.prompt, mask) : []), ...(out ? md(out, mask) : [])];
    }
    case "SendMessage":
    case "SubagentHandback": {
      const msg = typeof input.message === "string" ? input.message : outputText(input.message);
      const out = outputText(step.output);
      return [...(msg ? md(msg, mask) : []), ...(out && step.tool === "SendMessage" ? md(out, mask) : [])];
    }
  }
  if (!step.tool) return [];
  const out = outputText(step.output);
  return [...(step.input !== undefined ? code(step.input, mask) : []), ...(step.output !== undefined ? code(out || step.output, mask) : [])];
}

/** The searchable text of one chat row: its blocks joined with newlines. Tool rows include their folded details. */
export function rowSearchText(row: ConvRow, mask: Mask): string {
  const s = row.step;
  const quote = typeof s.quote === "string" ? s.quote : "";
  const thinking = s.thinking ? [mask(s.thinking)] : [];
  let blocks: string[] = [];
  if (row.kind === "you") blocks = quote ? [quote === SESSION_START ? quote : mask(quote)] : [];
  else if (row.kind === "text") blocks = [...(quote ? md(quote, mask) : []), ...thinking];
  else if (row.kind === "tool") blocks = [mask(s.title), mask(s.subtitle), plainTerms(mask(s.what)), ...toolBodyText(s, mask), ...thinking];
  else if (row.kind === "error") blocks = [s.kind === "note" ? plainTerms(mask(s.what)) : mask(typeof s.quote === "string" ? s.quote : s.what)];
  return blocks.filter((b) => b.trim()).join("\n");
}
