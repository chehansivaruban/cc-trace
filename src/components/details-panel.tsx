"use client";

import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Brain, ChevronRight, X } from "lucide-react";
import { formatDuration } from "@/lib/conversation";
import { ERROR_NOTE } from "@/lib/explain";
import { useMask } from "@/hooks/use-mask";
import { useSettings } from "@/lib/settings";
import { SESSION_START, totalTokens, type Actor, type Step, type Turn, type Usage } from "@/lib/session";
import { cn } from "@/lib/utils";
import { StepIcon, hueColor } from "./step-icon";
import type { Selection } from "./story-map";
import { Term, TermText } from "./term-text";
import { ToolRenderer } from "./tools";
import { BookmarkButton } from "./bookmark-button";
import { fmt } from "@/components/view-kit";
import { maskClip } from "@/lib/redact";
import { appear } from "@/lib/motion";
import { useReducedMotion } from "./settings-provider";

const EDITS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

function duration(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} second${s === 1 ? "" : "s"}`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} minute${m === 1 ? "" : "s"}`;
  return `${(m / 60).toFixed(1)} hours`;
}

export function DetailsPanel(props: {
  turn?: Turn;
  turns: Turn[];
  onPickTurn: (i: number) => void;
  onShowSession: () => void;
  actors: Record<string, Actor>;
  selected: Selection;
  onSelect: (s: Selection) => void;
  onHelp: () => void;
  onClose?: () => void;
  /** The session log, so a step can be bookmarked. */
  file?: string;
}) {
  const { turn, actors, selected } = props;
  const step = selected?.type === "step" ? turn?.steps.find((s) => s.id === selected.id) : undefined;
  const actor = selected?.type === "actor" ? actors[selected.id] : undefined;
  const key = step ? step.id : actor ? actor.id : `turn-${turn?.index}`;
  const reduce = useReducedMotion();

  return (
    <aside className="relative flex h-full min-h-0 flex-col" aria-label="Explanation">
      {props.onClose && (
        <button onClick={props.onClose} className="absolute top-3 right-3 z-10 rounded-full p-1.5 text-muted-foreground hover:bg-foreground/10" aria-label="Close">
          <X className="size-4" />
        </button>
      )}
      {selected && (
        <button onClick={() => props.onSelect(null)} className="flex items-center gap-1 px-5 pt-4 text-left text-xs text-muted-foreground hover:text-foreground">
          ← Summary of this request
        </button>
      )}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={key}
          {...appear(reduce, { y: 6 }, { duration: 0.18 })}
          className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-8"
        >
          {step && turn ? (
            <StepCard step={step} file={props.file} turnIndex={turn.index} index={turn.steps.indexOf(step)} total={turn.steps.length} actors={actors} onSelect={props.onSelect} turns={props.turns} onPickTurn={props.onPickTurn} onShowSession={props.onShowSession} />
          ) : actor && turn ? (
            <ActorCard actor={actor} turn={turn} actors={actors} onSelect={props.onSelect} />
          ) : turn ? (
            <TurnSummary turn={turn} turns={props.turns} actors={actors} onSelect={props.onSelect} onPickTurn={props.onPickTurn} onHelp={props.onHelp} />
          ) : (
            <p className="text-sm text-muted-foreground">Pick a request to see what happened.</p>
          )}
        </motion.div>
      </AnimatePresence>
    </aside>
  );
}

function Kicker({ children }: { children: ReactNode }) {
  return <div className="text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">{children}</div>;
}
function H({ children }: { children: ReactNode }) {
  return <h3 className="mt-5 mb-1.5 text-[0.8125rem] font-semibold">{children}</h3>;
}
function Chip({ actor, onClick }: { actor?: Actor; onClick?: () => void }) {
  const mask = useMask();
  if (!actor) return null;
  return (
    <button onClick={onClick} className="inline-flex max-w-[9.375rem] items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold text-white" style={{ background: hueColor(actor.hue) }}>
      <span className="truncate">{mask(actor.name)}</span>
    </button>
  );
}

