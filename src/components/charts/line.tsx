"use client";
// One-series line chart (2px line, 10 % wash) with a crosshair that snaps to the nearest point.
import { useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { maxOf } from "@/lib/num";
import { ChartTooltip, TipRow, compact, fmt, niceMax, useWidth } from "./kit";

export type LinePoint = { x: number; y: number };

const PAD = { top: 10, right: 44, bottom: 22, left: 40 };

/** Index of the point whose x is closest to `x` (points sorted by x). */
function nearest(points: LinePoint[], x: number) {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].x < x) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && x - points[lo - 1].x < points[lo].x - x ? lo - 1 : lo;
}

export function LineChart(props: {
  points: LinePoint[];
  /** Names the plotted series in the tooltip, e.g. "tokens so far". */
  seriesLabel: string;
  ariaLabel: string;
  formatX: (x: number) => string;
  formatY?: (y: number) => string;
  height?: number;
  /** A highlighted x-range (e.g. the request you're looking at). */
  band?: { from: number; to: number; label: string };
  onPick?: (index: number) => void;
  pickHint?: string;
}) {
  const { points, formatX, formatY = fmt, height = 180, band } = props;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const plotW = Math.max(10, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;

  const geo = useMemo(() => {
    if (!points.length) return null;
    const x0 = points[0].x;
    const x1 = points.at(-1)!.x;
    const yMax = niceMax(maxOf(points, (p) => p.y));
    const sx = (x: number) => PAD.left + (x1 === x0 ? plotW / 2 : ((x - x0) / (x1 - x0)) * plotW);
    const sy = (y: number) => PAD.top + plotH - (y / yMax) * plotH;
    // Thousands of points: keep the lowest and highest per pixel column, which looks identical.
    const cols = new Map<number, [LinePoint, LinePoint]>();
    const shown: LinePoint[] = [];
    if (points.length > plotW * 2) {
      for (const p of points) {
        const c = Math.round(sx(p.x));
        const mm = cols.get(c);
        if (!mm) cols.set(c, [p, p]);
        else {
          if (p.y < mm[0].y) mm[0] = p;
          if (p.y > mm[1].y) mm[1] = p;
        }
      }
      for (const [lo, hi] of cols.values()) shown.push(...(lo === hi ? [lo] : lo.x <= hi.x ? [lo, hi] : [hi, lo]));
    } else shown.push(...points);
    const line = shown.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join("");
    const base = PAD.top + plotH;
    const area = `${line}L${sx(shown.at(-1)!.x).toFixed(1)},${base}L${sx(shown[0].x).toFixed(1)},${base}Z`;
    return { sx, sy, yMax, line, area, x0, x1 };
  }, [points, plotW, plotH]);

  if (!points.length || !geo) return <p className="py-6 text-center text-xs text-muted-foreground">Nothing to draw yet.</p>;
  const { sx, sy, yMax } = geo;
  const last = points.at(-1)!;
  const h = hover !== null ? points[hover] : null;

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const px = e.clientX - r.left;
    const x = geo.x1 === geo.x0 ? geo.x0 : geo.x0 + ((px - PAD.left) / plotW) * (geo.x1 - geo.x0);
    setHover(nearest(points, x));
  };
  const onKey = (e: KeyboardEvent) => {
    const i = hover ?? points.length - 1;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const step = Math.max(1, Math.round(points.length / 50)) * (e.shiftKey ? 5 : 1);
      setHover(Math.max(0, Math.min(points.length - 1, i + (e.key === "ArrowRight" ? step : -step))));
    } else if (e.key === "Enter" && props.onPick && hover !== null) props.onPick(hover);
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
          onFocus={() => setHover((v) => v ?? points.length - 1)}
          onBlur={() => setHover(null)}
          className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
        >
          {/* Recessive grid: 0, half and the top tick. */}
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={sy(yMax * f)} y2={sy(yMax * f)} className={f === 0 ? "stroke-foreground/25" : "stroke-foreground/10"} strokeWidth={1} />
              <text x={PAD.left - 6} y={sy(yMax * f)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                {compact(yMax * f)}
              </text>
            </g>
          ))}
          {band && band.to >= geo.x0 && band.from <= geo.x1 && (
            <g>
              <rect
                x={sx(Math.max(band.from, geo.x0))}
                width={Math.max(2, sx(Math.min(band.to, geo.x1)) - sx(Math.max(band.from, geo.x0)))}
                y={PAD.top}
                height={plotH}
                className="fill-foreground/[0.06]"
              />
              {/* A rising total sits low on the left and high on the right: put the label where the line isn't. */}
              {(() => {
                const a = sx(Math.max(band.from, geo.x0));
                const b = sx(Math.min(band.to, geo.x1));
                const right = (a + b) / 2 > PAD.left + plotW / 2;
                return (
                  <text x={right ? b - 4 : a + 4} y={right ? PAD.top + plotH - 6 : PAD.top + 10} textAnchor={right ? "end" : "start"} className="fill-muted-foreground text-[10px]">
                    {band.label}
                  </text>
                );
              })()}
            </g>
          )}
          <path d={geo.area} fill="var(--series-1)" fillOpacity={0.1} />
          <path d={geo.line} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {/* Direct label at the end of the line only. */}
          <circle cx={sx(last.x)} cy={sy(last.y)} r={4} fill="var(--series-1)" className="stroke-background" strokeWidth={2} />
          <text x={sx(last.x) + 7} y={sy(last.y)} dy="0.32em" className="fill-foreground text-[10px] font-medium tabular-nums">
            {compact(last.y)}
          </text>
          <text x={PAD.left} y={height - 6} className="fill-muted-foreground text-[10px]">
            {formatX(geo.x0)}
          </text>
          <text x={PAD.left + plotW} y={height - 6} textAnchor="end" className="fill-muted-foreground text-[10px]">
            {formatX(geo.x1)}
          </text>
          {h && (
            <g pointerEvents="none">
              <line x1={sx(h.x)} x2={sx(h.x)} y1={PAD.top} y2={PAD.top + plotH} className="stroke-foreground/40" strokeWidth={1} />
              <circle cx={sx(h.x)} cy={sy(h.y)} r={4.5} fill="var(--series-1)" className="stroke-background" strokeWidth={2} />
            </g>
          )}
          <rect
            x={PAD.left}
            y={PAD.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            className={props.onPick ? "cursor-pointer" : undefined}
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHover(null)}
            onClick={() => hover !== null && props.onPick?.(hover)}
          />
        </svg>
      )}
      {h && (
        <ChartTooltip x={sx(h.x)} y={sy(h.y) - 44} width={width}>
          <TipRow color="var(--series-1)" value={formatY(h.y)} label={props.seriesLabel} />
          <div className="mt-0.5 text-muted-foreground">{formatX(h.x)}</div>
          {props.onPick && props.pickHint && <div className="mt-0.5 text-[0.6875rem] text-muted-foreground">{props.pickHint}</div>}
        </ChartTooltip>
      )}
      <div style={{ height: width > 0 ? 0 : height }} />
    </div>
  );
}
