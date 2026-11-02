"use client";

import { useMemo } from "react";
import { PHASE_EXPLAIN, PHASE_LABEL, phasesOf, type PhaseKind } from "@/lib/analytics/phases";
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

/** The request's phases as one band: each part as wide as its share of the steps. Click a part to jump to it. */
export function PhaseBand({ turn, selected, onPick }: { turn: Turn; selected?: string | null; onPick?: (stepId: string) => void }) {
  const phases = useMemo(() => phasesOf(turn), [turn]);
  if (!phases.length) return null;
  const at = selected ? turn.steps.findIndex((s) => s.id === selected) : -1;
  return (
    <div className="flex items-center gap-2 border-b border-foreground/10 px-4 py-1.5" aria-label="Phases of this request">
      <span className="shrink-0 text-[0.6875rem] font-medium text-muted-foreground" title="What Claude was mostly doing at each point of this request">
        Phases
      </span>
      <div className="flex h-6 min-w-0 flex-1 gap-[2px] overflow-hidden rounded-md">
        {phases.map((p) => {
          const n = p.to - p.from + 1;
          const active = at >= p.from && at <= p.to;
          const hue = PHASE_HUE[p.kind];
          const label = `${PHASE_LABEL[p.kind]} · ${n} step${n === 1 ? "" : "s"}`;
          return (
            <button
              key={p.from}
              onClick={() => onPick?.(turn.steps[p.from].id)}
              title={`${label}. ${PHASE_EXPLAIN[p.kind]}`}
              aria-label={`${label}. Jump to its first step`}
              className={cn("flex min-w-[6px] items-center overflow-hidden rounded-[4px] px-1.5 text-left transition-[filter] hover:brightness-110", active && "ring-2 ring-inset")}
              style={{ flex: `${n} 1 0`, background: hueColor(hue, active ? 0.34 : 0.2), color: hueColor(hue), ["--tw-ring-color" as string]: hueColor(hue) }}
            >
              <span className="truncate text-[0.6875rem] font-medium text-foreground/80">{PHASE_LABEL[p.kind]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
