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

/** Which reasons may show a desktop notification. The permission guess is only a guess: badge only. */
export const ATTENTION_NOTIFIES: Record<AttentionReason, boolean> = { question: true, plan: true, permission: false };

// Tools Claude Code asks about in the modes that ask, that finish in moments once allowed. Commands (Bash,
// PowerShell) are left out: tests, builds and installs often run for minutes, so a long wait means nothing.
const ASKS = /^(Write|Edit|MultiEdit|NotebookEdit|WebFetch|mcp__.+)$/;
const EDITS = /^(Write|Edit|MultiEdit|NotebookEdit)$/;
// Modes where Claude Code never stops to ask.
const NEVER_ASKS = new Set(["auto", "dontAsk", "bypassPermissions"]);
// A prompt isn't logged, so a tool that has waited this long, with the whole session quiet, is treated as one.
export const PERMISSION_WAIT_MS = 20_000;

/**
 * The newest thing Claude is waiting on you for, or undefined. An unanswered question or plan keeps needing
 * you however long it waits. Logs never record a permission prompt itself, so "permission" is a careful
 * guess: the lead's own edit, web fetch or MCP tool, in a mode that asks (default or plan, or acceptEdits for
 * anything but edits; older logs without a mode count as default), still without a result after 20 s, with
 * no new record from anyone for 20 s. The guess stops once the session goes stale (idle), when a missing
 * result more likely means it was interrupted.
 */
export function needsAttention(m: SessionModel, now = Date.now()): Attention | undefined {
  const steps = m.turns.at(-1)?.steps ?? [];
  const mode = m.meta.permissionMode;
  const lastActivity = Math.max(m.meta.lastTs, steps.at(-1)?.ts ?? 0);
  const mayGuess = !m.stale && !NEVER_ASKS.has(mode ?? "") && now - lastActivity >= PERMISSION_WAIT_MS;
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s.status !== "running" || !s.tool) continue;
    if (s.tool === "AskUserQuestion") return { reason: "question", step: s };
    if (s.tool === "ExitPlanMode") return { reason: "plan", step: s };
    if (!mayGuess || s.actor !== "lead" || !ASKS.test(s.tool) || now - s.ts < PERMISSION_WAIT_MS) continue;
    if (mode === "acceptEdits" && EDITS.test(s.tool)) continue;
    // Nothing from anyone after it: a later step means Claude moved on.
    if (i === steps.length - 1 || steps.slice(i + 1).every((x) => x.ts <= s.ts)) return { reason: "permission", step: s };
  }
  return undefined;
}
