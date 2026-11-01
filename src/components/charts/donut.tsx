"use client";
// Part-to-whole at a glance: at most six slices (the rest fold into "Other"), 2px surface gaps,
// a legend with every value written out, and a tooltip per slice.
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { OTHER, SERIES, compact, fmt } from "./kit";

export type Slice = { key: string; label: string; value: number };

const MAX_SLICES = 6;

/** Colour follows the entity: a key keeps its slot for the life of the page, whatever the filter shows. */
export function useStableColors() {
  const slots = useRef(new Map<string, number>());
  return (key: string) => {
    const map = slots.current;
    if (!map.has(key) && map.size < SERIES.length) map.set(key, map.size);
    const slot = map.get(key);
    return slot === undefined ? OTHER : SERIES[slot];
  };
}

function arc(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) {
  const p = (r: number, a: number) => `${(cx + r * Math.sin(a)).toFixed(2)},${(cy - r * Math.cos(a)).toFixed(2)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(r1, a0)}A${r1},${r1} 0 ${large} 1 ${p(r1, a1)}L${p(r0, a1)}A${r0},${r0} 0 ${large} 0 ${p(r0, a0)}Z`;
}

export function Donut(props: { slices: Slice[]; colorOf: (key: string) => string; centerLabel: string; ariaLabel: string; size?: number; unit?: string }) {
  const { size = 148, unit = "tokens" } = props;
  const [hover, setHover] = useState<string | null>(null);
  const sorted = props.slices.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const slices: Slice[] =
    sorted.length > MAX_SLICES
      ? [...sorted.slice(0, MAX_SLICES - 1), { key: "__other", label: `Other (${sorted.length - MAX_SLICES + 1})`, value: sorted.slice(MAX_SLICES - 1).reduce((a, s) => a + s.value, 0) }]
      : sorted;
  const total = slices.reduce((a, s) => a + s.value, 0);
  const color = (k: string) => (k === "__other" ? OTHER : props.colorOf(k));
  if (!total) return <p className="py-6 text-center text-xs text-muted-foreground">No tokens in this period.</p>;

  const c = size / 2;
  const r1 = c - 2;
  const r0 = r1 * 0.62;
  let a = 0;
  const arcs = slices.map((s) => {
    const a0 = a;
    a += (s.value / total) * Math.PI * 2;
    // A single slice is a full ring: split it so the arc command can draw it.
    const a1 = slices.length === 1 ? a - 1e-4 : a;
    return { ...s, d: arc(c, c, r0, r1, a0, a1) };
  });
  const focus = hover ? slices.find((s) => s.key === hover) : undefined;

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} role="img" aria-label={props.ariaLabel} className="block">
          {arcs.map((s) => (
            <path
              key={s.key}
              d={s.d}
              fill={color(s.key)}
              fillOpacity={!hover || hover === s.key ? 1 : 0.45}
              className="stroke-background"
              strokeWidth={2}
              strokeLinejoin="round"
              onPointerEnter={() => setHover(s.key)}
              onPointerLeave={() => setHover(null)}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-base font-semibold">{compact(focus?.value ?? total)}</span>
          <span className="max-w-[80px] truncate text-[10px] text-muted-foreground">{focus ? `${Math.round((focus.value / total) * 100)}% · ${focus.label}` : props.centerLabel}</span>
        </div>
      </div>
      <ul className="min-w-[180px] flex-1 space-y-1 text-xs">
        {slices.map((s) => (
          <li
            key={s.key}
            className={cn("flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors", hover === s.key && "bg-foreground/[0.06]")}
            onPointerEnter={() => setHover(s.key)}
            onPointerLeave={() => setHover(null)}
          >
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: color(s.key) }} />
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
            <span className="shrink-0 tabular-nums">{fmt(s.value)}</span>
            <span className="w-9 shrink-0 text-right text-muted-foreground tabular-nums">{Math.round((s.value / total) * 100)}%</span>
          </li>
        ))}
        <li className="px-1.5 pt-1 text-[11px] text-muted-foreground">
          {fmt(total)} {unit} in all
        </li>
      </ul>
    </div>
  );
}
