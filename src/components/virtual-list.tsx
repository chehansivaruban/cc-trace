"use client";

import { useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

const THRESHOLD = 200;
type Props<T> = { items: T[]; estimate: number; render: (item: T, i: number) => ReactNode; className?: string; maxHeight?: number; label?: string };

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
            <li key={i}>{props.render(it, i)}</li>
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

function Windowed<T>({ items, estimate, render, className, maxHeight = 520, label }: Props<T>) {
  const scroller = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: items.length, getScrollElement: () => scroller.current, estimateSize: () => estimate, overscan: 8 });
  return (
    <div ref={scroller} className="overflow-y-auto rounded-xl border border-foreground/10" style={{ maxHeight }}>
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
