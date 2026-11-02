"use client";

// Health (E1–E3, N3): how smoothly Claude worked, what went wrong and what it did next, risky actions and hooks.
import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CornerDownRight, Info, FileSearch, Files, Repeat, RotateCcw, SearchX, ShieldAlert, Undo2, Webhook, XCircle } from "lucide-react";
import { MapButton, Section, fmt, plural, useJump, useTechnical } from "@/components/view-kit";
import { useMask } from "@/hooks/use-mask";
import { VirtualList } from "@/components/virtual-list";
import { TermText } from "@/components/term-text";
import { StepIcon } from "@/components/step-icon";
import { FINDING_WEIGHT, healthReport, type Finding, type Recovery } from "@/lib/analytics/health";
import { hookRuns, type HookRun } from "@/lib/analytics/hooks";
import { permissionModeRisk, riskOf, type Risk } from "@/lib/analytics/risk";
import { explainTool } from "@/lib/explain";
import type { Step, Turn } from "@/lib/session";
import { cn } from "@/lib/utils";
import type { SessionViewProps } from "./registry";

type Scope = "request" | "session";

const FINDING_ICON: Record<Finding["kind"], typeof Repeat> = {
  "repeated-tool": Repeat,
  "fix-loop": RotateCcw,
  "empty-result": SearchX,
  "excessive-reads": FileSearch,
  "write-then-edit": Files,
  "high-error-rate": XCircle,
};

const NEXT: Record<Recovery, { label: string; icon: typeof Repeat; cls: string }> = {
  retried: { label: "Then Claude tried again", icon: Repeat, cls: "text-sky-600 dark:text-sky-300" },
  different: { label: "Then Claude tried another way", icon: CornerDownRight, cls: "text-emerald-600 dark:text-emerald-400" },
  "gave-up": { label: "Claude didn't try it again", icon: Undo2, cls: "text-muted-foreground" },
};

// "Good to know" is kept for the neutral notes section; risk badges never use it.
const RISK_STYLE: Record<Risk["level"], { label: string; cls: string; dot: string }> = {
  danger: { label: "Risky", cls: "bg-red-500/10 text-red-600 dark:text-red-300", dot: "bg-red-500" },
  caution: { label: "Take care", cls: "bg-amber-400/15 text-amber-700 dark:text-amber-300", dot: "bg-amber-400" },
};

const HOOK_WHEN: Record<string, string> = {
  SessionStart: "When a session starts",
  SessionEnd: "When a session ends",
  UserPromptSubmit: "When you send a message",
  PreToolUse: "Before Claude uses a tool",
  PostToolUse: "After Claude uses a tool",
  Stop: "When Claude finishes answering",
  SubagentStop: "When a helper finishes",
  Notification: "When Claude Code notifies you",
  PreCompact: "Before Claude tidies its memory",
};

