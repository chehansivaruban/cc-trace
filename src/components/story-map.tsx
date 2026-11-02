"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check, ListOrdered, Loader2, Mail, Pause, Play, Radio, SkipBack, SkipForward, X } from "lucide-react";
import { useMask } from "@/hooks/use-mask";
import { useZoom } from "@/hooks/use-zoom";
import { filterSteps, isFilterEmpty, type StepFilter } from "@/lib/analytics/filters";
import { riskOf } from "@/lib/analytics/risk";
import { MESSAGE_KINDS, type Actor, type Live, type Step, type Turn } from "@/lib/session";
import { cn } from "@/lib/utils";
import { PhaseBand } from "./phase-band";
import { StepIcon, hueColor } from "./step-icon";
import { ZoomControls } from "./zoom-controls";

export type Selection = { type: "step" | "actor"; id: string } | null;

const LABEL_W = 184;
const COL = 214;
const NODE_W = 196;
const NODE_H = 60;
const ROW = 84;
const TOP = 10;
const SPEEDS = [1, 2, 4, 0.5];
const FIT_MIN = 0.5;

const rowTop = (r: number) => TOP + r * ROW;
const nodeY = (r: number) => rowTop(r) + (ROW - NODE_H) / 2;
// Map coordinates, before zoom. The agent names live in their own column, outside the zoomed area.
const colX = (i: number) => 20 + i * COL;

