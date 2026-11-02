"use client";

import { useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";

const THRESHOLD = 200;
type Props<T> = {
  items: T[];
  estimate: number;
  render: (item: T, i: number) => ReactNode;
  /** A stable key per row (defaults to its position). */
  getKey?: (item: T, i: number) => string | number;
  /** Classes for the list itself. */
  className?: string;
  /** Classes for the scroll box of a long list; replaces the default border and `maxHeight`. */
  boxClassName?: string;
  maxHeight?: number;
  label?: string;
};

/**
 * A list that renders every row while short, and only the rows in view (in its own scroll box) once it has
 * more than 200, so huge sessions stay fast. Rows can be any height. With `initial`, only that many rows show
 * until "Show all" is pressed.
 */
export function VirtualList<T>({ initial, ...props }: Props<T> & { initial?: number }) {
  const [all, setAll] = useState(false);
  const cut = initial !== undefined && !all && props.items.length > initial + 2;
  const items = cut ? props.items.slice(0, initial) : props.items;
  return (
    <>
      {items.length <= THRESHOLD ? (
        <ul className={props.className} aria-label={props.label}>
          {items.map((it, i) => (
            <li key={props.getKey ? props.getKey(it, i) : i}>{props.render(it, i)}</li>
          ))}
        </ul>
      ) : (
        <Windowed {...props} items={items} />
      )}
      {(cut || (all && initial !== undefined)) && (
        <button onClick={() => setAll(!all)} className="mt-2 h-8 rounded-lg border border-foreground/10 px-3 text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground">
          {all ? "Show fewer" : `Show all ${props.items.length.toLocaleString()}`}
        </button>
      )}
    </>
  );
}

function Windowed<T>({ items, estimate, render, getKey, className, boxClassName, maxHeight = 520, label }: Props<T>) {
  const scroller = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => estimate,
    overscan: 8,
    getItemKey: getKey ? (i) => getKey(items[i], i) : undefined,
  });
  return (
    <div ref={scroller} className={cn("overflow-y-auto", boxClassName ?? "rounded-xl border border-foreground/10")} style={boxClassName ? undefined : { maxHeight }}>
      <ul className={className} aria-label={label} style={{ height: v.getTotalSize(), position: "relative" }}>
        {v.getVirtualItems().map((row) => (
          <li key={row.key} data-index={row.index} ref={v.measureElement} className="absolute inset-x-0" style={{ transform: `translateY(${row.start}px)` }}>
            {render(items[row.index], row.index)}
          </li>
        ))}
      </ul>
    </div>
  );
}
