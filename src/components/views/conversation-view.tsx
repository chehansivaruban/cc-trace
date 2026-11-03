"use client";

// The Conversation view: one request as a chat, top to bottom. Your messages, Claude's and its helpers'
// replies (markdown), every tool step as a one-line row that opens into its renderer, and the special
// moments (memory tidying, failed requests, you stopping Claude). Long requests are virtualized.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Brain, Check, ChevronRight, Copy, Loader2, OctagonX, PanelRight, Scissors, TriangleAlert } from "lucide-react";
import { FindBar } from "@/components/find-bar";
import { Markdown } from "@/components/markdown";
import { StepIcon, hueColor } from "@/components/step-icon";
import { TermText } from "@/components/term-text";
import { ToolRenderer } from "@/components/tools";
import { ImageList } from "@/components/tools/image";
import { nearestExplanation } from "@/lib/analytics/explanations";
import { filterSteps, isFilterEmpty } from "@/lib/analytics/filters";
import { conversationRows, formatDuration, modelLabel, toolTime, type ConvRow } from "@/lib/conversation";
import { ERROR_NOTE } from "@/lib/explain";
import { rowSearchText } from "@/lib/find-text";
import { useMask } from "@/hooks/use-mask";
import { SESSION_START, totalTokens, type Actor, type Step, type Usage } from "@/lib/session";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import type { SessionViewProps } from "./registry";
import { fmt } from "@/components/view-kit";

