// Story summary (N1): a plain-English paragraph for a request or a whole session, built from the
// recorded steps. No AI: the same session always gives the same words. Text may hold [[term:label]] markers.
import { SESSION_START, isErrorStep, isFailed, totalTokens, type SessionModel, type Step, type Turn } from "../session.ts";

const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const WEB_TOOLS = new Set(["WebFetch", "WebSearch"]);

export const formatCount = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const plural = (n: number, word: string, many = word + "s") => `${formatCount(n)} ${n === 1 ? word : many}`;
const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${formatCount(n)} times`);
/** "A", "A and B", "A, B and C", "A, B, C and 2 others". */
export function listNames(names: string[], max = 3): string {
  if (names.length > max) return `${names.slice(0, max).join(", ")} and ${plural(names.length - max, "other")}`;
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
};
const fileOf = (s: Step) => {
  const p = (s.input as { file_path?: unknown; notebook_path?: unknown } | undefined) ?? {};
  const f = typeof p.file_path === "string" ? p.file_path : typeof p.notebook_path === "string" ? p.notebook_path : "";
  return f.trim();
};

type Mask = (s: string) => string;
const keep: Mask = (s) => s;

type Facts = {
  reads: Set<string>;
  changed: Set<string>;
  direct: string[]; // helpers Claude (the lead) asked
  nested: string[]; // helpers other helpers brought in
  tests: number;
  lastTestFailed: boolean;
  commands: number;
  web: number;
  errors: number;
  failedHelpers: string[];
  messages: number;
  interrupted: boolean;
  replied: boolean;
};

function factsOf(steps: Step[], m: SessionModel, mask: Mask): Facts {
  const f: Facts = { reads: new Set(), changed: new Set(), direct: [], nested: [], tests: 0, lastTestFailed: false, commands: 0, web: 0, errors: 0, failedHelpers: [], messages: 0, interrupted: false, replied: false };
  const briefed = new Set<string>();
  for (const s of steps) {
    if (s.kind === "brief") {
      if (briefed.has(s.actor)) continue;
      briefed.add(s.actor);
      const name = mask(m.actors[s.actor]?.name ?? "a helper");
      (s.from === "lead" || !s.from ? f.direct : f.nested).push(name);
      continue;
    }
    if (s.kind === "message" && s.from && s.actor !== "you") f.messages++;
    if (s.kind === "reply") f.replied = true;
    if (s.event === "interrupted") f.interrupted = true;
    if (isErrorStep(s)) f.errors++;
    if (s.kind === "report" && s.status === "error" && s.from) f.failedHelpers.push(mask(m.actors[s.from]?.name ?? "A helper"));
    if (s.kind !== "tool") continue;
    if (s.tool === "Read" && fileOf(s)) f.reads.add(fileOf(s));
    else if (EDIT_TOOLS.has(s.tool ?? "") && fileOf(s)) f.changed.add(fileOf(s));
    else if (s.icon === "test") {
      f.tests++;
      f.lastTestFailed = isFailed(s);
    } else if (s.tool === "Bash" || s.tool === "PowerShell") f.commands++;
    else if (WEB_TOOLS.has(s.tool ?? "")) f.web++;
  }
  return f;
}

/** "read 12 files, asked 2 helpers (…) for help, changed 3 files and ran the tests twice". */
function doings(f: Facts): string[] {
  const parts: string[] = [];
  if (f.reads.size) parts.push(`read ${plural(f.reads.size, "[[file:file]]", "[[file:files]]")}`);
  if (f.web) parts.push(`looked things up on the web ${times(f.web)}`);
  if (f.direct.length || f.nested.length) {
    const asked = f.direct.length
      ? `asked ${plural(f.direct.length, "[[helper:helper]]", "[[helper:helpers]]")} (${listNames(f.direct)}) for help`
      : "had help from other helpers";
    parts.push(asked + (f.direct.length && f.nested.length ? `, who brought in ${formatCount(f.nested.length)} more (${listNames(f.nested)})` : f.nested.length ? ` (${listNames(f.nested)})` : ""));
  }
  if (f.changed.size) parts.push(`changed ${plural(f.changed.size, "file")}`);
  if (f.commands) parts.push(`ran ${plural(f.commands, "[[command:command]]", "[[command:commands]]")}`);
  if (f.tests) parts.push(`ran the [[tests:tests]] ${times(f.tests)}`);
  return parts;
}

function outcome(f: Facts, live: boolean): string {
  if (f.interrupted) return "You stopped Claude before it finished.";
  if (live) return "It is still working.";
  const out: string[] = [];
  if (f.failedHelpers.length) out.push(`${listNames([...new Set(f.failedHelpers)])} stopped before finishing.`);
  if (f.lastTestFailed) out.push("It finished, but the last test run still found problems.");
  else if (!f.errors) out.push("It finished without errors.");
  else out.push(`${plural(f.errors, "step")} hit errors along the way, and Claude worked around ${f.errors === 1 ? "it" : "them"}.`);
  return out.join(" ");
}

/**
 * A paragraph about one request: what you asked, what Claude did, who helped, what changed, how it ended.
 * `mask` (e.g. maskSecrets) is applied to log text before it is shortened, so a cut can't split a secret.
 */
export function storyOf(turn: Turn, m: SessionModel, mask: Mask = keep): string {
  const f = factsOf(turn.steps, m, mask);
  const before = turn.text === SESSION_START;
  const first = before ? "" : `You asked Claude: “${clip(mask(turn.text), 140)}”. `;
  const subject = before ? "Before your first message here, Claude" : "Claude";
  const parts = doings(f);
  const did = parts.length ? `${subject} ${listNames(parts, parts.length)}.` : before ? `${subject} was already working.` : "Claude answered without using any tools.";
  const talk = f.messages ? ` The agents passed ${plural(f.messages, "message")} between them.` : "";
  const live = m.live.active && turn === m.turns.at(-1);
  return `${first}${did}${talk} ${outcome(f, live)}`;
}

/** A paragraph about the whole session. */
export function sessionStory(m: SessionModel, mask: Mask = keep): string {
  const steps = m.turns.flatMap((t) => t.steps);
  if (!steps.length) return "Nothing has happened in this session yet.";
  const requests = m.turns.filter((t) => t.text !== SESSION_START).length;
  const f = factsOf(steps, m, mask);
  const parts = doings(f);
  const opening = requests ? `Over ${plural(requests, "request")}, Claude` : "Claude";
  const did = parts.length ? `${opening} ${listNames(parts, parts.length)}.` : `${opening} answered without using any tools.`;
  const tokens = totalTokens(m.usage);
  const used = tokens ? ` In total it used ${formatCount(tokens)} [[tokens:tokens]].` : "";
  const stops = m.turns.flatMap((t) => t.steps).filter((s) => s.event === "interrupted").length;
  const stopped = stops ? ` You stopped it ${times(stops)}.` : "";
  const end = m.live.active ? "It is still working." : f.errors ? `${plural(f.errors, "step")} hit errors along the way.` : "Nothing went wrong along the way.";
  return `${did}${used}${stopped} ${end}`;
}
