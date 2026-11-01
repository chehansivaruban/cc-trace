// "Why Claude did this": each tool step points back to what its agent last said about its plan.
import type { Step, Turn } from "../session.ts";

/**
 * The closest earlier note ("Let me check the tests…") written by the same agent in the same request.
 * Notes about events (failed requests, memory tidying) aren't explanations and are skipped.
 */
export function nearestExplanation(turn: Turn, stepId: string): Step | undefined {
  const i = turn.steps.findIndex((s) => s.id === stepId);
  if (i < 0) return undefined;
  const actor = turn.steps[i].actor;
  for (let j = i - 1; j >= 0; j--) {
    const s = turn.steps[j];
    if (s.kind === "note" && !s.event && s.actor === actor && s.quote) return s;
  }
  return undefined;
}
