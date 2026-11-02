"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { CATEGORIES, filterOptions, filterSteps, isFilterEmpty, type StepFilter } from "@/lib/analytics/filters";
import type { Actor, Step } from "@/lib/session";
import { useMask } from "@/hooks/use-mask";
import { cn } from "@/lib/utils";
import { hueColor } from "./step-icon";

const TOP = 10;

function toggle<T>(set: Set<T>, v: T): Set<T> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

function Pill({ on, onClick, children, count, dot }: { on: boolean; onClick: () => void; children: ReactNode; count?: number; dot?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "inline-flex max-w-[13.75rem] shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
        on ? "border-foreground bg-foreground text-background" : "border-foreground/15 text-muted-foreground hover:border-foreground/30 hover:text-foreground",
      )}
    >
      {dot && <span className="size-2 shrink-0 rounded-[3px]" style={{ background: dot }} />}
      <span className="truncate">{children}</span>
      {count !== undefined && <span className={cn("tabular-nums", on ? "text-background/70" : "text-muted-foreground/70")}>{count}</span>}
    </button>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 w-[4.25rem] shrink-0 text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">{label}</span>
      {children}
    </div>
  );
}

/**
 * Filter pills for a list of steps (C2): categories, one pill per tool and per command, agents and text.
 * Groups combine with AND, pills in one group with OR. Shows "showing X of Y".
 */
export function FilterBar({
  steps,
  value,
  onChange,
  actors,
  mask: maskProp,
  className,
}: {
  steps: Step[];
  value: StepFilter;
  onChange: (f: StepFilter) => void;
  actors?: Record<string, Actor>;
  mask?: (s: string) => string;
  className?: string;
}) {
  const ctxMask = useMask();
  const mask = maskProp ?? ctxMask; // names are masked like everywhere else unless the caller decides
  const [more, setMore] = useState(false);
  const [allTools, setAllTools] = useState(false);
  const opts = useMemo(() => filterOptions(steps), [steps]);
  const shown = useMemo(() => filterSteps(steps, value).length, [steps, value]);
  const set = (patch: Partial<StepFilter>) => onChange({ ...value, ...patch });
  const picked = value.tools.size + value.commands.size + value.agents.size;
  const tools = allTools ? opts.tools : opts.tools.slice(0, TOP);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-8 min-w-0 flex-1 basis-[11.25rem] items-center gap-2 rounded-lg border border-foreground/15 px-2.5 text-[0.8125rem] focus-within:border-foreground/40">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={value.text}
            onChange={(e) => set({ text: e.target.value })}
            placeholder="Filter by text…"
            aria-label="Filter steps by text"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          />
          {value.text && (
            <button type="button" onClick={() => set({ text: "" })} aria-label="Clear the text filter" className="text-muted-foreground hover:text-foreground">
              <X className="size-3.5" />
            </button>
          )}
        </label>
        <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
          Showing {shown.toLocaleString()} of {steps.length.toLocaleString()}
        </span>
        {!isFilterEmpty(value) && (
          <button
            type="button"
            onClick={() => onChange({ categories: new Set(), tools: new Set(), commands: new Set(), agents: new Set(), text: "" })}
            className="text-xs font-medium underline underline-offset-2"
          >
            Clear filters
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.filter((c) => opts.categories[c.id] > 0 || value.categories.has(c.id)).map((c) => (
          <Pill key={c.id} on={value.categories.has(c.id)} count={opts.categories[c.id]} onClick={() => set({ categories: toggle(value.categories, c.id) })}>
            {c.label}
          </Pill>
        ))}
        {(opts.tools.length > 0 || opts.agents.length > 1) && (
          <button type="button" onClick={() => setMore(!more)} aria-expanded={more} className="inline-flex items-center gap-1 px-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
            {more ? "Fewer filters" : `More filters${picked ? ` (${picked})` : ""}`}
            <ChevronDown className={cn("size-3.5 transition-transform", more && "rotate-180")} />
          </button>
        )}
      </div>
      {more && (
        <div className="space-y-2 rounded-xl bg-foreground/[0.03] p-2.5">
          {opts.agents.length > 1 && (
            <Group label="Agents">
              {opts.agents.map((a) => {
                const actor = actors?.[a.id];
                return (
                  <Pill key={a.id} on={value.agents.has(a.id)} count={a.count} dot={actor ? hueColor(actor.hue) : undefined} onClick={() => set({ agents: toggle(value.agents, a.id) })}>
                    {mask(actor?.name ?? a.id)}
                  </Pill>
                );
              })}
            </Group>
          )}
          {opts.tools.length > 0 && (
            <Group label="Tools">
              {tools.map((t) => (
                <Pill key={t.name} on={value.tools.has(t.name)} count={t.count} onClick={() => set({ tools: toggle(value.tools, t.name) })}>
                  {mask(t.name)}
                </Pill>
              ))}
              {opts.tools.length > TOP && (
                <button type="button" onClick={() => setAllTools(!allTools)} className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground">
                  {allTools ? "Show fewer" : `+${opts.tools.length - TOP} more`}
                </button>
              )}
            </Group>
          )}
          {opts.commands.length > 0 && (
            <Group label="Commands">
              {opts.commands.slice(0, 24).map((c) => (
                <Pill key={c.name} on={value.commands.has(c.name)} count={c.count} onClick={() => set({ commands: toggle(value.commands, c.name) })}>
                  {mask(c.name)}
                </Pill>
              ))}
            </Group>
          )}
        </div>
      )}
    </div>
  );
}
