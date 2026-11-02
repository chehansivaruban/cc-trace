"use client";
// Building blocks shared by the Stats view and the Dashboard: stat tiles, sections, a sortable table, a meter.
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronRight, Gauge } from "lucide-react";
import { fmt, useWidth } from "@/components/charts/kit";
import { explainTool } from "@/lib/explain";
import { totalTokens, type Usage } from "@/lib/session";
import { cn } from "@/lib/utils";

export function StatTile({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-foreground/10 px-3.5 py-3">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function Section({ title, intro, children, aside }: { title: ReactNode; intro?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
          {intro && <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-muted-foreground">{intro}</p>}
        </div>
        {aside}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function TechToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} aria-pressed={on} className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
      <ChevronRight className={cn("size-3.5 transition-transform", on && "rotate-90")} />
      {on ? "Hide" : "Show"} the technical details
    </button>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-lg border border-foreground/10 p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("rounded-md px-2.5 py-1 transition-colors", value === o.value ? "bg-foreground/[0.09] font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * How full a memory (or anything with a limit) is. The fill carries severity, with an icon and a word,
 * never colour alone; the track is a light step of the fill.
 */
export function Meter({ pct, compact }: { pct: number; compact?: boolean }) {
  const level = pct > 90 ? "critical" : pct > 70 ? "warning" : "ok";
  const color = level === "critical" ? "var(--status-critical)" : level === "warning" ? "var(--status-warning)" : "var(--series-1)";
  const word = level === "critical" ? "nearly full" : level === "warning" ? "getting full" : "";
  return (
    <div className={cn("flex items-center gap-2", compact ? "w-full" : "")}>
      <div className="relative h-2 min-w-[48px] flex-1 overflow-hidden rounded-full" style={{ background: `color-mix(in oklab, ${color} 18%, transparent)` }}>
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(pct > 0 ? 2 : 0, pct))}%`, background: color }} />
      </div>
      <span className="w-10 shrink-0 text-right text-xs tabular-nums">{pct < 1 && pct > 0 ? "<1" : Math.round(pct)}%</span>
      {!compact && word && (
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          {level === "critical" ? <AlertTriangle className="size-3.5" /> : <Gauge className="size-3.5" />}
          {word}
        </span>
      )}
    </div>
  );
}

export type Column<T> = {
  id: string;
  label: ReactNode;
  /** CSS grid track, e.g. "minmax(0,1fr)" or "88px". */
  width: string;
  cell: (row: T) => ReactNode;
  sort?: (row: T) => number | string;
  align?: "right";
  /** Dropped on narrow screens. */
  minor?: boolean;
};

const ROW_H = 38;
const VIRTUAL_OVER = 200;

/** A sortable table. Rows can be clicked; lists over 200 rows are virtualised. */
export function SortTable<T>(props: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRow?: (row: T) => void;
  rowTitle?: (row: T) => string;
  initialSort?: { id: string; desc: boolean };
  empty?: string;
  highlight?: (row: T) => boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [sort, setSort] = useState(props.initialSort);
  const cols = props.columns.filter((c) => !(c.minor && width > 0 && width < 560));
  const grid = cols.map((c) => c.width).join(" ");
  const rows = useMemo(() => {
    const col = props.columns.find((c) => c.id === sort?.id);
    if (!col?.sort || !sort) return props.rows;
    const key = col.sort;
    return [...props.rows].sort((a, b) => {
      const x = key(a);
      const y = key(b);
      const d = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return sort.desc ? -d : d;
    });
  }, [props.rows, props.columns, sort]);

  const scroller = useRef<HTMLDivElement>(null);
  const virtual = rows.length > VIRTUAL_OVER;
  const v = useVirtualizer({ count: virtual ? rows.length : 0, getScrollElement: () => scroller.current, estimateSize: () => ROW_H, overscan: 12 });

  const renderRow = (r: T, style?: CSSProperties) => (
    <div
      key={props.rowKey(r)}
      role="row"
      tabIndex={props.onRow ? 0 : undefined}
      title={props.rowTitle?.(r)}
      onClick={() => props.onRow?.(r)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && props.onRow && (e.preventDefault(), props.onRow(r))}
      style={{ gridTemplateColumns: grid, height: ROW_H, ...style }}
      className={cn(
        "grid items-center gap-3 border-b border-foreground/[0.06] px-2 text-[13px] outline-none",
        props.onRow && "cursor-pointer hover:bg-foreground/[0.05] focus-visible:bg-foreground/[0.07]",
        props.highlight?.(r) && "bg-foreground/[0.06]",
      )}
    >
      {cols.map((c) => (
        <div key={c.id} role="cell" className={cn("min-w-0 truncate", c.align === "right" && "text-right tabular-nums")}>
          {c.cell(r)}
        </div>
      ))}
    </div>
  );

  return (
    <div ref={ref} role="table" className="w-full">
      <div role="row" style={{ gridTemplateColumns: grid }} className="grid items-end gap-3 border-b border-foreground/10 px-2 pb-1.5 text-[11px] font-medium text-muted-foreground">
        {cols.map((c) => {
          const active = sort?.id === c.id;
          return (
            <div key={c.id} role="columnheader" aria-sort={active ? (sort!.desc ? "descending" : "ascending") : undefined} className={cn("min-w-0", c.align === "right" && "text-right")}>
              {c.sort ? (
                <button
                  onClick={() => setSort({ id: c.id, desc: active ? !sort!.desc : true })}
                  className={cn("inline-flex max-w-full items-center gap-0.5 hover:text-foreground", active && "text-foreground", c.align === "right" && "flex-row-reverse")}
                >
                  <span className="truncate">{c.label}</span>
                  {active && (sort!.desc ? <ArrowDown className="size-3 shrink-0" /> : <ArrowUp className="size-3 shrink-0" />)}
                </button>
              ) : (
                <span className="truncate">{c.label}</span>
              )}
            </div>
          );
        })}
      </div>
      {!rows.length ? (
        <p className="px-2 py-4 text-xs text-muted-foreground">{props.empty ?? "Nothing here yet."}</p>
      ) : virtual ? (
        <div ref={scroller} className="max-h-[456px] overflow-y-auto">
          <div style={{ height: v.getTotalSize(), position: "relative" }}>
            {v.getVirtualItems().map((it) => renderRow(rows[it.index], { position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${it.start}px)` }))}
          </div>
        </div>
      ) : (
        <div>{rows.map((r) => renderRow(r))}</div>
      )}
    </div>
  );
}

