"use client";

import { useEffect, useRef } from "react";
import { ListFilter } from "lucide-react";
import type { SessionView } from "@/lib/route";
import { cn } from "@/lib/utils";
import { SESSION_VIEWS } from "./views/registry";

/**
 * The view tabs of an open session, plus "Filter steps" on the views that read one request step by step.
 * On narrow screens the bar scrolls sideways and keeps the open view's tab in sight (1–7 can open any of them).
 */
export function SessionTabs(props: {
  view: SessionView;
  turnIndex: number;
  turnCount: number;
  onView: (v: SessionView) => void;
  /** Shown only when given: the views that share the step filter. */
  filter?: { active: boolean; open: boolean; onToggle: () => void };
}) {
  const { view, filter } = props;
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tab = bar.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!bar.current || !tab) return;
    const t = tab.getBoundingClientRect();
    const b = bar.current.getBoundingClientRect();
    if (t.left < b.left || t.right > b.right) bar.current.scrollLeft += t.left - b.left - 12;
  }, [view]);

  return (
    <div className="flex shrink-0 items-end border-b border-foreground/10">
      <div ref={bar} data-tour="tabs" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-3 pt-2 [scrollbar-width:none]" role="tablist">
        {SESSION_VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={view === v.id}
            onClick={() => props.onView(v.id)}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 pb-2 text-[0.8125rem] whitespace-nowrap transition-colors",
              view === v.id ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {v.id === "map"
              ? `Request ${props.turnIndex + 1}, step by step`
              : v.id === "flow"
                ? `Whole session · ${props.turnCount} request${props.turnCount === 1 ? "" : "s"}`
                : v.label}
          </button>
        ))}
      </div>
      {filter && (
        <button
          onClick={filter.onToggle}
          aria-expanded={filter.open}
          className={cn(
            "mr-2 mb-1 flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs transition-[background-color,color,transform] duration-150 ease-out hover:bg-foreground/[0.07] active:scale-[0.97]",
            filter.active ? "bg-foreground/[0.07] font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <ListFilter className="size-3.5" />
          <span className="hidden @min-[36rem]:inline">{filter.active ? "Filtered" : "Filter steps"}</span>
          {filter.active && <span className="size-1.5 rounded-full bg-sky-500 @min-[36rem]:hidden" />}
        </button>
      )}
    </div>
  );
}
