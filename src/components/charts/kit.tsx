"use client";
// Shared pieces for the hand-written SVG charts: colour tokens, a width hook, the tooltip and number formats.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn, rootRem } from "@/lib/utils";

/**
 * Categorical slots, validated with the dataviz palette checker (light on #ffffff, dark on the app's dark surface):
 * adjacent CVD ΔE ≥ 8.4, normal-vision ΔE ≥ 19.3. Light slots 3–5 are under 3:1 contrast, so every chart that uses
 * them also shows its values as text (legend values or a table). Status colours are separate and only mean state.
 */
export const CHART_VARS = cn(
  "[--series-1:#2a78d6] [--series-2:#eb6834] [--series-3:#1baf7a] [--series-4:#eda100] [--series-5:#e87ba4] [--series-6:#008300]",
  "dark:[--series-1:#3987e5] dark:[--series-2:#d95926] dark:[--series-3:#199e70] dark:[--series-4:#c98500] dark:[--series-5:#d55181] dark:[--series-6:#008300]",
  "[--status-warning:#fab219] [--status-critical:#d03b3b] [--chart-other:#a3a29b] dark:[--chart-other:#6b6a64]",
);
export const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)"];
export const OTHER = "var(--chart-other)";

/** Width of an element, kept up to date. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** 1,284 -> "1.3K", 4,200,000 -> "4.2M". */
export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${+(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${+(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
  return String(Math.round(n));
}
export const fmt = (n: number) => Math.round(n).toLocaleString();

/** A round number at or above `max`, so axis ticks land on clean values. */
export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}

/** Hover read-out: the value leads, the label follows; a short line key carries identity. */
export function ChartTooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const W = 12.5 * rootRem(); // the max-w below, in px
  const left = Math.max(0, Math.min(x + 12, width - W));
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 w-max max-w-[12.5rem] rounded-lg border border-foreground/10 bg-background/95 px-2.5 py-1.5 text-xs shadow-lg backdrop-blur"
      style={{ left: x + 12 + W > width ? Math.max(0, x - W / 2) : left, top: Math.max(0, y - 8) }}
    >
      {children}
    </div>
  );
}

export function TipRow({ color, value, label }: { color?: string; value: ReactNode; label: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      {color && <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: color }} />}
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
      <span className="min-w-0 truncate text-muted-foreground">{label}</span>
    </div>
  );
}