export function StoryMap(props: {
  turn: Turn;
  actors: Record<string, Actor>;
  isLatest: boolean;
  live: Live;
  stale: boolean;
  selected: Selection;
  onSelect: (s: Selection) => void;
  onShowRequests: () => void;
  /** Steps that don't pass are left off the map, like "Only messages between agents" does. */
  filter?: StepFilter;
}) {
  const { turn, actors, isLatest, live, stale, selected, onSelect, filter } = props;
  const mask = useMask();
  const [messagesOnly, setMessagesOnly] = useState(false);
  const steps = useMemo(() => {
    const base = filter && !isFilterEmpty(filter) ? filterSteps(turn.steps, filter) : turn.steps;
    return messagesOnly ? base.filter((s) => MESSAGE_KINDS.includes(s.kind) || s.kind === "stop") : base;
  }, [turn.steps, messagesOnly, filter]);
  const lanes = turn.actors;
  const row = useMemo(() => Object.fromEntries(lanes.map((id, i) => [id, i])), [lanes]);

  // Replay: `cursor` is the step being shown; null means "show everything" (and follow live updates).
  const [cursor, setCursor] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const shown = cursor ?? steps.length - 1;
  const [flying, setFlying] = useState<string | null>(null);

  useEffect(() => {
    setCursor(null);
    setPlaying(false);
  }, [messagesOnly, filter]);

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => {
      const next = (cursor ?? -1) + 1;
      if (next >= steps.length - 1) {
        setPlaying(false);
        setCursor(null);
        show(steps.length - 1, true);
      } else {
        setCursor(next);
        show(next, true);
      }
    }, 1500 / speed);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `show` is stable enough: it only reads refs and props
  }, [playing, cursor, speed, steps.length]);

  const scroller = useRef<HTMLDivElement>(null);
  const { zoom, zoomRef, setZoom } = useZoom(scroller, LABEL_W);
  const reduceMotion = useReducedMotion();
  const scrollTo = (i: number, smooth = true) => {
    const el = scroller.current;
    const s = steps[i];
    if (!el || !s) return;
    const z = zoomRef.current;
    // Centre the box in the part of the view to the right of the names column.
    const x = LABEL_W + (colX(i) + NODE_W / 2) * z - (LABEL_W + (el.clientWidth - LABEL_W) / 2);
    const y = (nodeY(row[s.actor] ?? 0) + NODE_H / 2) * z - el.clientHeight / 2;
    el.scrollTo({ left: Math.max(0, x), top: Math.max(0, y), behavior: smooth && !reduceMotion ? "smooth" : "auto" });
  };
  /**
   * Moves the replay to step i: select it and scroll to it. `animate` is for replay and live
   * updates; keyboard and button steps jump instantly, without the envelope.
   */
  const show = (i: number, animate = false) => {
    const s = steps[i];
    if (!s) return;
    onSelect({ type: "step", id: s.id });
    if (animate && s.from && !reduceMotion) setFlying(s.id);
    scrollTo(i, animate);
  };
  const fit = () => {
    const el = scroller.current;
    if (!el) return;
    // Show as much as fits, but never smaller than text stays readable; − goes further for an outline.
    setZoom(Math.max(FIT_MIN, Math.min(1, (el.clientWidth - LABEL_W - 16) / contentW, (el.clientHeight - 16) / contentH)));
    requestAnimationFrame(() => el.scrollTo({ left: 0, top: 0 }));
  };

  // Following along live: keep the newest step in view, and fly new messages in.
  const lastId = steps.at(-1)?.id;
  const firstRender = useRef(true);
  useEffect(() => {
    if (cursor !== null || !lastId) return;
    scrollTo(steps.length - 1, !firstRender.current);
    if (!firstRender.current && steps.at(-1)?.from && !reduceMotion) setFlying(lastId);
    firstRender.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId]);

  // Something picked outside the map (the summary, a link): bring its box into view.
  const selectedStep = selected?.type === "step" ? selected.id : null;
  useEffect(() => {
    const i = steps.findIndex((s) => s.id === selectedStep);
    if (i >= 0) scrollTo(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStep]);

  const step = (d: number) => {
    setPlaying(false);
    const next = Math.min(steps.length - 1, Math.max(0, (cursor ?? steps.length - 1) + d));
    setCursor(next);
    show(next);
  };
  const togglePlay = () => {
    if (playing) return setPlaying(false);
    if (cursor === null || cursor >= steps.length - 1) {
      setCursor(0);
      show(0, true);
    }
    setPlaying(true);
  };
  const goLive = () => {
    setPlaying(false);
    setCursor(null);
    onSelect(null);
    scrollTo(steps.length - 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.isComposing || t?.closest?.("input, textarea, select, [role=menu], [role=dialog]")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return; // leave browser shortcuts (⌘+ etc.) alone
      if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "+" || e.key === "=") setZoom(zoomRef.current * 1.25);
      else if (e.key === "-") setZoom(zoomRef.current / 1.25);
      else if (e.key === "0") fit();
      else if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const contentW = colX(steps.length) + 20;
  const contentH = rowTop(lanes.length) + 16;
  const current = cursor !== null ? steps[cursor] : undefined;
  // Both name helpers (from their descriptions) and can quote log text, e.g. a search pattern.
  const now = current
    ? { text: mask(current.doing), pulse: false }
    : isLatest && live.active
      ? { text: mask(live.sentence), pulse: true }
      : { text: isLatest ? "Finished. Waiting for your next message" : `Request ${turn.index + 1} is finished`, pulse: false };

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Session map">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 border-b border-foreground/10 px-4 py-3">
        <button
          onClick={props.onShowRequests}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-foreground/10 px-2.5 text-xs text-muted-foreground hover:bg-foreground/[0.06] xl:hidden"
        >
          <ListOrdered className="size-3.5" /> Requests
        </button>
        <div className="flex min-w-0 flex-1 basis-full items-center gap-2.5 sm:basis-0" role="status" aria-live="polite">
          <span className="relative flex size-2.5 shrink-0">
            {now.pulse && <span className="absolute inset-0 animate-ping rounded-full bg-sky-400 opacity-60" />}
            <span className={cn("relative size-2.5 rounded-full", now.pulse ? "bg-sky-400" : current ? "bg-amber-400" : "bg-emerald-400/80")} />
          </span>
          <p className="min-w-0 truncate text-[0.9375rem] font-medium tracking-tight">
            {current && <span className="mr-2 text-muted-foreground tabular-nums">Step {shown + 1}/{steps.length}</span>}
            {now.text}
          </p>
        </div>

        <div className="basis-full" />
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <IconButton label="Previous step (←)" onClick={() => step(-1)} disabled={!steps.length}>
            <SkipBack className="size-4" />
          </IconButton>
          <button
            onClick={togglePlay}
            disabled={!steps.length}
            className="flex h-8 min-w-[5.75rem] items-center justify-center gap-1.5 rounded-lg bg-foreground px-3 text-xs font-medium text-background transition-transform duration-150 active:scale-[0.97] disabled:opacity-40"
            aria-label={playing ? "Pause replay (space)" : "Replay this request step by step (space)"}
          >
            {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            {playing ? "Pause" : "Replay"}
          </button>
          <IconButton label="Next step (→)" onClick={() => step(1)} disabled={!steps.length}>
            <SkipForward className="size-4" />
          </IconButton>
          <input
            type="range"
            min={0}
            max={Math.max(0, steps.length - 1)}
            value={Math.max(0, shown)}
            onChange={(e) => {
              setPlaying(false);
              setCursor(+e.target.value);
              show(+e.target.value);
            }}
            className="mx-1 w-24 min-w-0 accent-foreground sm:w-40"
            aria-label="Scrub through the steps"
          />
          <button
            onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])}
            className="h-8 w-11 rounded-lg border border-foreground/10 text-xs tabular-nums text-muted-foreground transition-[background-color,transform] duration-150 hover:bg-foreground/[0.06] active:scale-[0.97]"
            aria-label={`Replay speed ${speed}×`}
            title="Replay speed"
          >
            {speed}×
          </button>
          <button
            onClick={goLive}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors",
              cursor === null ? "border-foreground/10 text-muted-foreground" : "border-sky-400/40 bg-sky-400/10 text-sky-500 dark:text-sky-300",
            )}
            aria-label={isLatest ? "Back to live" : "Show every step"}
          >
            <Radio className="size-3.5" /> {isLatest ? "Live" : "All"}
          </button>
        </div>

        <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-muted-foreground select-none">
          <input type="checkbox" checked={messagesOnly} onChange={(e) => setMessagesOnly(e.target.checked)} className="accent-foreground" />
          Only messages between agents
        </label>
      </div>
      <PhaseBand turn={turn} selected={selectedStep} onPick={(id) => onSelect({ type: "step", id })} />

      <div className="relative min-h-0 flex-1">
        <div ref={scroller} className="h-full cursor-grab overflow-auto data-[panning]:cursor-grabbing data-[panning]:select-none">
          {!steps.length ? (
            <p className="p-8 text-sm text-muted-foreground">
              {turn.steps.length ? "No steps match the filter or the “Only messages” switch." : "Nothing has happened in this request yet."}
            </p>
          ) : (
            <div className="flex" style={{ width: LABEL_W + contentW * zoom, height: contentH * zoom }}>
              {/* Agent names stay full size and pinned to the left at every zoom level. */}
              <div className="sticky left-0 z-20 shrink-0 border-r border-foreground/10 bg-background/95 backdrop-blur" style={{ width: LABEL_W }}>
                {lanes.map((id, r) => (
                  <Lane key={id} actor={actors[id]} parent={actors[actors[id]?.parent ?? ""]} top={rowTop(r) * zoom} height={ROW * zoom}
                    selected={selected?.type === "actor" && selected.id === id} onClick={() => onSelect({ type: "actor", id })} />
                ))}
              </div>
              <div className="relative shrink-0" style={{ width: contentW, height: contentH, zoom }}>
                {lanes.map((id, r) => (
                  <div key={id} className="absolute inset-x-0 border-b border-dashed border-foreground/10" style={{ top: rowTop(r), height: ROW }} />
                ))}
                <Links steps={steps} row={row} actors={actors} shown={shown} />
                {steps.map((s, i) => (
                  <StepNode
                    key={s.id}
                    step={s}
                    x={colX(i)}
                    y={nodeY(row[s.actor] ?? 0)}
                    hue={actors[s.from ?? s.actor]?.hue ?? 0}
                    future={i > shown}
                    current={i === cursor}
                    selected={selected?.type === "step" && selected.id === s.id}
                    stale={stale}
                    onClick={() => {
                      setPlaying(false);
                      if (cursor !== null) setCursor(i);
                      onSelect({ type: "step", id: s.id });
                    }}
                  />
                ))}
                {flying && <Envelope key={flying} steps={steps} id={flying} row={row} actors={actors} onDone={() => setFlying(null)} />}
              </div>
            </div>
          )}
        </div>
        {steps.length > 0 && (
          <div className="pointer-events-none absolute right-3 bottom-3 z-30 flex flex-col items-end gap-2">
            <Legend />
            <div className="pointer-events-auto">
              <ZoomControls tour zoom={zoom} onZoom={(z) => setZoom(z)} onFit={fit} fitLabel="Fit to screen (0)" />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function IconButton(props: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.label}
      aria-label={props.label}
      className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-foreground/[0.07] hover:text-foreground active:scale-[0.97] disabled:opacity-40"
    >
      {props.children}
    </button>
  );
}

