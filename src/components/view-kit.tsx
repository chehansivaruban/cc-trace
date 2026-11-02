"use client";

// Small pieces shared by the Health and Files views.
import { useState, type ReactNode } from "react";
import { ChevronRight, Map as MapIcon } from "lucide-react";
import { useRoute } from "@/lib/route";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import type { SessionViewProps } from "./views/registry";

/** Selecting a step (any request) shows its explanation; `toMap` opens it on the map instead. */
export function useJump({ model, onPickTurn, onSelect }: Pick<SessionViewProps, "model" | "onPickTurn" | "onSelect">) {
  const [, navigate] = useRoute();
  const last = model.turns.length - 1;
  const select = (turn: number, step: string) => {
    onPickTurn(turn);
    onSelect({ type: "step", id: step });
  };
  const toMap = (turn: number, step: string) => navigate({ view: "map", turn: turn === last ? undefined : turn, step });
  return { select, toMap };
}

export function MapButton({ onClick, label = "Show on the map" }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={label}
      aria-label={label}
      className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground"
    >
      <MapIcon className="size-3.5" />
    </button>
  );
}

export function Section({ title, intro, children, right }: { title: string; intro?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
        {right}
      </div>
      {intro && <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{intro}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** "Technical details" switch; starts from the Settings default. */
export function useTechnical(): [boolean, ReactNode] {
  const [settings] = useSettings();
  const [own, setOwn] = useState<boolean | null>(null);
  const on = own ?? settings.showTechnical;
  const toggle = (
    <button onClick={() => setOwn(!on)} className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" aria-pressed={on}>
      <ChevronRight className={cn("size-3.5 transition-transform", on && "rotate-90")} />
      {on ? "Hide" : "Show"} technical details
    </button>
  );
  return [on, toggle];
}

export const fmt = (n: number) => n.toLocaleString();
export const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
