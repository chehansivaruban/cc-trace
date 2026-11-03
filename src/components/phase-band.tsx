"use client";

import { useMemo } from "react";
import { PHASE_EXPLAIN, PHASE_LABEL, mergeNarrowPhases, phasesOf, type PhaseKind } from "@/lib/analytics/phases";
import { useWidth } from "./charts/kit";
import type { Turn } from "@/lib/session";
import { cn } from "@/lib/utils";
import { hueColor } from "./step-icon";

export const PHASE_HUE: Record<PhaseKind, number> = {
  exploring: 235,
  changing: 290,
  testing: 75,
  reviewing: 185,
  delegating: 340,
  answering: 150,
};

// Parts narrower than this are merged into a neighbour, so each one is wide enough to read and to tap.
const MIN_PART_REM = 4;

/**
 * The request's phases as one band: each part as wide as its share of the steps. Phases too short to show
 * on their own are merged into a neighbour (the tooltip lists what's inside). Click a part to jump to it.
 */
export function PhaseBand({ turn, selected, onPick }: { turn: Turn; selected?: string | null; onPick?: (stepId: string) => void }) {
  const phases = useMemo(() => phasesOf(turn), [turn]);
  const [ref, width] = useWidth<HTMLDivElement>();
  const total = phases.length ? phases.at(-1)!.to + 1 : 0;
  const segments = useMemo(() => {
    const rem = typeof document === "undefined" ? 16 : parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const perStep = width && total ? width / total : 0;
    return mergeNarrowPhases(phases, perStep ? Math.ceil((MIN_PART_REM * rem) / perStep) : 1);
  }, [phases, width, total]);
  if (!phases.length) return null;
  const at = selected ? turn.steps.findIndex((s) => s.id === selected) : -1;
  const steps = (n: number) => `${n} step${n === 1 ? "" : "s"}`;
  return (
    <div className="flex items-center gap-2 border-b border-foreground/10 px-4 py-1.5" aria-label="Phases of this request">
      <span className="shrink-0 text-[0.6875rem] font-medium text-muted-foreground" title="What Claude was mostly doing at each point of this request">
        Phases
      </span>
      <div ref={ref} className="flex h-6 min-w-0 flex-1 gap-[2px] overflow-hidden rounded-md">
        {segments.map((p) => {
          const n = p.to - p.from + 1;
          const active = at >= p.from && at <= p.to;
          const hue = PHASE_HUE[p.kind];
          const merged = p.parts.length > 1;
          const label = merged ? `Mostly ${PHASE_LABEL[p.kind].toLowerCase()} · ${steps(n)}` : `${PHASE_LABEL[p.kind]} · ${steps(n)}`;
          const detail = merged ? p.parts.map((x) => `${PHASE_LABEL[x.kind]} (${steps(x.to - x.from + 1)})`).join(", then ") : PHASE_EXPLAIN[p.kind];
          const wide = !width || (n / total) * width >= 48;
          return (
            <button
              key={p.from}
              onClick={() => onPick?.(turn.steps[p.from].id)}
              title={`${label}. ${detail}`}
              aria-label={`${label}. Jump to its first step`}
              className={cn("flex min-w-6 items-center overflow-hidden rounded-[4px] px-1.5 text-left transition-[filter] hover:brightness-110", active && "ring-2 ring-inset")}
              style={{ flex: `${n} 1 0`, background: hueColor(hue, active ? 0.34 : 0.2), color: hueColor(hue), ["--tw-ring-color" as string]: hueColor(hue) }}
            >
              {wide && <span className="truncate text-[0.6875rem] font-medium text-foreground/80">{PHASE_LABEL[p.kind]}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
