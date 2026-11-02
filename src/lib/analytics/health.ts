// Health checks (E1, E2): errors and what Claude did next, plus simple local checks for wasted effort.
// No AI involved: every finding comes from counting steps.
import type { Actor, SessionModel, Step, Turn } from "../session.ts";
import { FILE_CHANGE_TOOLS, fileOf, pathKey } from "./files.ts";
import { safeClip } from "../redact.ts";

export type FindingKind = "repeated-tool" | "fix-loop" | "empty-result" | "excessive-reads" | "write-then-edit" | "high-error-rate";
export type Finding = { kind: FindingKind; title: string; explain: string; steps: string[]; turn: number };
export type Recovery = "retried" | "different" | "gave-up";
export type HealthReport = {
  score: number;
  findings: Finding[];
  errors: { total: number; toolCalls: number; mostFailing?: string; items: { step: Step; next: Recovery }[] };
};

/**
 * How much each kind of finding lowers the score; repeats of a kind count for less each time. Weight 0 means a
 * neutral "good to know" note: building a file up in steps is a normal way to work.
 */
export const FINDING_WEIGHT: Record<FindingKind, number> = {
  "fix-loop": 0.12,
  "high-error-rate": 0.12,
  "repeated-tool": 0.08,
  "excessive-reads": 0.05,
  "empty-result": 0.04,
  "write-then-edit": 0,
};

const REPEAT_MIN = 3; // identical calls in a row
const FIX_LOOP_MIN = 3; // failures of the same command, stuck on the same error or with nothing changed
const EMPTY_MIN = 5; // searches in a row that found nothing
const READS_MIN = 3; // reads of one unchanged file
const EDITS_AFTER_WRITE_MIN = 3;
const ERRORS_MIN = 4;
const ERROR_RATE = 0.3;

const COMMAND_TOOLS = new Set(["Bash", "bash", "PowerShell"]);
const SEARCH_TOOLS = new Set(["Grep", "Glob", "LS", "WebSearch"]);
// Checking on something that's still running is meant to repeat.
const POLLING = /^(BashOutput|TaskOutput|TaskGet|TaskList|ListAgents|Monitor|ScheduleWakeup|TodoWrite|TaskUpdate|KillShell|Sleep)$/;
const EMPTY_OUTPUT = /^(no (files|matches|results)( found)?|found 0\b|0 (matches|files|results))/i;

const owner = (s: Step) => s.from ?? s.actor;
const isTool = (s: Step) => s.kind === "tool" && !!s.tool;
const commandOf = (s: Step) => {
  const c = (s.input as { command?: unknown } | null | undefined)?.command;
  return typeof c === "string" ? c.trim() : undefined;
};
const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
// Cut at a word boundary: the page masks this text afterwards, and a key cut in half wouldn't be recognised.
const clip = (t: string, n = 60) => safeClip(t.replace(/\s+/g, " ").trim(), n);

/** Stable JSON: the same input in any key order gives the same text. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** What a call works on: its file, its command, or failing those its whole input. */
function target(s: Step): string {
  const file = fileOf(s);
  if (file) return `${s.tool}:${pathKey(file)}`;
  const cmd = commandOf(s);
  if (cmd !== undefined) return `${s.tool}:${cmd}`;
  return `${s.tool}:${stable(s.input)}`;
}

/** An error message with the noise taken out (numbers, timings, spacing), to tell "the same error" from progress. */
function errorText(s: Step): string {
  const out = typeof s.output === "string" ? s.output : JSON.stringify(s.output ?? "") ?? "";
  return out.slice(0, 4000).toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}

function isEmptyResult(s: Step) {
  if (!SEARCH_TOOLS.has(s.tool ?? "") || s.status !== "success") return false;
  const out = s.output;
  if (out === null || out === undefined) return true;
  if (Array.isArray(out)) return out.length === 0;
  return typeof out === "string" && (!out.trim() || EMPTY_OUTPUT.test(out.trim()));
}