export function HealthView(props: SessionViewProps) {
  const { model, turn } = props;
  const [scope, setScope] = useState<Scope>("request");
  const mask = useMask(model);
  const jump = useJump(props);
  const [tech, techToggle] = useTechnical();

  const turns = useMemo(() => (scope === "request" ? [turn] : model.turns), [scope, turn, model.turns]);
  const report = useMemo(() => healthReport(model, scope === "request" ? turn : undefined), [model, turn, scope]);
  // Weight-0 findings (a file built up in steps) are neutral notes, not problems.
  const stoodOut = useMemo(() => report.findings.filter((f) => FINDING_WEIGHT[f.kind] > 0), [report]);
  const notes = useMemo(() => report.findings.filter((f) => FINDING_WEIGHT[f.kind] === 0), [report]);
  const hooks = useMemo(() => hookRuns(model), [model]);
  const risks = useMemo(() => {
    const out: { step: Step; turn: number; risk: Risk }[] = [];
    for (const t of turns) for (const s of t.steps) {
      const risk = riskOf(s, { cwds: model.meta.cwds });
      if (risk) out.push({ step: s, turn: t.index, risk });
    }
    return out.sort((a, b) => (a.risk.level === b.risk.level ? 0 : a.risk.level === "danger" ? -1 : 1));
  }, [turns, model.meta.cwds]);
  const mode = permissionModeRisk(model.meta.permissionMode);
  // Where each step sits, to say which request it was in.
  const where = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of turns) for (const s of t.steps) m.set(s.id, t.index);
    return m;
  }, [turns]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-9 px-4 pt-5 pb-16 sm:px-6">
        <header>
          <p className="text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">Health</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">How smoothly did Claude work?</h2>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">
            Simple checks for steps that didn&apos;t work, effort that went round in circles and actions worth a second look. Everything is counted on your computer; no AI is used.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-lg border border-foreground/10 p-0.5 text-xs" role="tablist" aria-label="What to check">
              {(["request", "session"] as const).map((s) => (
                <button
                  key={s}
                  role="tab"
                  aria-selected={scope === s}
                  onClick={() => setScope(s)}
                  className={cn("rounded-md px-3 py-1.5 transition-colors", scope === s ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
                >
                  {s === "request" ? `Request ${turn.index + 1}` : `Whole session · ${plural(model.turns.length, "request")}`}
                </button>
              ))}
            </div>
            {techToggle}
          </div>
        </header>

        <ScoreCard score={report.score} findings={stoodOut.length} scope={scope} />

        <Section
          title="Steps that didn't work"
          intro={report.errors.items.length ? "A few of these are normal: Claude reads the error and adjusts. Click one to see what happened." : undefined}
        >
          {!report.errors.items.length ? (
            <Empty>Every step worked{scope === "request" ? " in this request" : ""}.</Empty>
          ) : (
            <>
              <p className="text-[0.8125rem]">
                <b className="tabular-nums">{fmt(report.errors.total)}</b> of {plural(report.errors.toolCalls, "tool step")} didn&apos;t work
                {report.errors.mostFailing && (
                  <span className="text-muted-foreground">
                    {" "}· most often “{explainTool(report.errors.mostFailing, {}, "Claude").title.toLowerCase()}”{tech && <> ({report.errors.mostFailing})</>}
                  </span>
                )}
                {report.errors.items.length > report.errors.total && (
                  <span className="text-muted-foreground"> · plus {plural(report.errors.items.length - report.errors.total, "other problem")}, like a failed request to Claude</span>
                )}
              </p>
              <ErrorStrip turns={turns} onPick={(t, id) => jump.select(t, id)} mask={mask} />
              <VirtualList
                className="mt-3 space-y-1"
                label="Steps that didn't work"
              initial={6}
                items={report.errors.items}
                estimate={60}
                render={({ step, next }) => {
                  const t = where.get(step.id) ?? turn.index;
                  const n = NEXT[next];
                  return (
                    <Row onClick={() => jump.select(t, step.id)} onMap={() => jump.toMap(t, step.id)}>
                      <StepIcon icon={step.icon} className="mt-0.5 size-3.5 shrink-0 text-red-500" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.8125rem] font-medium">
                          {mask(step.title)}
                          {step.subtitle && <span className="font-normal text-muted-foreground"> · {mask(step.subtitle)}</span>}
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          {scope === "session" && <span>Request {t + 1}</span>}
                          <span className={cn("inline-flex items-center gap-1", n.cls)}>
                            <n.icon className="size-3" /> {n.label}
                          </span>
                          {tech && step.tool && <code className="text-[0.6875rem]">{step.tool}</code>}
                        </span>
                      </span>
                    </Row>
                  );
                }}
              />
            </>
          )}
        </Section>

        <Section
          title="Things that stood out"
          intro={stoodOut.length ? "Patterns that often mean wasted effort. They're hints, not proof: open the steps to judge for yourself." : undefined}
        >
          {!stoodOut.length ? (
            <Empty>Nothing stood out: no loops, repeats or piles of errors.</Empty>
          ) : (
            <VirtualList
              className="space-y-2"
              label="Things that stood out"
              initial={5}
              items={stoodOut}
              estimate={120}
              render={(f) => <FindingCard finding={f} turn={model.turns[f.turn]} showTurn={scope === "session"} mask={mask} onPick={(id) => jump.select(f.turn, id)} onMap={(id) => jump.toMap(f.turn, id)} />}
            />
          )}
        </Section>

        {notes.length > 0 && (
          <Section title="Good to know" intro="Nothing wrong here, and it doesn't change the score: just notes to help you follow how the work took shape.">
            <VirtualList
              className="space-y-2"
              label="Good to know"
              initial={3}
              items={notes}
              estimate={110}
              render={(f) => <FindingCard neutral finding={f} turn={model.turns[f.turn]} showTurn={scope === "session"} mask={mask} onPick={(id) => jump.select(f.turn, id)} onMap={(id) => jump.toMap(f.turn, id)} />}
            />
          </Section>
        )}

        <Section title="Actions worth a second look" intro="Steps that delete things, install software, change files outside your project or skip safety checks. Most are fine; it's just good to know they happened.">
          {mode && (
            <div className="mb-3 flex gap-2.5 rounded-xl bg-red-500/10 px-3.5 py-3 text-[0.8125rem] leading-relaxed text-red-700 dark:text-red-300">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <span>{mode.why}</span>
            </div>
          )}
          {!risks.length ? (
            <Empty>Nothing risky{scope === "request" ? " in this request" : ""}.</Empty>
          ) : (
            <VirtualList
              className="space-y-1"
              label="Actions worth a second look"
              initial={6}
              items={risks}
              estimate={84}
              render={({ step, turn: t, risk }) => {
                const style = RISK_STYLE[risk.level];
                const cmd = (step.input as { command?: unknown })?.command;
                return (
                  <Row onClick={() => jump.select(t, step.id)} onMap={() => jump.toMap(t, step.id)}>
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", style.dot)} />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className={cn("shrink-0 rounded-full px-2 py-px text-[0.6875rem] font-medium", style.cls)}>{style.label}</span>
                        <span className="min-w-0 truncate text-[0.8125rem] font-medium">
                          {mask(step.title)}
                          {step.subtitle && <span className="font-normal text-muted-foreground"> · {mask(step.subtitle)}</span>}
                        </span>
                      </span>
                      <span className="mt-1 block text-[0.8125rem] leading-relaxed text-foreground/85">{risk.why}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {scope === "session" && <>Request {t + 1} · </>}
                        {model.actors[step.actor]?.name ?? "Claude"}
                      </span>
                      {tech && typeof cmd === "string" && (
                        <code className="mt-1.5 block max-h-24 overflow-hidden rounded-lg bg-foreground/[0.05] px-2.5 py-1.5 text-[0.6875rem] break-all whitespace-pre-wrap">{mask(cmd)}</code>
                      )}
                    </span>
                  </Row>
                );
              }}
            />
          )}
        </Section>

        <Hooks hooks={hooks} tech={tech} mask={mask} />
      </div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-foreground/15 px-3.5 py-3 text-[0.8125rem] text-muted-foreground">{children}</p>;
}