const STATE = {
  working: { label: "Working", cls: "text-sky-500 dark:text-sky-300" },
  done: { label: "Done", cls: "text-emerald-600 dark:text-emerald-400" },
  failed: { label: "Stopped", cls: "text-red-500 dark:text-red-400" },
  idle: { label: "", cls: "" },
};

function Lane(props: { actor?: Actor; parent?: Actor; top: number; height: number; selected: boolean; onClick: () => void }) {
  const { actor, parent } = props;
  const mask = useMask();
  if (!actor) return null;
  const state = STATE[actor.state];
  const name = mask(actor.name);
  const role = mask(actor.role);
  // Zoomed out, rows get short: drop the second and third lines rather than shrink the text.
  const lines = props.height >= 64 ? 3 : props.height >= 40 ? 2 : 1;
  return (
    <button
      onClick={props.onClick}
      className={cn(
        "absolute inset-x-0 flex flex-col justify-center gap-0.5 overflow-hidden border-b border-dashed border-foreground/10 px-3.5 text-left transition-colors duration-150 hover:bg-foreground/[0.04]",
        props.selected && "bg-foreground/[0.06]",
      )}
      style={{ top: props.top, height: props.height }}
      title={`${name} — ${role}`}
      aria-label={`About ${name}`}
    >
      <span className={cn("flex items-center gap-2 font-semibold", lines === 1 ? "text-[11px]" : "text-[13px]")}>
        <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: hueColor(actor.hue) }} />
        <span className="truncate">{name}</span>
        {lines < 3 && actor.state === "working" && <Loader2 className="size-3 shrink-0 animate-spin text-sky-400" />}
      </span>
      {lines === 3 && (
        <span className="truncate text-[11px] text-muted-foreground">
          {actor.kind === "helper" && parent && parent.kind === "helper" ? `helper of ${mask(parent.name)}` : role}
        </span>
      )}
      {lines >= 2 && state.label && (
        <span className={cn("flex items-center gap-1 text-[11px] font-medium", state.cls)}>
          {lines === 3 && actor.state === "working" && <Loader2 className="size-3 animate-spin" />}
          {state.label}
        </span>
      )}
    </button>
  );
}