function findingsFor(turn: Turn, actors: Record<string, Actor>): Finding[] {
  const steps = Array.isArray(turn.steps) ? turn.steps : [];
  const tools = steps.filter(isTool);
  const out: Finding[] = [];
  const who = (id: string) => actors[id]?.name ?? "Claude";
  const add = (kind: FindingKind, title: string, explain: string, ids: string[]) => out.push({ kind, title, explain, steps: ids, turn: turn.index });

  // Fix loops: the same command failing again and again, either with the same error each time (the fixes in
  // between didn't help) or with nothing changed in between (trying again can't help). A success ends the loop.
  type Chain = { key: string; cmd: string; ids: string[] };
  const chains: Chain[] = [];
  const open = new Map<string, { chain: Chain; err: string; at: number }>();
  let changes = 0; // successful file changes and other commands so far: things that may have changed the outcome
  for (const s of tools) {
    const cmd = COMMAND_TOOLS.has(s.tool!) ? commandOf(s) : undefined;
    if (!cmd) {
      if (FILE_CHANGE_TOOLS.has(s.tool!) && s.status === "success") changes++;
      continue;
    }
    const key = `${owner(s)}\u0000${cmd}`;
    const cur = open.get(key);
    if (s.status === "error") {
      const err = errorText(s);
      if (cur && (cur.err === err || cur.at === changes)) cur.chain.ids.push(s.id);
      else {
        const chain = { key, cmd, ids: [s.id] };
        chains.push(chain);
        open.set(key, { chain, err, at: changes });
      }
      const now = open.get(key)!;
      now.err = err;
      now.at = changes;
    } else if (s.status === "success") {
      open.delete(key);
      changes++;
    }
  }
  const loops = new Map<string, { cmd: string; ids: string[] }>();
  for (const c of chains) {
    if (c.ids.length < FIX_LOOP_MIN) continue;
    const l = loops.get(c.key);
    if (l) l.ids.push(...c.ids);
    else loops.set(c.key, { cmd: c.cmd, ids: [...c.ids] });
  }
  for (const { cmd, ids } of loops.values()) {
    add("fix-loop", "Kept hitting the same error",
      `The same command (“${clip(cmd)}”) failed ${ids.length} times, either with the same error after each fix or with nothing changed in between. Loops like this use up time and tokens; a hint from you can often break them.`,
      ids);
  }

  // Repeats: the identical call several times in a row by the same agent (file reads are counted below).
  const streak = new Map<string, { key: string; step: Step; ids: string[] }>();
  const streaks: { actor: string; key: string; step: Step; ids: string[] }[] = [];
  for (const s of tools) {
    const actor = owner(s);
    const cmd = commandOf(s);
    if (s.tool === "Read" || POLLING.test(s.tool!) || (cmd && loops.has(`${actor}\u0000${cmd}`))) {
      streak.delete(actor);
      continue;
    }
    const key = `${s.tool}\u0000${stable(s.input)}`;
    const cur = streak.get(actor);
    if (cur?.key === key) cur.ids.push(s.id);
    else {
      const next = { actor, key, step: s, ids: [s.id] };
      streak.set(actor, next);
      streaks.push(next);
    }
  }
  const repeats = new Map<string, { actor: string; step: Step; ids: string[] }>();
  for (const r of streaks) {
    if (r.ids.length < REPEAT_MIN) continue;
    const k = `${r.actor}\u0000${r.key}`;
    const prev = repeats.get(k);
    if (prev) prev.ids.push(...r.ids);
    else repeats.set(k, { actor: r.actor, step: r.step, ids: [...r.ids] });
  }
  for (const { actor, step, ids } of repeats.values()) {
    add("repeated-tool", `Did the same thing ${ids.length} times in a row`,
      `${who(actor)} repeated the exact same step (${step.title.toLowerCase()}${step.subtitle ? `: ${clip(step.subtitle, 50)}` : ""}) ${ids.length} times without doing anything else in between. The same step usually gives the same answer, so this often means Claude was stuck.`,
      ids);
  }

  // Searches that found nothing, several in a row by the same agent.
  const emptyRun = new Map<string, string[]>();
  const emptyRuns: string[][] = [];
  for (const s of tools) {
    const actor = owner(s);
    if (!isEmptyResult(s)) {
      emptyRun.delete(actor);
      continue;
    }
    let run = emptyRun.get(actor);
    if (!run) emptyRuns.push((run = []));
    emptyRun.set(actor, run);
    run.push(s.id);
  }
  for (const ids of emptyRuns) {
    if (ids.length < EMPTY_MIN) continue;
    add("empty-result", `Searched and found nothing, ${ids.length} times in a row`,
      `${ids.length} searches in a row came back empty. Claude may have been looking in the wrong place or for the wrong name. It's harmless, but each try takes a moment.`,
      ids);
  }

  // The same file read over and over without changing in between.
  const reads = new Map<string, Map<string, { actor: string; file: string; ids: string[]; max: string[] }>>();
  for (const s of steps) {
    if (s.event === "compact") reads.clear(); // after tidying its memory, Claude has to look again
    if (!isTool(s) || s.status === "error") continue;
    const file = fileOf(s);
    if (!file) continue;
    const fk = pathKey(file);
    if (FILE_CHANGE_TOOLS.has(s.tool!)) {
      for (const r of reads.get(fk)?.values() ?? []) r.ids = [];
      continue;
    }
    if (s.tool !== "Read") continue;
    const input = s.input as { offset?: unknown; limit?: unknown; pages?: unknown };
    const key = `${owner(s)}\u0000${stable([input.offset, input.limit, input.pages])}`;
    let byFile = reads.get(fk);
    if (!byFile) reads.set(fk, (byFile = new Map()));
    let r = byFile.get(key);
    if (!r) byFile.set(key, (r = { actor: owner(s), file, ids: [], max: [] }));
    r.ids.push(s.id);
    if (r.ids.length > r.max.length) r.max = [...r.ids];
  }
  for (const r of [...reads.values()].flatMap((byFile) => [...byFile.values()])) {
    if (r.max.length < READS_MIN) continue;
    add("excessive-reads", `Opened ${base(r.file)} ${r.max.length} times`,
      `${who(r.actor)} read the same file ${r.max.length} times without it changing in between. Claude usually remembers what it has read, so this can be a sign its memory was getting full.`,
      r.max);
  }

  // A new file, then patched again and again.
  const written = new Map<string, { file: string; ids: string[]; flagged: boolean }>();
  for (const s of tools) {
    const file = fileOf(s);
    if (!file || s.status === "error" || !FILE_CHANGE_TOOLS.has(s.tool!)) continue;
    const key = pathKey(file);
    const w = written.get(key);
    if (s.tool === "Write") {
      if (!w?.flagged) written.set(key, { file, ids: [s.id], flagged: false });
      else w.ids.push(s.id);
      continue;
    }
    if (!w) continue;
    w.ids.push(s.id);
    if (w.ids.length - 1 >= EDITS_AFTER_WRITE_MIN) w.flagged = true;
  }
  for (const w of written.values()) {
    if (!w.flagged) continue;
    add("write-then-edit", `Built ${base(w.file)} up in steps`,
      `Claude created ${base(w.file)}, then changed it ${w.ids.length - 1} more times in the same request. That's a normal way to build something up; it's listed so you can follow how the file took shape.`,
      w.ids);
  }

  // Lots of steps that didn't work.
  const failedTools = tools.filter((s) => s.status === "error");
  if (failedTools.length >= ERRORS_MIN && failedTools.length / tools.length >= ERROR_RATE) {
    add("high-error-rate", "Many steps didn't work",
      `${failedTools.length} of ${tools.length} steps in this request failed. A few errors are normal (Claude reads them and adjusts); this many suggests it was struggling with something.`,
      failedTools.map((s) => s.id));
  }
  return out;
}