function Row({ onClick, onMap, children }: { onClick: () => void; onMap?: () => void; children: ReactNode }) {
  return (
    <div className="flex items-start gap-1 rounded-lg hover:bg-foreground/[0.05]">
      <button onClick={onClick} className="flex min-w-0 flex-1 items-start gap-2.5 px-2.5 py-2 text-left">
        {children}
      </button>
      {onMap && (
        <span className="pt-1.5 pr-1.5">
          <MapButton onClick={onMap} />
        </span>
      )}
    </div>
  );
}

/** The score as a ring, with what it means in one sentence. */
function ScoreCard({ score, findings, scope }: { score: number; findings: number; scope: Scope }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const tone = score >= 85 ? "text-emerald-500" : score >= 60 ? "text-amber-500" : "text-orange-500";
  const summary =
    score === 100 ? "Nothing stood out." : score >= 85 ? "Mostly smooth, with a thing or two worth a look." : score >= 60 ? "A few things worth a look." : "Claude seemed to struggle in places.";
  return (
    <div className="flex flex-col items-start gap-4 rounded-2xl border border-foreground/10 p-4 sm:flex-row sm:items-center">
      <div className="relative size-[5.5rem] shrink-0" role="img" aria-label={`Health score ${score} out of 100`}>
        <svg viewBox="0 0 88 88" className="size-full -rotate-90">
          <circle cx="44" cy="44" r={r} fill="none" stroke="currentColor" strokeWidth="8" className="text-foreground/10" />
          <circle
            cx="44"
            cy="44"
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - score / 100)}
            className={cn(tone, "transition-[stroke-dashoffset] duration-500")}
          />
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums">{score}</span>
          <span className="-mt-0.5 text-[0.625rem] text-muted-foreground">of 100</span>
        </span>
      </div>
      <div className="min-w-0">
        <p className="text-[0.9375rem] font-medium">
          {summary}{" "}
          {findings > 0 && <span className="font-normal text-muted-foreground">({plural(findings, "thing")} stood out{scope === "request" ? " in this request" : ""}.)</span>}
        </p>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">
          <TermText text="The [[healthScore:health score]] is a rough guide to how smoothly Claude worked, from simple checks like repeated steps, loops and errors: 100 means nothing stood out. It's not a grade of you or your request." />
        </p>
      </div>
    </div>
  );
}