const VIRTUAL_AT = 200;
const LONG_TEXT = 2400;
const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const time = (ts: number) => (ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");

export function ConversationView(props: SessionViewProps) {
  // A fresh list per request: expanded rows and scroll position don't carry over.
  return <Conversation key={props.turn.index} {...props} />;
}

function Conversation({ model, turn, selected, onSelect, filter }: SessionViewProps) {
  const [settings] = useSettings();
  // The session's folders tell the masker whose home folder this is, so the user name is hidden everywhere.
  const mask = useMask();
  const [techPick, setTech] = useState<boolean | null>(null);
  const tech = techPick ?? settings.showTechnical;
  const open = turn.index === model.turns.length - 1 && model.live.active;
  const allRows = useMemo(() => conversationRows(turn, model.actors, { open }), [turn, model.actors, open]);
  // The step filter (shared with the Map) leaves out rows that don't pass, the same way the Map does.
  const filtered = !!filter && !isFilterEmpty(filter);
  const rows = useMemo(() => {
    if (!filter || isFilterEmpty(filter)) return allRows;
    const keep = new Set(filterSteps(turn.steps, filter));
    return allRows.filter((r) => keep.has(r.step));
  }, [allRows, filter, turn.steps]);
  const index = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows]);
  const virtual = rows.length > VIRTUAL_AT;
  // Find searches each row's text from the data (folded tool details too), worked out only while finding.
  const searchTexts = useCallback(() => rows.map((r) => rowSearchText(r, mask)), [rows, mask]);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [flash, setFlash] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const localPick = useRef<string | null>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i]?.kind === "text" || rows[i]?.kind === "you" ? 140 : 40),
    getItemKey: (i) => rows[i]?.id ?? i,
    overscan: 8,
    enabled: virtual,
  });

  const scrollToRow = useCallback(
    (i: number) => {
      if (virtual) virtualizer.scrollToIndex(i, { align: "center" });
      else listRef.current?.querySelector(`[data-find-row="${i}"]`)?.scrollIntoView({ block: "center", behavior: settings.reduceMotion ? "auto" : "smooth" });
    },
    [virtual, virtualizer, settings.reduceMotion],
  );
  const flashRow = useCallback((id: string) => {
    setFlash(id);
    window.setTimeout(() => setFlash((f) => (f === id ? null : f)), 1800);
  }, []);

  // A step picked elsewhere (the map, a deep link): bring it into view, opened. A pick made here (Explain this
  // step) is skipped once; picking the same step again later from elsewhere scrolls as usual.
  const pickedId = selected?.type === "step" ? selected.id : null;
  useEffect(() => {
    const local = localPick.current;
    localPick.current = null;
    if (!pickedId || pickedId === local) return;
    const i = index.get(pickedId);
    if (i === undefined) return;
    if (rows[i].kind === "tool") setExpanded((s) => new Set(s).add(pickedId));
    requestAnimationFrame(() => scrollToRow(i));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the pick changes
  }, [pickedId]);

  // While the request is still going, follow new rows if you're at the bottom.
  useEffect(() => {
    if (!open || !atBottom.current || !rows.length) return;
    if (virtual) virtualizer.scrollToIndex(rows.length - 1, { align: "end" });
    else if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when rows arrive
  }, [rows.length, open]);

  const toggle = useCallback(
    (id: string) =>
      setExpanded((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }),
    [],
  );
  const why = useCallback(
    (id: string) => {
      const ex = nearestExplanation(turn, id);
      const i = ex ? index.get(ex.id) : undefined;
      if (!ex || i === undefined) return;
      scrollToRow(i);
      flashRow(ex.id);
    },
    [turn, index, scrollToRow, flashRow],
  );
  // Find: bring row i into the page and unfold a tool step, so its match can be shown.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const scrollRef2 = useRef(scrollToRow);
  scrollRef2.current = scrollToRow;
  const reveal = useCallback((i: number) => {
    const row = rowsRef.current[i];
    if (!row) return;
    if (row.kind === "tool") setExpanded((s) => (s.has(row.id) ? s : new Set(s).add(row.id)));
    // Rows in the page are scrolled to the exact match by the find bar; virtualized ones must mount first.
    if (!listRef.current?.querySelector(`[data-find-row="${i}"]`)) scrollRef2.current(i);
  }, []);
  const details = useCallback(
    (id: string) => {
      localPick.current = id;
      onSelect({ type: "step", id });
    },
    [onSelect],
  );
  const hasWhy = useMemo(() => {
    // One pass: the latest explanation seen so far, per agent.
    const last = new Map<string, string>();
    const out = new Set<string>();
    for (const s of turn.steps) {
      if (s.kind === "note" && !s.event && s.quote) last.set(s.actor, s.id);
      else if (last.has(s.actor)) out.add(s.id);
    }
    return out;
  }, [turn]);

  const tools = rows.filter((r) => r.kind === "tool");
  const said = rows.filter((r) => r.kind === "text" || r.kind === "you").length;
  const toolMs = useMemo(() => toolTime(turn.steps), [turn]);
  const thought = turn.steps.filter((s) => s.thinking).length;
  const allOpen = tools.length > 0 && tools.every((r) => expanded.has(r.id));

  const renderRow = (row: ConvRow, i: number) => (
    <RowView
      row={row}
      i={i}
      actors={model.actors}
      open={expanded.has(row.id)}
      flash={flash === row.id}
      picked={pickedId === row.id}
      tech={tech}
      canWhy={row.kind === "tool" && hasWhy.has(row.id)}
      onToggle={toggle}
      onWhy={why}
      onDetails={details}
    />
  );

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Conversation">
      <div className="shrink-0 border-b border-foreground/10 px-4 py-3">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1 basis-[min(100%,26.25rem)]">
            <p className="text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">Conversation · Request {turn.index + 1}</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">What was said, in order</h2>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">
              What you asked, what Claude and its helpers said, and every step they took. Click a step to open it.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {tools.length > 0 && (
              <button
                onClick={() => setExpanded(allOpen ? new Set() : new Set(tools.map((r) => r.id)))}
                className="flex h-8 items-center rounded-lg border border-foreground/10 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
              >
                {allOpen ? "Close all steps" : "Open all steps"}
              </button>
            )}
            <FindBar target={listRef} texts={searchTexts} reveal={reveal} />
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            {said} message{said === 1 ? "" : "s"} · {tools.length} step{tools.length === 1 ? "" : "s"}
            {toolMs > 0 && <span title="Steps that ran at the same time are counted once."> · tools ran for {formatDuration(toolMs)}</span>}
          </span>
          <span>
            {thought ? (
              <TermText text={`Claude's [[thinking:thinking]] was saved for ${thought} repl${thought === 1 ? "y" : "ies"}: open it under each message.`} />
            ) : (
              <TermText text="Claude's private [[thinking:thinking]] isn't saved in this log." />
            )}
          </span>
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 select-none">
            <input type="checkbox" checked={tech} onChange={(e) => setTech(e.target.checked)} className="accent-foreground" />
            Show technical details
          </label>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-5">
          {!rows.length && <p className="py-8 text-sm text-muted-foreground">{filtered ? "No steps match the filter." : "Nothing has happened in this request yet."}</p>}
          <div ref={listRef} style={virtual ? { height: virtualizer.getTotalSize(), position: "relative" } : undefined}>
            {virtual
              ? virtualizer.getVirtualItems().map((v) => (
                  <div key={v.key} data-index={v.index} ref={virtualizer.measureElement} className="absolute inset-x-0 top-0" style={{ transform: `translateY(${v.start}px)` }}>
                    {renderRow(rows[v.index], v.index)}
                  </div>
                ))
              : rows.map((r, i) => <div key={r.id}>{renderRow(r, i)}</div>)}
          </div>
          {open && (
            <p className="mt-3 flex items-center gap-2 text-xs text-sky-600 dark:text-sky-300">
              <Loader2 className="size-3.5 animate-spin" /> {mask(model.live.sentence)}…
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

type RowProps = {
  row: ConvRow;
  i: number;
  actors: Record<string, Actor>;
  open: boolean;
  flash: boolean;
  picked: boolean;
  tech: boolean;
  canWhy: boolean;
  onToggle: (id: string) => void;
  onWhy: (id: string) => void;
  onDetails: (id: string) => void;
};

const RowView = memo(function RowView(p: RowProps) {
  const { row } = p;
  const mask = useMask();
  const hue = p.actors[row.speaker]?.hue ?? (row.speaker === "you" ? 220 : 28);
  const body =
    row.kind === "you" ? (
      <YouRow step={row.step} />
    ) : row.kind === "text" ? (
      <TextRow row={row} actors={p.actors} hue={hue} tech={p.tech} onDetails={p.onDetails} />
    ) : row.kind === "tool" ? (
      <ToolRow {...p} hue={hue} />
    ) : (
      <SpecialRow row={row} onDetails={p.onDetails} />
    );
  return (
    <div data-find-row={p.i} data-step={row.id} className="dense-pb pb-2.5">
      <div
        className={cn(
          "rounded-xl transition-shadow duration-500",
          p.flash && "ring-2 ring-amber-400/80 ring-offset-2 ring-offset-background",
          p.picked && !p.flash && "bg-foreground/[0.035]",
          row.depth > 0 && "rounded-l-none border-l-2 pl-2.5 sm:pl-3",
        )}
        style={row.depth > 0 ? { marginLeft: (Math.min(row.depth, 3) - 1) * 14, borderColor: hueColor(hue, 0.6) } : undefined}
      >
        {row.depth > 0 && row.kind === "tool" && (
          <span data-find-skip className="sr-only">
            {mask(p.actors[row.speaker]?.name ?? "A helper")}:{" "}
          </span>
        )}
        {body}
      </div>
    </div>
  );
});

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const mask = useMask();
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(mask(text));
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          // clipboard blocked
        }
      }}
      className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground"
      aria-label={label}
      title={label}
    >
      {done ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function TokenBadge({ usage }: { usage?: Usage }) {
  if (!usage) return null;
  const total = totalTokens(usage);
  if (!total) return null;
  return (
    <span
      className="shrink-0 rounded-full bg-foreground/[0.06] px-1.5 py-px text-[0.6562rem] text-muted-foreground tabular-nums"
      title={`${fmt(total)} tokens for this reply: ${fmt(usage.fresh)} new to Claude, ${fmt(usage.cached)} re-read from cache, ${fmt(usage.written)} written by Claude`}
    >
      {short(total)} tokens
    </span>
  );
}

function ModelBadge({ model, tech }: { model?: string; tech: boolean }) {
  if (!model) return null;
  return (
    <span className="max-w-[10rem] shrink-0 truncate rounded-full border border-foreground/10 px-1.5 py-px text-[0.6562rem] text-muted-foreground" title={`Model: ${model}`}>
      {tech ? model : modelLabel(model)}
    </span>
  );
}

/**
 * Folded content find can open: the element carries data-find-reveal="closed" while folded, and the find bar
 * sends it a "cc-find-reveal" event when the current match is inside.
 */
function useFindReveal(open: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(open);
  cb.current = open;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = () => cb.current();
    el.addEventListener("cc-find-reveal", on);
    return () => el.removeEventListener("cc-find-reveal", on);
  }, []);
  return ref;
}

