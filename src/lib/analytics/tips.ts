// N8: plain advice for saving tokens, worked out from one request's numbers. No AI involved.
import type { SessionModel, Turn } from "../session.ts";
import { cacheHit, contextGauge } from "./stats.ts";

export type Tip = { id: string; text: string; severity: "info" | "warn" };

/** Memory fuller than this (percent of the model's window) gets a /compact or /clear tip. */
export const MEMORY_FULL_PCT = 70;
/** The same file read this many times in one request. */
export const REREAD_COUNT = 3;
/** Helper briefs longer than this (characters). */
export const LONG_BRIEF_CHARS = 20_000;
/** Requests where Claude read at least this many tokens count as long for the cache tip. */
export const LONG_REQUEST_TOKENS = 100_000;
/** Below this cache hit (percent) on a long request. */
export const LOW_CACHE_PCT = 50;

const fmt = (n: number) => n.toLocaleString("en-US");
const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

export function tipsFor(turn: Turn, m: SessionModel): Tip[] {
  const tips: Tip[] = [];

  const g = contextGauge(turn, m);
  // Compare unrounded: the gauge's pct is rounded for display.
  if (g.used * 100 > g.window * MEMORY_FULL_PCT) {
    tips.push({
      id: "memory-full",
      severity: "warn",
      text: `Claude's [[context:memory]] was ${Math.round(g.pct)}% full when it started this request. Every reply re-reads all of it. Type /compact to have Claude summarise the older parts, or /clear to start fresh if you're moving on to something new.`,
    });
  }

  // Same file read again and again (by Claude or its helpers).
  const reads = new Map<string, number>();
  for (const s of turn.steps) {
    if (s.tool !== "Read") continue;
    const file = (s.input as { file_path?: unknown } | undefined)?.file_path;
    if (typeof file === "string" && file) reads.set(file, (reads.get(file) ?? 0) + 1);
  }
  for (const [file, n] of reads) {
    if (n < REREAD_COUNT) continue;
    tips.push({
      id: `reread:${file}`,
      severity: "info",
      text: `${base(file)} was read ${n} times in this request. Each read adds the whole file to [[context:memory]] again. If it's big, pointing Claude at the part you mean (a function or a line number) saves [[tokens:tokens]].`,
    });
  }

  for (const s of turn.steps) {
    const brief = s.kind === "brief" && typeof s.quote === "string" ? s.quote : "";
    if (brief.length <= LONG_BRIEF_CHARS) continue;
    const name = m.actors[s.actor]?.name ?? "a helper";
    tips.push({
      id: `brief:${s.id}`,
      severity: "info",
      text: `The [[brief:brief]] for ${name} was ${fmt(brief.length)} characters long. A [[helper:helper]] re-reads its brief before every reply, so a shorter brief that points to files (instead of pasting them) uses fewer [[tokens:tokens]].`,
    });
  }

  const read = turn.usage.fresh + turn.usage.cached;
  const hit = cacheHit(turn.usage);
  if (read >= LONG_REQUEST_TOKENS && hit < LOW_CACHE_PCT) {
    tips.push({
      id: "cache-low",
      severity: "info",
      text: `Only ${Math.round(hit)}% of what Claude read in this request came from its [[cached:cache]]. The cache is forgotten after a few minutes without activity, and resets when you switch model mid-session. Long pauses in the middle of big tasks make the next reply read everything as new.`,
    });
  }
  return tips;
}