/** Every step of the request(s) as a thin strip, with the ones that didn't work marked. Click a mark to open it. */
function ErrorStrip({ turns, onPick, mask }: { turns: Turn[]; onPick: (turn: number, id: string) => void; mask: (t: string) => string }) {
  const marks = useMemo(() => {
    const out: { x: number; turn: number; step: Step }[] = [];
    let i = 0;
    for (const t of turns) for (const s of t.steps) {
      if (s.status === "error") out.push({ x: i, turn: t.index, step: s });
      i++;
    }
    return { out, n: Math.max(1, i) };
  }, [turns]);
  const w = 1000;
  const bar = Math.max(4, w / marks.n);
  return (
    <div className="mt-3">
      <svg viewBox={`0 0 ${w} 20`} preserveAspectRatio="none" className="h-5 w-full" aria-label={`${marks.out.length} of ${marks.n} steps didn't work`} role="img">
        <rect x="0" y="6" width={w} height="8" rx="4" className="fill-foreground/[0.07]" />
        {marks.out.map((m) => (
          <rect
            key={m.step.id}
            x={Math.min(w - bar, (m.x / marks.n) * w)}
            y="2"
            width={bar}
            height="16"
            rx="1.5"
            className="cursor-pointer fill-red-500/80 hover:fill-red-500"
            onClick={() => onPick(m.turn, m.step.id)}
          >
            <title>{`${mask(m.step.title)} (click to open)`}</title>
          </rect>
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[0.625rem] text-muted-foreground">
        <span>start</span>
        <span>end</span>
      </div>
    </div>
  );
}

function FindingCard(props: { finding: Finding; neutral?: boolean; turn?: Turn; showTurn: boolean; mask: (t: string) => string; onPick: (id: string) => void; onMap: (id: string) => void }) {
  const { finding: f, turn } = props;
  const [all, setAll] = useState(false);
  const Icon = props.neutral ? Info : (FINDING_ICON[f.kind] ?? AlertTriangle);
  const index = useMemo(() => new Map(turn?.steps.map((s, i) => [s.id, i]) ?? []), [turn]);
  const ids = all ? f.steps : f.steps.slice(0, 8);
  return (
    <div className="rounded-xl border border-foreground/10 px-3.5 py-3">
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg",
            props.neutral ? "bg-sky-400/15 text-sky-600 dark:text-sky-300" : "bg-amber-400/15 text-amber-600 dark:text-amber-300",
          )}
        >
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.8125rem] font-semibold break-words">
            {props.mask(f.title)}
            {props.showTurn && <span className="font-normal text-muted-foreground"> · Request {f.turn + 1}</span>}
          </p>
          <p className="mt-0.5 text-[0.8125rem] leading-relaxed break-words text-foreground/85">{props.mask(f.explain)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {ids.map((id) => (
              <button key={id} onClick={() => props.onPick(id)} className="rounded-full border border-foreground/10 px-2 py-0.5 text-xs hover:bg-foreground/[0.06]">
                Step {(index.get(id) ?? -1) + 1}
              </button>
            ))}
            {f.steps.length > ids.length && (
              <button onClick={() => setAll(true)} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
                +{f.steps.length - ids.length} more
              </button>
            )}
            <span className="ml-auto">
              <MapButton onClick={() => props.onMap(f.steps[0])} label="Show the first of these on the map" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Hooks({ hooks, tech, mask }: { hooks: HookRun[]; tech: boolean; mask: (t: string) => string }) {
  const failed = hooks.reduce((n, h) => n + h.failed, 0);
  return (
    <Section
      title="Hooks"
      intro={<TermText text="[[hook:Hooks]] are small scripts you (or an add-on) set up to run at set moments. This lists every hook that ran in this session." />}
    >
      {!hooks.length ? (
        <Empty>No hooks ran in this session. They&apos;re optional, and most people don&apos;t have any.</Empty>
      ) : (
        <>
          {failed > 0 && (
            <p className="mb-2 flex items-start gap-1.5 text-[0.8125rem] leading-relaxed text-red-600 dark:text-red-300">
              <Webhook className="mt-0.5 size-3.5 shrink-0" /> {plural(failed, "hook run")} didn&apos;t work. Claude Code carried on, but whatever the hook was meant to do may not have happened.
            </p>
          )}
          <VirtualList className="divide-y divide-foreground/10 rounded-xl border border-foreground/10" label="Hooks" items={hooks} estimate={64} render={(h) => <HookRow hook={h} tech={tech} mask={mask} />} />
        </>
      )}
    </Section>
  );
}

function HookRow({ hook: h, tech, mask }: { hook: HookRun; tech: boolean; mask: (t: string) => string }) {
  const [open, setOpen] = useState(false);
  const times = h.samples.map((s) => s.durationMs).filter((d): d is number => d !== undefined);
  const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : undefined;
  const sample = h.samples.find((s) => s.stderr);
  return (
    <div className="px-3.5 py-2.5">
      <button onClick={() => setOpen(!open)} className="flex w-full items-start gap-3 text-left" aria-expanded={open}>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.8125rem] font-medium">{HOOK_WHEN[h.event] ?? h.event}</span>
          <code className="block truncate text-[0.6875rem] text-muted-foreground">{mask(h.name)}</code>
        </span>
        <span className="shrink-0 text-right text-xs">
          <span className="block tabular-nums">{plural(h.runs, "run")}</span>
          {h.failed > 0 ? <span className="block text-red-600 tabular-nums dark:text-red-300">{fmt(h.failed)} didn&apos;t work</span> : <span className="block text-muted-foreground">all worked</span>}
        </span>
      </button>
      {(open || tech) && (
        <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
          {avg !== undefined && <p>Usually takes {avg < 1000 ? `${Math.round(avg)} ms` : `${(avg / 1000).toFixed(1)} seconds`}.</p>}
          {sample?.stderr ? (
            <>
              <p>What it said{sample.exitCode !== undefined ? ` (exit code ${sample.exitCode})` : ""}:</p>
              <code className="block max-h-32 overflow-auto rounded-lg bg-foreground/[0.05] px-2.5 py-1.5 text-[0.6875rem] break-all whitespace-pre-wrap text-foreground/85">{mask(sample.stderr)}</code>
            </>
          ) : (
            <p>It didn&apos;t print any error messages.</p>
          )}
          {tech && (
            <p className="break-all">
              Event <code>{h.event}</code> · command <code>{mask(h.name)}</code>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