/** Claude's private thinking, folded. Its text stays in the page (hidden) so find can reach it. */
function Thinking({ text }: { text: string }) {
  const mask = useMask();
  const [open, setOpen] = useState(false);
  const ref = useFindReveal(() => setOpen(true));
  return (
    <div className="mt-1.5">
      <button data-find-skip onClick={() => setOpen(!open)} className="flex items-center gap-1 text-[0.6875rem] font-medium text-muted-foreground hover:text-foreground" aria-expanded={open}>
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
        <Brain className="size-3" /> Claude&apos;s thinking · {fmt(text.length)} characters
      </button>
      <div
        ref={ref}
        hidden={!open}
        data-find-reveal={open ? "open" : "closed"}
        className="mt-1.5 rounded-lg bg-foreground/[0.04] px-3 py-2 text-[0.75rem] leading-relaxed break-words whitespace-pre-wrap text-foreground/75 italic"
      >
        {mask(text)}
      </div>
    </div>
  );
}

/** Long text collapses behind a "Show all" button. */
function Collapsible({ long, children, fade = "from-background" }: { long: boolean; children: ReactNode; fade?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useFindReveal(() => setOpen(true));
  const folded = long && !open;
  return (
    <>
      <div ref={ref} data-find-reveal={folded ? "closed" : "open"} className={cn(folded && "relative max-h-72 overflow-hidden")}>
        {children}
        {folded && <div className={cn("pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t to-transparent", fade)} />}
      </div>
      {long && (
        <button data-find-skip onClick={() => setOpen(!open)} className="mt-1 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground">
          {open ? "Show less" : "Show all"}
        </button>
      )}
    </>
  );
}

function YouRow({ step }: { step: Step }) {
  const mask = useMask();
  const text = typeof step.quote === "string" ? step.quote : "";
  return (
    <div className="ml-auto w-fit max-w-[min(88%,38.75rem)]">
      <div data-find-skip className="mb-1 flex items-center justify-end gap-1.5 text-[0.6875rem] text-muted-foreground">
        <span className="font-semibold" style={{ color: hueColor(220) }}>
          You
        </span>
        <span>{time(step.ts)}</span>
        <CopyButton text={text} label="Copy your message" />
      </div>
      <div className="rounded-2xl rounded-tr-md px-3.5 py-2.5 text-[0.8125rem] leading-relaxed" style={{ background: hueColor(220, 0.14) }}>
        <Collapsible long={text.length > LONG_TEXT} fade="from-transparent">
          <div className="break-words whitespace-pre-wrap">{text === SESSION_START ? text : mask(text)}</div>
        </Collapsible>
        {step.images?.length ? (
          <div className="mt-2">
            <ImageList images={step.images} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TextRow({ row, actors, hue, tech, onDetails }: { row: ConvRow; actors: Record<string, Actor>; hue: number; tech: boolean; onDetails: (id: string) => void }) {
  const mask = useMask();
  const s = row.step;
  const text = typeof s.quote === "string" ? s.quote : "";
  // Helper names come from their briefs, so they're log text too.
  const name = mask(actors[row.speaker]?.name ?? "Claude");
  const to = s.from && actors[s.actor] ? mask(actors[s.actor].name) : undefined;
  const label =
    s.kind === "reply"
      ? "answered you"
      : s.kind === "brief"
        ? `briefed ${to ?? "a helper"}`
        : s.kind === "report"
          ? `reported back${to ? ` to ${to}` : ""}`
          : s.kind === "message"
            ? `wrote to ${to ?? "someone"}`
            : "while working";
  return (
    <div className="max-w-full">
      <div data-find-skip className="mb-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[0.6875rem] text-muted-foreground">
        <span className="size-2 shrink-0 rounded-[3px]" style={{ background: hueColor(hue) }} />
        <span className="max-w-[16rem] truncate font-semibold text-foreground">{name}</span>
        <span className="max-w-[20rem] truncate">{label}</span>
        <span>· {time(s.ts)}</span>
        {s.status === "error" && <span className="text-red-600 dark:text-red-400">· stopped early</span>}
        <span className="ml-auto flex items-center gap-1">
          <ModelBadge model={s.model} tech={tech} />
          <TokenBadge usage={s.usage} />
          {s.tool && (
            <button onClick={() => onDetails(s.id)} className="rounded-md p-1 hover:bg-foreground/[0.07] hover:text-foreground" aria-label="Explain this step" title="Explain this step">
              <PanelRight className="size-3.5" />
            </button>
          )}
          <CopyButton text={text} label="Copy this message" />
        </span>
      </div>
      <div className={cn("rounded-2xl rounded-tl-md border px-3.5 py-2.5", s.kind === "reply" ? "border-foreground/15 bg-background" : "border-foreground/10 bg-foreground/[0.025]")}>
        <Collapsible long={text.length > LONG_TEXT} fade="from-background/0">
          {text ? (
            <Markdown text={text} />
          ) : (
            <p data-find-skip className="text-[0.8125rem] text-muted-foreground">
              (no text)
            </p>
          )}
        </Collapsible>
      </div>
      {s.thinking ? (
        <Thinking text={s.thinking} />
      ) : s.usage ? (
        <p data-find-skip className="mt-1 text-[0.6875rem] text-muted-foreground">
          Thinking not recorded
        </p>
      ) : null}
    </div>
  );
}

const OUTCOME = {
  denied: { text: "you said no", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  interrupted: { text: "stopped by you", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  orphan: { text: "never finished", cls: "bg-foreground/[0.08] text-muted-foreground" },
};

function ToolRow({ row, open, tech, canWhy, onToggle, onWhy, onDetails, hue }: RowProps & { hue: number }) {
  const mask = useMask();
  const s = row.step;
  const outcome = row.outcome ? OUTCOME[row.outcome] : undefined;
  return (
    <div>
      <div className="flex min-w-0 items-center gap-1">
        <button
          onClick={() => onToggle(s.id)}
          aria-expanded={open}
          className="dense-row flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-foreground/[0.05]"
        >
          <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md" style={{ background: hueColor(hue, 0.16), color: hueColor(hue) }}>
            <StepIcon icon={s.icon} className="size-3.5" />
          </span>
          <span data-find-block className="shrink-0 text-[0.8125rem] font-medium">
            {mask(s.title)}
          </span>
          <span data-find-block className="min-w-0 truncate text-xs text-muted-foreground">
            {mask(s.subtitle)}
          </span>
          {tech && s.tool && (
            <code data-find-skip className="hidden max-w-[11.25rem] shrink-0 truncate text-[0.6562rem] text-muted-foreground sm:inline">
              {s.tool}
            </code>
          )}
          <span data-find-skip className="ml-auto flex shrink-0 items-center gap-1.5 pl-1">
            {outcome ? (
              <span className={cn("rounded-full px-1.5 py-px text-[0.6562rem] font-medium whitespace-nowrap", outcome.cls)}>{outcome.text}</span>
            ) : s.status === "error" ? (
              <span className="size-2 rounded-full bg-red-500" role="img" aria-label="didn't work" title="Didn't work" />
            ) : s.status === "running" ? (
              <Loader2 className="size-3.5 animate-spin text-sky-500" aria-label="running" />
            ) : null}
            {s.durationMs !== undefined && <span className="hidden text-[0.6875rem] text-muted-foreground tabular-nums sm:inline">{formatDuration(s.durationMs)}</span>}
          </span>
        </button>
        {canWhy && (
          <button
            data-find-skip
            onClick={() => onWhy(s.id)}
            className="shrink-0 rounded-md px-1.5 py-1 text-[0.6875rem] font-medium text-muted-foreground underline-offset-2 hover:bg-foreground/[0.05] hover:text-foreground hover:underline"
            title="Jump to what Claude said before doing this"
          >
            Why?
          </button>
        )}
      </div>
      {open && (
        <div className="mt-1 mb-1.5 ml-2 space-y-3 rounded-xl border border-foreground/10 p-3 sm:ml-7">
          <p className="text-[0.8125rem] leading-relaxed">
            <TermText text={mask(s.what)} />
          </p>
          {s.status === "error" && !row.outcome && (
            <p data-find-skip className="rounded-lg bg-red-500/10 px-3 py-2 text-[0.75rem] leading-relaxed text-red-600 dark:text-red-300">
              {ERROR_NOTE}
            </p>
          )}
          {row.outcome === "orphan" && (
            <p data-find-skip className="text-xs text-muted-foreground">
              No result was ever logged for this step: the request ended or was cut off before it finished.
            </p>
          )}
          {row.outcome === "denied" && (
            <p data-find-skip className="text-xs text-muted-foreground">
              Claude asked for permission to do this and you said no, so it didn&apos;t happen.
            </p>
          )}
          <ToolRenderer step={s} />
          {s.thinking && <Thinking text={s.thinking} />}
          <div data-find-skip className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] text-muted-foreground">
            <span>{time(s.ts)}</span>
            {s.durationMs !== undefined && <span>· took {formatDuration(s.durationMs)}</span>}
            <ModelBadge model={s.model} tech={tech} />
            <TokenBadge usage={s.usage} />
            <button onClick={() => onDetails(s.id)} className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium hover:bg-foreground/[0.06] hover:text-foreground">
              <PanelRight className="size-3.5" /> Explain this step
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SpecialRow({ row, onDetails }: { row: ConvRow; onDetails: (id: string) => void }) {
  const mask = useMask();
  const s = row.step;
  if (row.kind === "memory") {
    const tokens = s.memory?.tokens ?? 0;
    return (
      <button data-find-skip onClick={() => onDetails(s.id)} className="flex w-full items-center gap-3 py-1 text-[0.6875rem] text-muted-foreground hover:text-foreground">
        <span className="h-px flex-1 bg-foreground/10" />
        <span className="flex items-center gap-1.5 text-center">
          <Brain className="size-3.5 shrink-0" /> Claude re-read the conversation so far{tokens ? ` · ${short(tokens)} tokens` : ""}
        </span>
        <span className="h-px flex-1 bg-foreground/10" />
      </button>
    );
  }
  if (row.kind === "compact")
    return (
      <div data-find-skip className="flex items-center gap-3 py-1 text-[0.6875rem] text-amber-700 dark:text-amber-300">
        <span className="h-px flex-1 bg-amber-500/40" />
        <span className="flex items-center gap-1.5 text-center">
          <Scissors className="size-3.5 shrink-0" /> Claude summarised the conversation here to make room in its memory
        </span>
        <span className="h-px flex-1 bg-amber-500/40" />
      </div>
    );
  if (row.kind === "interrupted")
    return (
      <div data-find-skip className="flex justify-center py-0.5">
        <span className="flex items-center gap-1.5 rounded-full bg-amber-500/12 px-3 py-1 text-[0.75rem] font-medium text-amber-700 dark:text-amber-300">
          <OctagonX className="size-3.5" /> You stopped Claude here · {time(s.ts)}
        </span>
      </div>
    );
  if (row.kind === "error")
    return (
      <div className="rounded-xl bg-red-500/[0.08] px-3.5 py-2.5 text-[0.8125rem]">
        <p data-find-skip className="flex flex-wrap items-center gap-1.5 font-medium text-red-700 dark:text-red-300">
          <TriangleAlert className="size-3.5 shrink-0" /> {s.title === "Request failed" ? "A request to Claude failed" : mask(s.title)}
          <span className="font-normal text-muted-foreground">· {time(s.ts)}</span>
        </p>
        <p className="mt-1 leading-relaxed break-words">{s.kind === "note" ? <TermText text={mask(s.what)} /> : mask(typeof s.quote === "string" ? s.quote : s.what)}</p>
        <p data-find-skip className="mt-1 text-xs text-muted-foreground">
          <TermText text={s.kind === "note" ? mask(s.why) : "Claude Code couldn't get a reply from Claude, often because of a usage limit or a network problem. It isn't something you did."} />
        </p>
      </div>
    );
  return (
    <div data-find-skip className="rounded-xl bg-foreground/[0.04] px-3.5 py-2 text-[0.75rem] text-muted-foreground">
      <span className="font-medium text-foreground">{mask(s.title)}</span> · <TermText text={mask(s.what)} />
    </div>
  );
}
