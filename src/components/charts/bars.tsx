"use client";
// One-series column chart: ≤ 24px columns with a 4px rounded top, 2px gaps, a tooltip per column.
import { useMemo, useState, type KeyboardEvent } from "react";
import { ChartTooltip, TipRow, compact, fmt, niceMax, useWidth } from "./kit";

export type Bar = { key: string; value: number; label: string; detail?: string };

const PAD = { top: 16, right: 8, bottom: 22, left: 40 };
const GAP = 2;
const MIN_BAND = 4; // below this, neighbouring columns are merged (showing the largest)

function column(x: number, y: number, w: number, base: number) {
  const r = Math.min(4, w / 2, base - y);
  if (base - y < 0.5) return "";
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`;
}

export function BarChart(props: {
  bars: Bar[];
  ariaLabel: string;
  /** Names the plotted measure in the tooltip, e.g. "tokens written". */
  seriesLabel: string;
  formatY?: (y: number) => string;
  height?: number;
  onPick?: (key: string) => void;
  pickHint?: string;
  /** Labels under the first and last column (default: their own labels). */
  ends?: [string, string];
}) {
  const { formatY = fmt, height = 160 } = props;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const plotW = Math.max(10, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;

  // Too many columns for the width: merge runs of neighbours into one column showing the largest.
  const bars = useMemo(() => {
    const max = Math.max(1, Math.floor(plotW / MIN_BAND));
    if (props.bars.length <= max) return props.bars;
    const k = Math.ceil(props.bars.length / max);
    const out: Bar[] = [];
    for (let i = 0; i < props.bars.length; i += k) {
      const group = props.bars.slice(i, i + k);
      const top = group.reduce((a, b) => (b.value > a.value ? b : a));
      out.push({ ...top, detail: `largest of ${group.length}${top.detail ? ` · ${top.detail}` : ""}` });
    }
    return out;
  }, [props.bars, plotW]);

  if (!bars.length) return <p className="py-6 text-center text-xs text-muted-foreground">Nothing to draw yet.</p>;
  const yMax = niceMax(Math.max(...bars.map((b) => b.value)));
  const band = plotW / bars.length;
  const w = Math.min(24, Math.max(1, band - (band >= MIN_BAND ? GAP : 0)));
  const base = PAD.top + plotH;
  const sy = (v: number) => base - (v / yMax) * plotH;
  const cx = (i: number) => PAD.left + band * i + band / 2;
  const peak = bars.reduce((a, b, i) => (b.value > bars[a].value ? i : a), 0);
  const h = hover !== null ? bars[hover] : null;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const i = hover ?? (e.key === "ArrowRight" ? -1 : bars.length);
      setHover(Math.max(0, Math.min(bars.length - 1, i + (e.key === "ArrowRight" ? 1 : -1))));
    } else if (e.key === "Enter" && hover !== null) props.onPick?.(bars[hover].key);
  };

  return (
    <div ref={ref} className="relative w-full select-none">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={props.ariaLabel}
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
          className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
        >
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={sy(yMax * f)} y2={sy(yMax * f)} className={f === 0 ? "stroke-foreground/25" : "stroke-foreground/10"} strokeWidth={1} />
              <text x={PAD.left - 6} y={sy(yMax * f)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                {compact(yMax * f)}
              </text>
            </g>
          ))}
          {bars.map((b, i) => (
            <path key={b.key + i} d={column(cx(i) - w / 2, sy(b.value), w, base)} fill="var(--series-1)" fillOpacity={hover === null || hover === i ? 1 : 0.55} />
          ))}
          {/* Selective direct label: the tallest column only. */}
          {bars[peak].value > 0 && (
            <text x={cx(peak)} y={sy(bars[peak].value) - 4} textAnchor={peak > bars.length * 0.85 ? "end" : peak < bars.length * 0.15 ? "start" : "middle"} className="fill-foreground text-[10px] font-medium tabular-nums">
              {compact(bars[peak].value)}
            </text>
          )}
          <text x={PAD.left} y={height - 6} className="fill-muted-foreground text-[10px]">
            {props.ends?.[0] ?? bars[0].label}
          </text>
          <text x={PAD.left + plotW} y={height - 6} textAnchor="end" className="fill-muted-foreground text-[10px]">
            {props.ends?.[1] ?? bars.at(-1)!.label}
          </text>
          {/* Hit targets: the whole column band, taller than the mark. */}
          {bars.map((b, i) => (
            <rect
              key={`hit-${b.key}-${i}`}
              x={PAD.left + band * i}
              y={PAD.top}
              width={band}
              height={plotH}
              fill="transparent"
              className={props.onPick ? "cursor-pointer" : undefined}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover((v) => (v === i ? null : v))}
              onClick={() => props.onPick?.(b.key)}
            />
          ))}
        </svg>
      )}
      {h && hover !== null && (
        <ChartTooltip x={cx(hover)} y={Math.min(sy(h.value), base - 30) - 50} width={width}>
          <TipRow color="var(--series-1)" value={formatY(h.value)} label={props.seriesLabel} />
          <div className="mt-0.5 max-w-[11.25rem] truncate text-muted-foreground">{h.label}</div>
          {h.detail && <div className="text-[0.6875rem] text-muted-foreground">{h.detail}</div>}
          {props.onPick && props.pickHint && <div className="mt-0.5 text-[0.6875rem] text-muted-foreground">{props.pickHint}</div>}
        </ChartTooltip>
      )}
      <div style={{ height: width > 0 ? 0 : height }} />
    </div>
  );
}