/** What the symbols on the map mean, for first-time readers. */
function Legend() {
  return (
    <div className="glass hidden max-w-[18.75rem] flex-wrap items-center justify-end gap-x-3.5 gap-y-1 rounded-xl px-3 py-2 text-[0.6875rem] text-muted-foreground shadow-lg md:flex">
      <span className="flex items-center gap-1.5">
        <Check className="size-3 text-emerald-500" strokeWidth={3} /> worked
      </span>
      <span className="flex items-center gap-1.5">
        <X className="size-3 text-red-500" strokeWidth={3} /> didn&apos;t work
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="14" height="12" aria-hidden>
          <line x1="7" x2="7" y1="0" y2="12" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2" />
        </svg>
        message between agents
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-4 rounded-[4px] border border-dashed border-current" /> remembers earlier
      </span>
    </div>
  );
}

/** Each agent's own steps are joined by a faint thread; messages are dashed arrows between lanes. */
function Links({ steps, row, actors, shown }: { steps: Step[]; row: Record<string, number>; actors: Record<string, Actor>; shown: number }) {
  const threads = new Map<string, [number, number]>();
  steps.forEach((s, i) => {
    if (i > shown) return;
    const t = threads.get(s.actor);
    threads.set(s.actor, t ? [t[0], i] : [i, i]);
  });
  return (
    <svg className="pointer-events-none absolute inset-0 z-0" width={colX(steps.length) + 20} height={rowTop(Object.keys(row).length) + 16} aria-hidden>
      {[...threads].map(([id, [a, b]]) => {
        const y = nodeY(row[id] ?? 0) + NODE_H / 2;
        return <line key={id} x1={colX(a) + NODE_W / 2} x2={colX(b) + NODE_W / 2} y1={y} y2={y} stroke={hueColor(actors[id]?.hue ?? 0, 0.35)} strokeWidth={2} />;
      })}
      {steps.map((s, i) => {
        if (!s.from || row[s.from] === undefined || row[s.actor] === undefined || row[s.from] === row[s.actor]) return null;
        const x = colX(i) + NODE_W / 2;
        const down = row[s.actor] > row[s.from];
        const y1 = nodeY(row[s.from]) + NODE_H / 2;
        const y2 = down ? nodeY(row[s.actor]) - 2 : nodeY(row[s.actor]) + NODE_H + 2;
        const c = hueColor(actors[s.from]?.hue ?? 0, i > shown ? 0.12 : 0.85);
        const tip = down ? `M${x - 5} ${y2 - 7} L${x} ${y2} L${x + 5} ${y2 - 7}` : `M${x - 5} ${y2 + 7} L${x} ${y2} L${x + 5} ${y2 + 7}`;
        return (
          <g key={s.id}>
            <line x1={x} x2={x} y1={y1} y2={y2} stroke={c} strokeWidth={2} strokeDasharray="5 4" />
            <path d={tip} fill="none" stroke={c} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </g>
        );
      })}
    </svg>
  );
}

