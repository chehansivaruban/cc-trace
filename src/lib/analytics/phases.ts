// Phases (N5): each request split into stretches of looking around, changing files, testing, checking the
// result, handing work to helpers and answering you.
import type { Step, Turn } from "../session.ts";
import { FILE_CHANGE_TOOLS, fileOf, pathKey } from "./files.ts";

export type PhaseKind = "exploring" | "changing" | "testing" | "reviewing" | "answering" | "delegating";
export type Phase = { kind: PhaseKind; from: number; to: number };

export const PHASE_LABEL: Record<PhaseKind, string> = {
  exploring: "Looking around",
  changing: "Changing files",
  testing: "Testing",
  reviewing: "Checking the result",
  delegating: "Working with helpers",
  answering: "Answering you",
};

export const PHASE_EXPLAIN: Record<PhaseKind, string> = {
  exploring: "Claude reads files and searches the project to understand it before acting.",
  changing: "Claude creates or changes files, installs software or saves a checkpoint.",
  testing: "Claude runs the tests, builds the app or tries it out to see whether it works.",
  reviewing: "Claude looks back over what it changed to check it's right.",
  delegating: "Claude hands work to helpers and reads their reports.",
  answering: "Claude writes its answer to you or asks you a question.",
};

const EXPLORE_TOOLS = new Set(["Read", "Grep", "Glob", "LS", "WebSearch", "WebFetch", "NotebookRead"]);

/** What a step on its own says about the phase; undefined for steps that just go along (notes, to-do lists). */
function classify(s: Step, changed: Set<string>): PhaseKind | undefined {
  if (s.kind === "reply" || s.tool === "AskUserQuestion") return "answering";
  if (s.kind === "brief" || s.kind === "message" || s.kind === "report") return "delegating";
  if (s.kind !== "tool" || !s.tool) return undefined;
  const file = fileOf(s);
  if (FILE_CHANGE_TOOLS.has(s.tool)) {
    if (file && s.status !== "error") changed.add(pathKey(file));
    return "changing";
  }
  // Re-reading a file it already changed is checking its own work.
  if (s.tool === "Read") return file && changed.has(pathKey(file)) ? "reviewing" : "exploring";
  if (EXPLORE_TOOLS.has(s.tool)) return "exploring";
  switch (s.icon) {
    case "test":
      return "testing";
    case "create":
    case "edit":
    case "install":
    case "save":
    case "upload":
      return "changing";
    case "browser":
      return changed.size ? "testing" : "exploring";
    case "read":
    case "web":
      return "exploring";
    case "search":
      // "Checks the change history" (git status / diff / log) is reviewing; other searches explore.
      return s.title === "Checks the change history" ? "reviewing" : "exploring";
    case "terminal":
      return s.title === "Builds the project" ? "testing" : undefined;
  }
  return undefined;
}

/**
 * The phases of one request, as index ranges into `turn.steps`. Together they cover every step exactly once,
 * in order. Steps that don't show a phase themselves (your message, notes) belong to the phase around them.
 */
export function phasesOf(turn: Turn): Phase[] {
  const steps = Array.isArray(turn?.steps) ? turn.steps : [];
  if (!steps.length) return [];
  const changed = new Set<string>();
  const own = steps.map((s) => classify(s, changed));
  let current = own.find((k) => k !== undefined) ?? "answering";
  const kinds = own.map((k) => (current = k ?? current));
  // Long requests (helpers working side by side) flip back and forth a lot: there, each block of steps takes
  // the phase most of its steps are in, so the band keeps to about MAX_PHASES parts.
  const size = Math.ceil(steps.length / MAX_PHASES);
  if (size > 1) {
    for (let from = 0; from < kinds.length; from += size) {
      const block = kinds.slice(from, from + size);
      const count = new Map<PhaseKind, number>();
      for (const k of block) count.set(k, (count.get(k) ?? 0) + 1);
      const top = [...count].sort((x, y) => y[1] - x[1])[0][0];
      kinds.fill(top, from, from + block.length);
    }
  }
  const phases: Phase[] = [];
  kinds.forEach((k, i) => {
    const last = phases.at(-1);
    if (last && last.kind === k) last.to = i;
    else phases.push({ kind: k, from: i, to: i });
  });
  return phases;
}

const MAX_PHASES = 40;
