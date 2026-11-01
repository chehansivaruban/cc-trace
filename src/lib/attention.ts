// "Claude needs you": spots a session that is waiting on you (a question, a plan to approve, a permission prompt).
import type { SessionModel, Step } from "./session.ts";

export type AttentionReason = "question" | "plan" | "permission";
export type Attention = { reason: AttentionReason; step?: Step };

/** Plain-English line for each reason. */
export const ATTENTION_TEXT: Record<AttentionReason, string> = {
  question: "Claude is asking you a question",
  plan: "Claude has a plan for you to approve",
  permission: "Claude may be waiting for your permission",
};

// Tools Claude Code usually asks before running. Reading and searching never ask.
const ASKS = /^(Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit|WebFetch|mcp__.+)$/;
const EDITS = /^(Write|Edit|MultiEdit|NotebookEdit)$/;
// A prompt isn't logged, so a tool that has waited this long with nothing after it is treated as one.
export const PERMISSION_WAIT_MS = 8_000;

/**
 * The newest thing Claude is waiting on you for, or undefined. Logs never record a permission prompt itself,
 * so "permission" is a guess: a tool that usually asks, still without a result after a few seconds, with
 * nothing newer from that agent. Nothing is reported for a stale (idle) session.
 */
export function needsAttention(m: SessionModel, now = Date.now()): Attention | undefined {
  if (m.stale) return undefined;
  const steps = m.turns.at(-1)?.steps ?? [];
  let latest: Record<string, number> | undefined;
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s.status !== "running" || !s.tool) continue;
    if (s.tool === "AskUserQuestion") return { reason: "question", step: s };
    if (s.tool === "ExitPlanMode") return { reason: "plan", step: s };
    if (!ASKS.test(s.tool) || now - s.ts < PERMISSION_WAIT_MS) continue;
    const mode = m.meta.permissionMode;
    if (mode === "bypassPermissions" || (mode === "acceptEdits" && EDITS.test(s.tool))) continue;
    if (!latest) {
      latest = {};
      for (const x of steps) latest[x.actor] = Math.max(latest[x.actor] ?? 0, x.ts);
    }
    if ((latest[s.actor] ?? 0) <= s.ts) return { reason: "permission", step: s };
  }
  return undefined;
}