const StepNode = memo(function StepNode(props: {
  step: Step;
  x: number;
  y: number;
  hue: number;
  future: boolean;
  current: boolean;
  selected: boolean;
  stale: boolean;
  onClick: () => void;
}) {
  const { step: s, hue } = props;
  const message = !!s.from || s.kind === "prompt";
  const { tool, input } = s;
  const risk = useMemo(() => riskOf({ tool, input } as Step), [tool, input]);
  const mask = useMask();
  const title = mask(s.title);
  const subtitle = mask(s.subtitle);
  return (
    <button
      onClick={props.onClick}
      tabIndex={props.future ? -1 : 0}
      className={cn(
        "absolute z-10 flex items-center gap-2.5 rounded-xl border bg-card px-2.5 text-left shadow-sm outline-none transition-[opacity,transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-foreground/40 active:scale-[0.97]",
        props.future && "pointer-events-none opacity-[0.13]",
        s.status === "error" && "border-red-400/50",
        s.kind === "memory" && "border-dashed",
        !props.selected && s.status !== "error" && "border-foreground/10",
      )}
      style={{
        left: props.x,
        top: props.y,
        width: NODE_W,
        height: NODE_H,
        background: message ? `color-mix(in oklab, ${hueColor(hue)} 11%, var(--card))` : undefined,
        borderColor: props.selected ? hueColor(hue) : undefined,
        boxShadow: props.current ? `0 0 0 3px ${hueColor(hue, 0.35)}` : undefined,
      }}
      aria-label={`${title}: ${subtitle}`}
      title={subtitle ? `${title} · ${subtitle}` : title}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg" style={{ background: hueColor(hue, 0.16), color: hueColor(hue) }}>
        <StepIcon icon={s.icon} className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1 pr-2">
        <span className="block truncate text-[12.5px] leading-tight font-semibold">{title}</span>
        <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted-foreground">{subtitle || "—"}</span>
      </span>
      <span className="absolute top-1.5 right-1.5">
        <Status status={s.status} stale={props.stale} />
      </span>
      {risk && (
        <span
          className={cn("absolute -top-1 -left-1 size-2.5 rounded-full ring-2 ring-background", risk.level === "danger" ? "bg-red-500" : "bg-amber-400")}
          title={risk.why}
          aria-label={`Worth a second look: ${risk.why}`}
        />
      )}
    </button>
  );
});

function Status({ status, stale }: { status?: Step["status"]; stale: boolean }) {
  if (status === "running" && !stale) return <Loader2 className="size-3 animate-spin text-sky-400" aria-label="in progress" />;
  if (status === "success") return <Check className="size-3 text-emerald-500" strokeWidth={3} aria-label="worked" />;
  if (status === "error") return <X className="size-3 text-red-500" strokeWidth={3} aria-label="didn't work" />;
  return null;
}

/** A small envelope that travels from the sender's lane to the receiver, so hand-offs are easy to see. */
function Envelope({ steps, id, row, actors, onDone }: { steps: Step[]; id: string; row: Record<string, number>; actors: Record<string, Actor>; onDone: () => void }) {
  const i = steps.findIndex((s) => s.id === id);
  const s = steps[i];
  if (!s?.from || row[s.from] === undefined) return null;
  const x = colX(i) + NODE_W / 2 - 13;
  const from = nodeY(row[s.from]) + NODE_H / 2 - 13;
  const to = nodeY(row[s.actor] ?? 0) + NODE_H / 2 - 13;
  return (
    <motion.div
      className="pointer-events-none absolute z-30 flex size-[26px] items-center justify-center rounded-full text-white shadow-lg"
      style={{ left: x, background: hueColor(actors[s.from]?.hue ?? 0) }}
      initial={{ top: from, opacity: 0, scale: 0.6 }}
      animate={{ top: [from, to, to], opacity: [1, 1, 0], scale: [1, 1, 0.6] }}
      transition={{ duration: 1.1, times: [0, 0.7, 1], ease: [0.32, 0.72, 0, 1] }}
      onAnimationComplete={onDone}
    >
      <Mail className="size-3.5" />
    </motion.div>
  );
}