/** Long text (briefs, reports) collapses to a few lines with a "show all" toggle. */
function Quote({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const mask = useMask();
  const long = text.length > 420;
  return (
    <div className="mt-2 rounded-xl bg-foreground/[0.05] px-3.5 py-3 text-[0.8125rem] leading-relaxed">
      <div className={cn("break-words whitespace-pre-wrap", long && !open && "line-clamp-[8]")}>{mask(text)}</div>
      {long && (
        <button onClick={() => setOpen(!open)} className="mt-2 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground">
          {open ? "Show less" : `Show all (${fmt(text.length)} characters)`}
        </button>
      )}
    </div>
  );
}

function TokenBreakdown({ usage, title }: { usage: Usage; title: string }) {
  const total = totalTokens(usage);
  if (!total) return null;
  const parts = [
    { label: "re-read (cached)", term: "cached" as const, value: usage.cached, cls: "bg-sky-400/50" },
    { label: "new to Claude", value: usage.fresh, cls: "bg-violet-400" },
    { label: "written by Claude", value: usage.written, cls: "bg-amber-400" },
  ];
  return (
    <>
      <H>{title}</H>
      <p className="text-[0.8125rem]">
        <span className="text-lg font-semibold tabular-nums">{fmt(total)}</span> <Term k="tokens">tokens</Term> processed
      </p>
      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-foreground/10">
        {parts.map((p) => (
          <div key={p.label} className={p.cls} style={{ width: `${(p.value / total) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2">
            <span className={cn("size-2 rounded-full", p.cls)} />
            <span className="tabular-nums text-foreground">{fmt(p.value)}</span> {p.term ? <Term k={p.term}>{p.label}</Term> : p.label}
          </li>
        ))}
      </ul>
    </>
  );
}

function TurnSummary(props: {
  turn: Turn;
  turns: Turn[];
  actors: Record<string, Actor>;
  onSelect: (s: Selection) => void;
  onPickTurn: (i: number) => void;
  onHelp: () => void;
}) {
  const { turn, actors, onSelect, onHelp } = props;
  const mask = useMask();
  const s = turn.steps;
  const helpers = turn.actors.filter((id) => actors[id]?.kind === "helper");
  const messages = s.filter((x) => x.kind === "brief" || x.kind === "message" || x.kind === "report").length;
  const own = s.filter((x) => x.actor === "lead" && x.kind === "tool").length;
  const helperSteps = s.filter((x) => x.kind === "tool" && actors[x.actor]?.kind === "helper").length;
  const files = (pred: (x: Step) => boolean) =>
    [...new Set(s.filter(pred).map((x) => String((x.input as { file_path?: string })?.file_path ?? "").split(/[\\/]/).pop()).filter(Boolean))];
  const read = files((x) => x.tool === "Read");
  const changed = files((x) => EDITS.has(x.tool ?? ""));
  const tests = s.filter((x) => x.icon === "test");
  const failedTests = tests.filter((x) => x.status === "error").length;
  const errors = s.filter((x) => x.status === "error").length;
  const reply = s.findLast((x) => x.kind === "reply");

  const memory = s.find((x) => x.kind === "memory")?.memory;
  const facts: ReactNode[] = [
    memory ? (
      <>
        Claude went into this with{" "}
        <button onClick={() => onSelect({ type: "step", id: `memory-${turn.index}` })} className="font-medium underline underline-offset-2">
          {memory.summarized ? "a summary plus " : ""}
          {memory.to === memory.from ? `request ${memory.from + 1}` : `requests ${memory.from + 1}–${memory.to + 1}`}
        </button>{" "}
        still in its <Term k="context">memory</Term>.
      </>
    ) : null,
    own ? <>Claude took <b>{own}</b> step{own === 1 ? "" : "s"} itself.</> : null,
    helpers.length ? (
      <>
        Claude brought in <b>{helpers.length}</b> <Term k="helper">helper{helpers.length === 1 ? "" : "s"}</Term>, who took {helperSteps} step{helperSteps === 1 ? "" : "s"} between them.
      </>
    ) : null,
    messages ? <>The agents passed <b>{messages}</b> message{messages === 1 ? "" : "s"} between them.</> : null,
    read.length ? <>Read <b>{read.length}</b> <Term k="file">file{read.length === 1 ? "" : "s"}</Term>.</> : null,
    changed.length ? <>Changed or created <b>{changed.length}</b> file{changed.length === 1 ? "" : "s"}: {mask(changed.slice(0, 6).join(", "))}{changed.length > 6 ? ` and ${changed.length - 6} more` : ""}.</> : null,
    tests.length ? <>Ran the <Term k="tests">tests</Term> {tests.length} time{tests.length === 1 ? "" : "s"}{failedTests ? `; ${failedTests} run${failedTests === 1 ? "" : "s"} found problems` : ", all passing"}.</> : null,
    errors ? <>{errors} step{errors === 1 ? "" : "s"} didn&apos;t work the first time. That&apos;s normal: Claude reads the error and tries again.</> : null,
    turn.end > turn.ts ? <>Took about {duration(turn.end - turn.ts)}.</> : null,
  ].filter(Boolean);

  return (
    <>
      <Kicker>Request {turn.index + 1}</Kicker>
      <h2 className="mt-1 text-lg font-semibold tracking-tight">What happened</h2>
      {turn.text !== SESSION_START && (
        <>
          <H>You asked</H>
          <Quote text={turn.text} />
        </>
      )}
      <H>In plain words</H>
      <ul className="space-y-1.5 text-[0.8125rem] leading-relaxed">
        {facts.map((f, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[0.4375rem] size-1.5 shrink-0 rounded-full bg-foreground/40" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      {reply?.quote && (
        <>
          <H>Claude&apos;s answer</H>
          <Quote text={reply.quote} />
        </>
      )}
      <H>Who took part</H>
      <div className="space-y-1">
        {turn.actors.map((id) => {
          const a = actors[id];
          const n = s.filter((x) => x.actor === id && !x.from).length + s.filter((x) => x.from === id).length;
          return (
            <button key={id} onClick={() => onSelect({ type: "actor", id })} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[0.8125rem] hover:bg-foreground/[0.06]">
              <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: hueColor(a.hue) }} />
              <span className="min-w-0 flex-1 truncate font-medium">{mask(a.name)}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{n} step{n === 1 ? "" : "s"}</span>
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          );
        })}
      </div>
      <TokenBreakdown usage={turn.usage} title="Effort for this request" />
      <MemoryChart turns={props.turns} current={turn.index} onPick={props.onPickTurn} />
      <p className="mt-6 rounded-xl border border-foreground/10 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
        Press <b className="text-foreground">Replay</b> to watch this request step by step, or click any box on the map. New to this?{" "}
        <button onClick={onHelp} className="font-medium text-foreground underline underline-offset-2">
          How Claude Code works
        </button>
      </p>
    </>
  );
}

function StepCard(props: {
  step: Step;
  file?: string;
  turnIndex: number;
  index: number;
  total: number;
  actors: Record<string, Actor>;
  onSelect: (s: Selection) => void;
  turns: Turn[];
  onPickTurn: (i: number) => void;
  onShowSession: () => void;
}) {
  const { step: s, index, total, actors, onSelect } = props;
  const [settings] = useSettings();
  const mask = useMask();
  const [techPick, setTech] = useState<boolean | null>(null);
  const tech = techPick ?? settings.showTechnical;
  const [thinking, setThinking] = useState(false);
  const lane = actors[s.actor];
  const from = s.from ? actors[s.from] : undefined;
  const hue = (from ?? lane)?.hue ?? 0;
  return (
    <>
      <div className={cn("flex items-center justify-between gap-2", props.file && "-my-1.5")}>
        <Kicker>
          Step {index + 1} of {total}
          {from ? " · a message" : ""}
        </Kicker>
        {props.file && <BookmarkButton file={props.file} step={s.id} turn={props.turnIndex} label={s.title} showLabel className="shrink-0" />}
      </div>
      <h2 className="mt-1.5 flex items-center gap-2.5 text-lg font-semibold tracking-tight">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg" style={{ background: hueColor(hue, 0.16), color: hueColor(hue) }}>
          <StepIcon icon={s.icon} className="size-4" />
        </span>
        <span className="line-clamp-2 min-w-0 break-words">{mask(s.title)}</span>
      </h2>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {from ? (
          <>
            <Chip actor={from} onClick={() => onSelect({ type: "actor", id: from.id })} /> sent to
            <Chip actor={lane} onClick={() => onSelect({ type: "actor", id: lane.id })} />
          </>
        ) : (
          <>
            <Chip actor={lane} onClick={() => onSelect({ type: "actor", id: lane.id })} /> did this
          </>
        )}
        <span>· {new Date(s.ts).toLocaleTimeString()}</span>
        {s.durationMs !== undefined && <span>· took {formatDuration(s.durationMs)}</span>}
      </div>

      <H>What happened</H>
      <p className="text-[0.8125rem] leading-relaxed">
        <TermText text={mask(s.what)} />
      </p>
      {typeof s.quote === "string" && s.quote && <Quote text={s.quote} />}
      {s.memory && <Remembered memory={s.memory} turns={props.turns} onPickTurn={props.onPickTurn} />}
      {s.memory && (
        <button onClick={props.onShowSession} className="mt-3 flex items-center gap-1 text-xs font-medium underline underline-offset-2">
          See how all your requests connect <ChevronRight className="size-3.5" />
        </button>
      )}
      {s.status === "error" && <p className="mt-3 rounded-xl bg-red-500/10 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-red-600 dark:text-red-300">{ERROR_NOTE}</p>}
      {s.status === "running" && <p className="mt-3 text-[0.8125rem] text-sky-600 dark:text-sky-300">Still in progress…</p>}

      <H>Why</H>
      <p className="text-[0.8125rem] leading-relaxed text-foreground/85">
        <TermText text={mask(s.why)} />
      </p>

      {s.usage && (
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          The reply this step came from used <span className="text-foreground tabular-nums">{fmt(totalTokens(s.usage))}</span> <Term k="tokens">tokens</Term>
          {s.usage.cached ? <>, {fmt(s.usage.cached)} of them <Term k="cached">re-read from cache</Term></> : null}.
        </p>
      )}
      {s.thinking ? (
        <>
          <button onClick={() => setThinking(!thinking)} className="mt-3 flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" aria-expanded={thinking}>
            <ChevronRight className={cn("size-3.5 transition-transform", thinking && "rotate-90")} />
            <Brain className="size-3.5" /> Claude&apos;s thinking before this · {fmt(s.thinking.length)} characters
          </button>
          {thinking && <div className="mt-2 rounded-xl bg-foreground/[0.04] px-3.5 py-3 text-[0.75rem] leading-relaxed break-words whitespace-pre-wrap text-foreground/75 italic">{mask(s.thinking)}</div>}
        </>
      ) : s.usage ? (
        <p className="mt-2 text-xs text-muted-foreground">Claude&apos;s thinking for this reply wasn&apos;t recorded.</p>
      ) : null}

      {(s.input !== undefined || s.output !== undefined || !!s.images?.length) && (
        <>
          <button onClick={() => setTech(!tech)} className="mt-5 flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
            <ChevronRight className={cn("size-3.5 transition-transform", tech && "rotate-90")} />
            {tech ? "Hide" : "Show"} the technical details
          </button>
          {tech && (
            <div className="mt-3 space-y-3">
              {s.tool && <p className="text-xs text-muted-foreground">Tool: <code className="text-foreground">{s.tool}</code>{s.model ? <> · model <code className="text-foreground">{s.model}</code></> : null}</p>}
              <ToolRenderer step={s} />
            </div>
          )}
        </>
      )}
    </>
  );
}

const ABOUT = {
  you: "This is you. Everything starts with your message, and each request ends when Claude answers you.",
  lead: "The main Claude you're chatting with: the [[lead:lead]]. It plans the work, does some of it itself, and hands bigger pieces to helpers.",
  helper:
    "A [[helper:helper]] the lead created for one job. It started knowing nothing except its [[brief:brief]]: it can't see your earlier requests or the rest of the conversation. It worked on its own, then sent back a [[report:report]]. The lead only sees that report, not every step.",
};

function ActorCard({ actor: a, turn, actors, onSelect }: { actor: Actor; turn: Turn; actors: Record<string, Actor>; onSelect: (s: Selection) => void }) {
  const own = turn.steps.filter((s) => s.actor === a.id && !s.from && s.kind !== "prompt").length;
  const sent = turn.steps.filter((s) => s.from === a.id).length;
  const got = turn.steps.filter((s) => s.from && s.actor === a.id).length;
  const parent = a.parent ? actors[a.parent] : undefined;
  const kids = Object.values(actors).filter((x) => x.parent === a.id && x.kind === "helper");
  const state = { working: "Working right now", done: "Finished and reported back", failed: "Stopped before finishing", idle: "" }[a.state];
  const mask = useMask();
  return (
    <>
      <Kicker>Who&apos;s who</Kicker>
      <h2 className="mt-1.5 flex items-center gap-2.5 text-lg font-semibold tracking-tight">
        <span className="size-3 shrink-0 rounded" style={{ background: hueColor(a.hue) }} />
        <span className="line-clamp-2 min-w-0 break-words">{mask(a.name)}</span>
      </h2>
      <p className="text-xs text-muted-foreground">{mask(a.role)}</p>
      <p className="mt-3 text-[0.8125rem] leading-relaxed">
        <TermText text={ABOUT[a.kind]} />
      </p>
      {state && <p className="mt-2 text-[0.8125rem] font-medium">{state}.</p>}
      {parent && (
        <p className="mt-2 text-[0.8125rem] text-muted-foreground">
          Created by <Chip actor={parent} onClick={() => onSelect({ type: "actor", id: parent.id })} />
        </p>
      )}
      {kids.length > 0 && (
        <>
          <H>Helpers it created</H>
          <div className="flex flex-wrap gap-1.5">
            {kids.map((k) => (
              <Chip key={k.id} actor={k} onClick={() => onSelect({ type: "actor", id: k.id })} />
            ))}
          </div>
        </>
      )}
      <H>In this request</H>
      <p className="text-[0.8125rem]">
        {own} step{own === 1 ? "" : "s"} of its own · sent {sent} message{sent === 1 ? "" : "s"} · received {got}
      </p>
      {a.model && (
        <p className="mt-2 text-[0.8125rem]">
          <Term k="model">Model</Term>: {a.model}
        </p>
      )}
      {a.brief && (
        <>
          <H>Its brief</H>
          <Quote text={a.brief} />
        </>
      )}
      {a.kind !== "you" && <TokenBreakdown usage={a.usage} title="Effort across the whole session" />}
    </>
  );
}

const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const MAX_LISTED = 12;

/** The earlier requests a "Remembers earlier" step carried over, each with Claude's answer. */
function Remembered({ memory, turns, onPickTurn }: { memory: NonNullable<Step["memory"]>; turns: Turn[]; onPickTurn: (i: number) => void }) {
  const mask = useMask();
  const all = turns.slice(memory.from, memory.to + 1);
  const shown = all.slice(-MAX_LISTED);
  return (
    <>
      <H>What Claude still had in mind</H>
      {memory.tokens > 0 && (
        <p className="mb-2 text-xs text-muted-foreground">
          About <span className="text-foreground tabular-nums">{fmt(memory.tokens)}</span> <Term k="tokens">tokens</Term> of memory when it started on this request.
        </p>
      )}
      <ol className="space-y-1">
        {memory.summarized && (
          <li className="rounded-lg bg-foreground/[0.04] px-2.5 py-2 text-xs text-muted-foreground">
            A summary of everything before request {memory.from + 1}. The details were let go to make room.
          </li>
        )}
        {all.length > shown.length && <li className="px-2.5 text-xs text-muted-foreground">…and {all.length - shown.length} earlier requests</li>}
        {shown.map((t) => {
          const reply = t.steps.findLast((x) => x.kind === "reply")?.quote;
          return (
            <li key={t.index}>
              <button onClick={() => onPickTurn(t.index)} className="w-full rounded-lg px-2.5 py-2 text-left hover:bg-foreground/[0.06]">
                <span className="line-clamp-1 text-[0.8125rem]">
                  <span className="mr-1.5 text-xs text-muted-foreground">#{t.index + 1}</span>
                  {maskClip(t.text, 300, mask)}
                </span>
                {typeof reply === "string" && reply && <span className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">Claude: {maskClip(reply, 300, mask)}</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </>
  );
}

/** Memory size at the start of each request: grows as the conversation does, drops when Claude summarises. */
function MemoryChart({ turns, current, onPick }: { turns: Turn[]; current: number; onPick: (i: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const known = turns.filter((t) => t.context > 0);
  if (known.length < 2) return null;
  const max = Math.max(...known.map((t) => t.context));
  const focus = turns[hover ?? current];
  return (
    <>
      <H>Claude&apos;s memory over this session</H>
      <p className="mb-2 h-4 truncate text-xs text-muted-foreground" aria-live="polite">
        {focus?.context ? (
          <>
            <span className="text-foreground">Request {focus.index + 1}</span> started with <span className="text-foreground tabular-nums">{fmt(focus.context)}</span> tokens in memory
          </>
        ) : (
          `Request ${(focus?.index ?? 0) + 1}: no reply from Claude to measure`
        )}
      </p>
      <div className="relative">
        <span className="absolute -top-0.5 left-0 text-[0.625rem] text-muted-foreground tabular-nums">{short(max)}</span>
        <div className="flex h-24 items-end gap-[2px] border-b border-foreground/15 pt-3" role="img" aria-label={`Memory size per request, from ${short(known[0].context)} to ${short(known.at(-1)!.context)} tokens`}>
          {turns.map((t) => (
            <button
              key={t.index}
              onClick={() => onPick(t.index)}
              onMouseEnter={() => setHover(t.index)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(t.index)}
              onBlur={() => setHover(null)}
              className="group flex h-full min-w-[3px] flex-1 items-end"
              aria-label={`Request ${t.index + 1}: ${t.context ? `${fmt(t.context)} tokens` : "not measured"}`}
            >
              {t.context > 0 && (
                <span
                  className={cn(
                    "w-full rounded-t-[4px] transition-colors",
                    t.index === current ? "bg-foreground" : t.index === hover ? "bg-foreground/50" : "bg-foreground/25",
                  )}
                  style={{ height: `${Math.max(4, (t.context / max) * 100)}%` }}
                />
              )}
            </button>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[0.625rem] text-muted-foreground">
          <span>#1</span>
          <span>#{turns.length}</span>
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Before every reply Claude re-reads everything in its <Term k="context">memory</Term>, so a bigger memory means more <Term k="tokens">tokens</Term> per reply. A drop means Claude
        summarised older parts to make room. Click a bar to open that request.
      </p>
    </>
  );
}
