"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ListFilter } from "lucide-react";
import type { SessionView } from "@/lib/route";
import { cn } from "@/lib/utils";
import { SESSION_VIEWS } from "./views/registry";

/** The id of the panel the session tabs control (page.tsx gives the open view this id). */
export const SESSION_PANEL_ID = "session-view-panel";
export const sessionTabId = (v: SessionView) => `session-tab-${v}`;

/**
 * The view tabs of an open session, plus "Filter steps" on the views that read one request step by step.
 * With room they wrap onto a second line; on narrow screens the bar scrolls sideways, fades at an edge that
 * has more tabs past it, and keeps the open view's tab in sight. Arrow keys, Home and End move between tabs
 * (1–7 open any of them from anywhere).
 */
export function SessionTabs(props: {
  view: SessionView;
  onView: (v: SessionView) => void;
  /** Shown only when given: the views that share the step filter. */
  filter?: { active: boolean; open: boolean; onToggle: () => void };
}) {
  const { view, filter } = props;
  const bar = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const measure = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    const tab = bar.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!bar.current || !tab) return;
    const t = tab.getBoundingClientRect();
    const b = bar.current.getBoundingClientRect();
    if (t.left < b.left || t.right > b.right) bar.current.scrollLeft += t.left - b.left - 12;
  }, [view]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = SESSION_VIEWS.findIndex((v) => v.id === view);
    const n = SESSION_VIEWS.length;
    const next = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const id = SESSION_VIEWS[next].id;
    props.onView(id);
    document.getElementById(sessionTabId(id))?.focus();
  };

  // A fade on the side that has more tabs past it.
  const fade =
    edges.left && edges.right
      ? "[mask-image:linear-gradient(to_right,transparent,black_1.5rem,black_calc(100%-1.5rem),transparent)]"
      : edges.right
        ? "[mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)]"
        : edges.left
          ? "[mask-image:linear-gradient(to_right,transparent,black_1.5rem)]"
          : "";

  return (
    <div className="flex shrink-0 items-end border-b border-foreground/10">
      <div
        ref={bar}
        data-tour="tabs"
        className={cn("flex min-w-0 flex-1 items-center gap-x-1 overflow-x-auto px-3 pt-2 [scrollbar-width:none] @min-[44rem]:flex-wrap @min-[44rem]:overflow-visible", fade, "@min-[44rem]:[mask-image:none]")}
        role="tablist"
        aria-label="Ways to look at this session"
        onKeyDown={onKeyDown}
      >
        {SESSION_VIEWS.map((v) => (
          <button
            key={v.id}
            id={sessionTabId(v.id)}
            role="tab"
            aria-selected={view === v.id}
            aria-controls={SESSION_PANEL_ID}
            tabIndex={view === v.id ? 0 : -1}
            onClick={() => props.onView(v.id)}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 pb-2 text-[0.8125rem] whitespace-nowrap transition-colors",
              view === v.id ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {v.label}
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