/** "45 s", "12 min", "2.5 h". */
export function shortDuration(ms: number): string {
  if (!ms) return "–";
  const s = ms / 1000;
  if (s < 1) return "<1 s";
  if (s < 60) return `${Math.round(s)} s`;
  const m = s / 60;
  if (m < 90) return `${Math.round(m)} min`;
  return `${(m / 60).toFixed(1)} h`;
}

export const pct = (n: number) => `${Math.round(n)}%`;

const SPECIAL_TOOLS: Record<string, string> = {
  Agent: "Hands work to a helper",
  Task: "Hands work to a helper",
  SendMessage: "Messages another agent",
  SubagentHandback: "Reports back",
  AskUserQuestion: "Asks you",
};
/** "Read" -> "Reads a file", in plain words. */
export function toolLabel(tool: string) {
  if (SPECIAL_TOOLS[tool]) return SPECIAL_TOOLS[tool];
  try {
    return explainTool(tool, {}, "Claude").title;
  } catch {
    return tool;
  }
}

/** Token columns shared by the tables: the total, plus the breakdown when technical details are on. */
export function tokenColumns<T>(usage: (r: T) => Usage, tech: boolean, share?: number): Column<T>[] {
  const cols: Column<T>[] = [{ id: "tokens", label: "Tokens", width: "108px", align: "right", sort: (r) => totalTokens(usage(r)), cell: (r) => fmt(totalTokens(usage(r))) }];
  if (share) cols.push({ id: "share", label: "Share", width: "52px", align: "right", minor: true, sort: (r) => totalTokens(usage(r)), cell: (r) => pct((totalTokens(usage(r)) / share) * 100) });
  if (tech) {
    cols.push(
      { id: "fresh", label: "New", width: "76px", align: "right", minor: true, sort: (r) => usage(r).fresh, cell: (r) => fmt(usage(r).fresh) },
      { id: "cached", label: "Re-read", width: "84px", align: "right", minor: true, sort: (r) => usage(r).cached, cell: (r) => fmt(usage(r).cached) },
      { id: "written", label: "Written", width: "72px", align: "right", minor: true, sort: (r) => usage(r).written, cell: (r) => fmt(usage(r).written) },
    );
  }
  return cols;
}


/** Plain-English labels that more than one tool shares, so the table can show the real names to tell them apart. */
export function sameLabel(tools: string[]): Set<string> {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const t of tools) {
    const l = toolLabel(t);
    if (seen.has(l)) twice.add(l);
    seen.add(l);
  }
  return twice;
}

/** A chart's data as a table, one click away (rendered only when opened: some series are long). */
export function AsTable({ children, label = "Show as a table" }: { children: () => ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="mt-2" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="w-max cursor-pointer text-xs text-muted-foreground select-none hover:text-foreground">{label}</summary>
      {open && <div className="mt-2">{children()}</div>}
    </details>
  );
}