/** After the failed step `steps[i]`: did the same agent try it again, try something else, or stop there? */
function recovery(steps: Step[], i: number): Recovery {
  const err = steps[i];
  const who = owner(err);
  for (let j = i + 1; j < steps.length; j++) {
    const s = steps[j];
    if (owner(s) !== who) continue;
    if (err.event === "api_error") {
      if (s.kind !== "note") return "retried";
      continue;
    }
    if (s.tool !== undefined) return target(s) === target(err) ? "retried" : "different";
  }
  return "gave-up";
}

/** 100 when nothing stood out; each finding takes a share off, repeats of the same kind a smaller one. */
export function healthScore(findings: Finding[]): number {
  const seen: Partial<Record<FindingKind, number>> = {};
  let score = 1;
  for (const f of findings) {
    const k = (seen[f.kind] = (seen[f.kind] ?? 0) + 1);
    score *= 1 - FINDING_WEIGHT[f.kind] / k;
  }
  return Math.max(0, Math.floor(score * 100 + 1e-9));
}

/** The health of one request (`turn`) or of the whole session. */
export function healthReport(m: SessionModel, turn?: Turn): HealthReport {
  const turns = turn ? [turn] : Array.isArray(m?.turns) ? m.turns : [];
  const actors = m?.actors ?? {};
  const findings: Finding[] = [];
  const items: HealthReport["errors"]["items"] = [];
  const failures = new Map<string, number>();
  let toolCalls = 0;
  let total = 0;
  for (const t of turns) {
    findings.push(...findingsFor(t, actors));
    const steps = Array.isArray(t.steps) ? t.steps : [];
    steps.forEach((s, i) => {
      if (s.tool !== undefined) toolCalls++;
      if (s.status !== "error") return;
      items.push({ step: s, next: recovery(steps, i) });
      if (s.tool === undefined) return;
      total++;
      failures.set(s.tool, (failures.get(s.tool) ?? 0) + 1);
    });
  }
  let mostFailing: string | undefined;
  for (const [tool, n] of failures) if (!mostFailing || n > failures.get(mostFailing)!) mostFailing = tool;
  return { score: healthScore(findings), findings, errors: { total, toolCalls, mostFailing, items } };
}
