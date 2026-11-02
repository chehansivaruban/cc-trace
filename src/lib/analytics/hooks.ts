// Hook runs (E3): the user's own scripts that Claude Code runs at set moments, how often, and which failed.
import type { SessionModel } from "../session.ts";

export type HookSample = { stderr?: string; exitCode?: number; ts: number; durationMs?: number };
export type HookRun = { name: string; event: string; runs: number; failed: number; samples: HookSample[] };

const MAX_SAMPLES = 5;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/**
 * One row per hook (by event and command), failing hooks first. A run counts as failed when Claude Code
 * logged an error, or when the hook exited with a non-zero code even though it was labelled a success.
 * Stop hooks show up twice (their own record and a summary); each run is counted once.
 */
export function hookRuns(m: SessionModel): HookRun[] {
  const rows = new Map<string, HookRun & { bad: HookSample[]; good: HookSample[] }>();
  const seen = new Set<string>();
  const add = (name: string, event: string, failed: boolean, sample: HookSample, id?: string) => {
    if (id) {
      if (seen.has(`${id}|${name}`)) return;
      seen.add(`${id}|${name}`);
    }
    const key = `${event}\u0000${name}`;
    let r = rows.get(key);
    if (!r) rows.set(key, (r = { name, event, runs: 0, failed: 0, samples: [], bad: [], good: [] }));
    r.runs++;
    if (failed) r.failed++;
    const list = failed ? r.bad : r.good;
    list.push(sample);
    if (list.length > MAX_SAMPLES) list.shift(); // keep the latest
  };
  const events = Array.isArray(m?.events) ? m.events : [];

  // Each hook's own record first, so the Stop summaries below can skip runs already counted. Extra context
  // a hook handed Claude (its only trace for some hooks) comes last and only counts when the run wasn't seen.
  const ran = new Set<string>();
  const own = events.filter((ev) => ev?.type === "hook" && ev.data && typeof ev.data === "object");
  const context = (ev: (typeof own)[number]) => ev.subtype === "hook_additional_context";
  for (const ev of [...own.filter((e) => !context(e)), ...own.filter(context)]) {
    const d = ev.data;
    const hookName = str(d.hookName);
    const name = str(d.command) ?? hookName;
    if (!name) continue; // context without a hook name: nothing to report
    const id = str(d.toolUseID);
    const runKey = id && hookName ? `${id}|${hookName}` : undefined;
    if (context(ev) && runKey && ran.has(runKey)) continue;
    if (runKey) ran.add(runKey);
    const event = str(d.hookEvent) ?? hookName?.split(":")[0] ?? "unknown";
    const exitCode = num(d.exitCode);
    const failed = /error|fail|cancel/i.test(ev.subtype) || (exitCode !== undefined && exitCode !== 0);
    add(name, event, failed, { stderr: str(d.stderr), exitCode, ts: ev.ts, durationMs: num(d.durationMs) }, id);
  }
  for (const ev of events) {
    const d = ev?.data;
    if (ev?.type !== "system" || ev.subtype !== "stop_hook_summary" || !d || typeof d !== "object" || !Array.isArray(d.hookInfos)) continue;
    // "callback" entries are Claude Code's own built-in steps, not the user's hooks.
    const infos = (d.hookInfos as unknown[]).filter((i): i is { command: string; durationMs?: unknown } =>
      !!i && typeof i === "object" && !!str((i as { command?: unknown }).command) && (i as { command: string }).command !== "callback");
    const errors = Array.isArray(d.hookErrors) ? d.hookErrors.filter((e): e is string => typeof e === "string" && !!e.trim()) : [];
    // Errors aren't tied to a hook in the summary: only blame one when it's the only hook.
    const failed = errors.length > 0 && infos.length === 1;
    for (const info of infos) {
      add(info.command, "Stop", failed, { stderr: failed ? errors.join("\n") : undefined, ts: ev.ts, durationMs: num(info.durationMs) }, str(d.toolUseID));
    }
  }
  return [...rows.values()]
    .map(({ bad, good, ...r }) => ({ ...r, samples: [...bad, ...good].slice(0, MAX_SAMPLES) }))
    .sort((a, b) => (b.failed ? 1 : 0) - (a.failed ? 1 : 0) || b.runs - a.runs || a.name.localeCompare(b.name));
}
