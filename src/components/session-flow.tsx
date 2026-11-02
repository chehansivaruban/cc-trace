"use client";

import { useEffect, useRef, useState } from "react";
import { Brain, ChevronRight } from "lucide-react";
import type { Actor, Step, Turn } from "@/lib/session";
import { useMask } from "@/hooks/use-mask";
import { useZoom } from "@/hooks/use-zoom";
import { safeClip } from "@/lib/redact";
import { cn } from "@/lib/utils";
import { hueColor } from "./step-icon";
import { Term } from "./term-text";
import { ZoomControls } from "./zoom-controls";

const BAND_W = 64;
const MAX_HELPER_CHIPS = 5;
const LEAD_HUE = 28;

function ago(ms: number) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const memoryOf = (t?: Turn) => t?.steps.find((s) => s.kind === "memory")?.memory;

/**
 * Every request in the session, top to bottom, joined by Claude's memory: a stream that
 * grows as the conversation does (Claude re-reads everything above before each reply)
 * and narrows when Claude summarises. Helpers branch off without it.
 */
export function SessionFlow(props: {
  turns: Turn[];
  actors: Record<string, Actor>;
  current: number;
  liveIndex?: number;
  onOpen: (turn: number) => void;
  onOpenActor: (turn: number, actor: string) => void;
}) {
  const { turns, actors, current } = props;
  const [hover, setHover] = useState<number | null>(null);
  const focus = hover ?? current;
  const focusMem = memoryOf(turns[focus]);

  // Band width follows the memory each request started with. An unmeasured request reuses the
  // last known size, except right after a summary, when memory shrank: then the next known size.
  const max = Math.max(1, ...turns.map((t) => t.context));
  let last = 0;
  const sizes = turns.map((t, i) => {
    const mem = memoryOf(t);
    if (mem?.summarized && mem.from !== memoryOf(turns[i - 1])?.from) last = 0;
    if (t.context) last = t.context;
    return last || (turns.slice(i + 1).find((x) => x.context)?.context ?? 0);
  });
  const width = (n: number) => (n ? 6 + (n / max) * (BAND_W - 18) : 3);

  const active = useRef<HTMLDivElement>(null);
  useEffect(() => {
    active.current?.scrollIntoView({ block: "center" });
  }, []);

  const scroller = useRef<HTMLDivElement>(null);
  const { zoom, zoomRef, setZoom } = useZoom(scroller);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest("input, textarea, select, [role=menu], [role=dialog]")) return;
      if (e.key === "+" || e.key === "=") setZoom(zoomRef.current * 1.25);
      else if (e.key === "-") setZoom(zoomRef.current / 1.25);
      else if (e.key === "0") setZoom(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setZoom, zoomRef]);

  return (
    <section className="relative h-full" aria-label="Whole session">
      <div ref={scroller} className="h-full cursor-grab overflow-auto data-[panning]:cursor-grabbing data-[panning]:select-none">
        <div className="mx-auto max-w-[920px] px-4 pt-5 pb-16 sm:px-6" style={{ zoom }}>
          <h2 className="text-lg font-semibold tracking-tight">How your requests connect</h2>
          <p className="mt-1 max-w-[640px] text-[13px] leading-relaxed text-muted-foreground">
            The orange stream is Claude&apos;s <Term k="context">memory</Term>. Before every reply Claude re-reads everything above it, so each request builds on the
            ones before and the stream gets wider. Where it narrows, Claude summarised older parts to make room. <Term k="helper">Helpers</Term> branch off to the
            side: they never get this memory, only their <Term k="brief">brief</Term>. Hover a request to see what it remembers; click it to open it.
          </p>

          <div className="mt-6" onMouseLeave={() => setHover(null)}>
            {turns.map((t, i) => {
              const mem = memoryOf(t);
              const prev = turns[i - 1];
              const compacted = mem?.summarized && mem.from !== memoryOf(prev)?.from;
              const remembered = !!focusMem && i >= focusMem.from && i <= focusMem.to;
              const summarised = !!focusMem?.summarized && i < focusMem.from;
              return (
                <div key={t.index}>
                  {compacted && <Compaction top={width(sizes[i - 1])} bottom={width(sizes[i])} from={mem!.from} />}
                  <Row
                    turn={t}
                    actors={actors}
                    top={i === 0 ? 0 : width(compacted ? sizes[i] : sizes[i - 1])}
                    bottom={width(sizes[i])}
                    first={i === 0}
                    focus={t.index === focus}
                    selected={t.index === current}
                    remembered={remembered}
                    summarised={summarised}
                    live={t.index === props.liveIndex}
                    refEl={t.index === current ? active : undefined}
                    onHover={() => setHover(t.index)}
                    onOpen={() => props.onOpen(t.index)}
                    onOpenActor={(a) => props.onOpenActor(t.index, a)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="absolute right-3 bottom-3 z-30">
        <ZoomControls zoom={zoom} onZoom={(z) => setZoom(z)} />
      </div>
    </section>
  );
}

/** One slice of the memory stream; the top edge tapers from the previous size. */
function Band({ top, bottom, strong, first }: { top: number; bottom: number; strong: boolean; first: boolean }) {
  const c = BAND_W / 2;
  const d = first
    ? `M${c - bottom / 2} 14 L${c + bottom / 2} 14 L${c + bottom / 2} 100 L${c - bottom / 2} 100 Z`
    : `M${c - top / 2} 0 L${c + top / 2} 0 L${c + bottom / 2} 14 L${c + bottom / 2} 100 L${c - bottom / 2} 100 L${c - bottom / 2} 14 Z`;
  return (
    <svg className="absolute inset-y-0 left-0 h-full" width={BAND_W} viewBox={`0 0 ${BAND_W} 100`} preserveAspectRatio="none" aria-hidden>
      <path d={d} fill={hueColor(LEAD_HUE, strong ? 0.65 : 0.28)} className="transition-[fill] duration-200" />
    </svg>
  );
}

function Compaction({ top, bottom, from }: { top: number; bottom: number; from: number }) {
  return (
    <div className="relative flex min-h-[56px] items-center" style={{ paddingLeft: BAND_W + 12 }}>
      <Band top={top} bottom={bottom} strong={false} first={false} />
      <div className="flex items-center gap-2 rounded-full border border-dashed border-foreground/20 px-3 py-1.5 text-xs text-muted-foreground">
        <Brain className="size-3.5" />
        Memory full: Claude summarised everything before request {from + 1} to make room
      </div>
    </div>
  );
}

function Row(props: {
  turn: Turn;
  actors: Record<string, Actor>;
  top: number;
  bottom: number;
  first: boolean;
  focus: boolean;
  selected: boolean;
  remembered: boolean;
  summarised: boolean;
  live: boolean;
  refEl?: React.Ref<HTMLDivElement>;
  onHover: () => void;
  onOpen: () => void;
  onOpenActor: (actor: string) => void;
}) {
  const { turn: t, actors } = props;
  const mask = useMask();
  // Cut at a word boundary first (the card shows two lines), then masked: masking still sees whole words.
  const reply = t.steps.findLast((s: Step) => s.kind === "reply")?.quote;
  const shortReply = typeof reply === "string" && reply ? mask(safeClip(reply, 400)) : undefined;
  const helpers = t.actors.filter((id) => actors[id]?.kind === "helper");
  const mem = memoryOf(t);
  const tag = props.remembered ? "remembered" : props.summarised ? "summary only" : null;

  return (
    <div ref={props.refEl} className="relative flex flex-wrap items-start gap-x-6 gap-y-2 py-2.5" style={{ paddingLeft: BAND_W + 12 }} onMouseEnter={props.onHover}>
      <Band top={props.top} bottom={props.bottom} strong={props.focus || props.remembered} first={props.first} />
      <button
        onClick={props.onOpen}
        onFocus={props.onHover}
        className={cn(
          "relative w-full max-w-[460px] rounded-2xl border bg-card px-4 py-3 text-left shadow-sm transition-[box-shadow,border-color,opacity] hover:shadow-md",
          props.selected ? "border-foreground/40" : "border-foreground/10",
          props.focus && "ring-2 ring-offset-0",
          props.summarised && "opacity-60",
        )}
        style={props.focus ? { ["--tw-ring-color" as string]: hueColor(LEAD_HUE, 0.45) } : undefined}
      >
        {/* The request plugs into the memory stream on its left. */}
        <span className="absolute top-1/2 -left-3 h-px w-3" style={{ background: hueColor(LEAD_HUE, 0.6) }} />
        <span className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
          <span>Request {t.index + 1}</span>
          {props.live && (
            <span className="flex items-center gap-1 text-sky-500 dark:text-sky-300">
              <span className="size-1.5 animate-pulse rounded-full bg-current" /> live
            </span>
          )}
          {tag && (
            <span className="rounded-full px-1.5 py-px text-[10px] font-semibold text-white" style={{ background: hueColor(LEAD_HUE, props.remembered ? 0.9 : 0.5) }}>
              {tag}
            </span>
          )}
          <span className="ml-auto">{ago(t.ts)}</span>
        </span>
        <span className="mt-1 line-clamp-2 text-[13.5px] leading-snug font-medium">{mask(safeClip(t.text, 400))}</span>
        {shortReply && <span className="mt-1.5 line-clamp-2 text-xs leading-snug text-muted-foreground">Claude: {shortReply}</span>}
        <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {mem ? (
            <span>
              remembers {mem.summarized ? "a summary + " : ""}
              {mem.from === mem.to ? `#${mem.from + 1}` : `#${mem.from + 1}–${mem.to + 1}`}
              {t.context ? ` · ${short(t.context)} tokens` : ""}
            </span>
          ) : (
            <span>starts with an empty memory</span>
          )}
          <span>{t.steps.length} steps</span>
          <ChevronRight className="ml-auto size-3.5" />
        </span>
      </button>

      {helpers.length > 0 && (
        <div className="min-w-0 border-l border-dashed border-foreground/25 py-1 pl-4">
          <p className="text-[11px] text-muted-foreground">
            {helpers.length} helper{helpers.length === 1 ? "" : "s"} · got only a brief
          </p>
          <div className="mt-1.5 flex max-w-[340px] flex-wrap gap-1.5">
            {helpers.slice(0, MAX_HELPER_CHIPS).map((id) => (
              <button
                key={id}
                onClick={() => props.onOpenActor(id)}
                className="max-w-[160px] truncate rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white"
                style={{ background: hueColor(actors[id].hue) }}
                title={mask(actors[id].name)}
              >
                {mask(actors[id].name)}
              </button>
            ))}
            {helpers.length > MAX_HELPER_CHIPS && <span className="px-1 text-[11px] text-muted-foreground">+{helpers.length - MAX_HELPER_CHIPS} more</span>}
          </div>
        </div>
      )}
    </div>
  );
}
