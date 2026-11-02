"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronRight, CircleCheck, CircleDashed, CircleDot } from "lucide-react";
import { ExportMenu } from "@/components/export-menu";
import { FilterBar } from "@/components/filter-bar";
import { StepIcon, hueColor } from "@/components/step-icon";
import { TermText } from "@/components/term-text";
import { VirtualList } from "@/components/virtual-list";
import { useMask } from "@/hooks/use-mask";
import { agentChat, agentTree, tasksOf, teamsOf, type AgentNode, type AgentTask } from "@/lib/analytics/agents";
import { emptyFilter, filterSteps, type StepFilter } from "@/lib/analytics/filters";
import { formatCount, sessionStory, storyOf } from "@/lib/analytics/story";
import { totalTokens, type Actor, type SessionModel, type Step } from "@/lib/session";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import type { SessionViewProps } from "./registry";

type Mask = (s: string) => string;
type Scope = "request" | "session";

const VIRTUAL_AT = 200;
const FIRST_CHILDREN = 40;

function duration(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 90 ? `${m} min` : `${(m / 60).toFixed(1)} h`;
}
const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

function Section({ title, intro, children }: { title: string; intro?: ReactNode; children?: ReactNode }) {
  return (
    <section className="mt-8">
      <h3 className="text-[0.9375rem] font-semibold tracking-tight">{title}</h3>
      {intro && <p className="mt-1 mb-3 text-[0.8125rem] leading-relaxed text-muted-foreground">{intro}</p>}
      {children}
    </section>
  );
}

const STATE: Record<Actor["state"], { label: string; cls: string } | null> = {
  working: { label: "Working", cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  done: { label: "Done", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  failed: { label: "Stopped early", cls: "bg-red-500/15 text-red-700 dark:text-red-300" },
  idle: null,
};

/** Agents (F1–F3, N7, N1): the story, who created whom, task board, teams and the chat between agents. */
export function AgentsView({ model, turn, selected, onSelect, onPickTurn }: SessionViewProps) {
  const [settings] = useSettings();
  const mask = useMask(model);
  const [tech, setTech] = useState(settings.showTechnical);
  const [scope, setScope] = useState<Scope>("request");
  const [filter, setFilter] = useState<StepFilter>(emptyFilter);

  const tree = useMemo(() => agentTree(model), [model]);
  const tasks = useMemo(() => tasksOf(model), [model]);
  const teams = useMemo(() => teamsOf(model), [model]);
  const chat = useMemo(() => agentChat(model, scope === "request" ? turn : undefined), [model, turn, scope]);
  const shownChat = useMemo(() => filterSteps(chat, filter), [chat, filter]);
  // The story masks log text before shortening it, so a cut can't split a secret.
  const story = useMemo(() => (scope === "request" ? storyOf(turn, model, mask) : sessionStory(model, mask)), [scope, turn, model, mask]);
  const turnOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of model.turns) for (const s of t.steps) m.set(s.id, t.index);
    return m;
  }, [model]);
  const scopedTasks = useMemo(() => (scope === "request" ? tasks.filter((t) => t.ts >= turn.ts && t.ts <= turn.end) : tasks), [scope, tasks, turn]);
  const helpers = Object.values(model.actors).filter((a) => a.kind === "helper").length;

  const openStep = (s: Step) => {
    const i = turnOf.get(s.id);
    if (i !== undefined && i !== turn.index) onPickTurn(i);
    onSelect({ type: "step", id: s.id });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[57.5rem] px-4 pt-5 pb-16 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 basis-[16.25rem]">
            <div className="text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">Agents</div>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">Who did the work</h2>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">
              <TermText text="Claude can hand parts of a job to [[helper:helpers]]. Here you can see who created whom, the to-do lists they kept and the messages they sent each other." />
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setTech(!tech)}
              aria-pressed={tech}
              className="h-8 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            >
              {tech ? "Hide" : "Show"} technical details
            </button>
            <ExportMenu model={model} turn={turn} />
          </div>
        </div>

        <div className="mt-4 inline-flex rounded-lg bg-foreground/[0.06] p-0.5 text-xs" role="tablist" aria-label="What to show">
          {(["request", "session"] as const).map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={scope === s}
              onClick={() => setScope(s)}
              className={cn("rounded-md px-3 py-1.5 transition-colors", scope === s ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {s === "request" ? `Request ${turn.index + 1}` : "Whole session"}
            </button>
          ))}
        </div>

        <div className="mt-4 rounded-xl bg-foreground/[0.05] px-4 py-3.5">
          <div className="text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">In short</div>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed">
            <TermText text={story} />
          </p>
        </div>

        <Section
          title="Who created whom"
          intro={
            helpers ? (
              "Claude (the lead) at the top, then each helper under whoever created it. Click a name to learn more about it."
            ) : (
              <TermText text="Claude did all the work itself in this session: it didn't create any [[helper:helpers]]." />
            )
          }
        >
          <TreeNode node={tree} depth={0} mask={mask} tech={tech} selectedId={selected?.type === "actor" ? selected.id : undefined} onPick={(id) => onSelect({ type: "actor", id })} />
        </Section>

        <Section
          title="To-do lists and tasks"
          intro={
            scopedTasks.length
              ? "The steps Claude and its helpers wrote down to keep track of the work, and how far each got."
              : `No to-do list in this ${scope === "request" ? "request" : "session"}. Claude writes one when a job has several steps.`
          }
        >
          {scopedTasks.length > 0 && <TaskBoard tasks={scopedTasks} mask={mask} />}
        </Section>

        {teams.length > 0 && (
          <Section title="Teams" intro="Helpers in a team work side by side and can message each other directly. Their messages are in the agent chat below.">
            <div className="grid gap-3 sm:grid-cols-2">
              {teams.map((t) => (
                <div key={t.name} className="min-w-0 rounded-xl border border-foreground/10 px-4 py-3">
                  <p className="text-[0.8125rem] font-semibold break-words">{mask(t.name)}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.members.length} member{t.members.length === 1 ? "" : "s"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {t.members.map((m) => (
                      <span key={m.name} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-foreground/[0.06] px-2.5 py-0.5 text-xs">
                        <span className="size-2 shrink-0 rounded-[3px]" style={{ background: m.colour ?? "currentColor" }} />
                        <span className="truncate">{mask(m.name)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section
          title="Agent chat"
          intro={
            chat.length ? (
              <TermText text="Every [[brief:brief]], message and [[report:report]] passed between the agents, read top to bottom like a group chat." />
            ) : (
              `The agents didn't pass any messages in this ${scope === "request" ? "request" : "session"}.`
            )
          }
        >
          {chat.length > 0 && (
            <>
              <FilterBar steps={chat} value={filter} onChange={setFilter} actors={model.actors} mask={mask} className="mb-3" />
              <Chat steps={shownChat} model={model} mask={mask} selectedId={selected?.type === "step" ? selected.id : undefined} onOpen={openStep} />
            </>
          )}
        </Section>
      </div>
    </div>
  );
}

function TreeNode({ node, depth, mask, tech, selectedId, onPick }: { node: AgentNode; depth: number; mask: Mask; tech: boolean; selectedId?: string; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(depth < 2);
  const [all, setAll] = useState(false);
  const a = node.actor;
  const state = a.kind === "helper" ? STATE[a.state] : null;
  const kids = all ? node.children : node.children.slice(0, FIRST_CHILDREN);
  const tokens = totalTokens(node.stats.usage);
  return (
    <div>
      <div className={cn("group flex items-start gap-1.5 rounded-lg py-1 pr-2", selectedId === a.id && "bg-foreground/[0.06]")}>
        {node.children.length ? (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} the helpers ${mask(a.name)} created`}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"
          >
            <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          </button>
        ) : (
          <span className="size-6 shrink-0" />
        )}
        <button type="button" onClick={() => onPick(a.id)} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 pt-0.5 text-left">
          <span className="flex min-w-0 items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: hueColor(a.hue) }} />
            <span className="truncate text-[0.8125rem] font-medium group-hover:underline">{mask(a.name)}</span>
          </span>
          {state && <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium", state.cls)}>{state.label}</span>}
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatCount(node.stats.steps)} step{node.stats.steps === 1 ? "" : "s"}
            {tokens ? ` · ${short(tokens)} tokens` : ""}
            {node.stats.durationMs >= 1000 ? ` · ${duration(node.stats.durationMs)}` : ""}
            {node.children.length ? ` · ${node.children.length} helper${node.children.length === 1 ? "" : "s"}` : ""}
          </span>
          {tech && (
            <span className="w-full truncate pl-[1.125rem] font-mono text-[0.6875rem] text-muted-foreground">
              {[a.role, a.model, a.kind === "helper" ? a.id : null].filter(Boolean).join(" · ")}
            </span>
          )}
        </button>
      </div>
      {open && node.children.length > 0 && (
        <div className="ml-3 border-l border-foreground/10 pl-2">
          {kids.length > VIRTUAL_AT ? (
            <VirtualList
              items={kids}
              getKey={(k) => k.actor.id}
              estimate={32}
              boxClassName="max-h-[60vh]"
              render={(k) => <TreeNode node={k} depth={depth + 1} mask={mask} tech={tech} selectedId={selectedId} onPick={onPick} />}
            />
          ) : (
            kids.map((k) => <TreeNode key={k.actor.id} node={k} depth={depth + 1} mask={mask} tech={tech} selectedId={selectedId} onPick={onPick} />)
          )}
          {node.children.length > kids.length && (
            <button type="button" onClick={() => setAll(true)} className="ml-7 py-1 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground">
              Show all {node.children.length} helpers
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const COLUMNS: { status: AgentTask["status"]; label: string; icon: ReactNode }[] = [
  { status: "pending", label: "To do", icon: <CircleDashed className="size-3.5" /> },
  { status: "in_progress", label: "In progress", icon: <CircleDot className="size-3.5 text-sky-500" /> },
  { status: "completed", label: "Done", icon: <CircleCheck className="size-3.5 text-emerald-500" /> },
];
const TASKS_SHOWN = 30;

function TaskBoard({ tasks, mask }: { tasks: AgentTask[]; mask: Mask }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {COLUMNS.map((c) => (
        <TaskColumn key={c.status} label={c.label} icon={c.icon} tasks={tasks.filter((t) => t.status === c.status)} mask={mask} />
      ))}
    </div>
  );
}

function TaskColumn({ label, icon, tasks, mask }: { label: string; icon: ReactNode; tasks: AgentTask[]; mask: Mask }) {
  const [all, setAll] = useState(false);
  const shown = all ? tasks : tasks.slice(0, TASKS_SHOWN);
  return (
    <div className="min-w-0 rounded-xl bg-foreground/[0.03] p-2">
      <p className="flex items-center gap-1.5 px-1.5 pt-0.5 pb-2 text-xs font-semibold">
        {icon}
        {label}
        <span className="font-normal text-muted-foreground tabular-nums">{tasks.length}</span>
      </p>
      {shown.length > VIRTUAL_AT ? (
        <VirtualList items={shown} getKey={(t) => t.id} estimate={64} boxClassName="max-h-[60vh]" render={(t) => <div className="pb-1.5"><TaskCard task={t} mask={mask} /></div>} />
      ) : (
        <ul className="space-y-1.5">
          {shown.map((t) => (
            <li key={t.id}>
              <TaskCard task={t} mask={mask} />
            </li>
          ))}
          {!tasks.length && <li className="px-1.5 pb-1 text-xs text-muted-foreground">Nothing here.</li>}
        </ul>
      )}
      {tasks.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="mt-2 px-1.5 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground">
          Show all {tasks.length}
        </button>
      )}
    </div>
  );
}

function TaskCard({ task: t, mask }: { task: AgentTask; mask: Mask }) {
  return (
    <div className="rounded-lg border border-foreground/10 bg-background/60 px-2.5 py-2">
      <p className={cn("text-[0.8125rem] leading-snug break-words", t.status === "completed" && "text-muted-foreground")}>{mask(t.title)}</p>
      <p className="mt-1 truncate text-[0.6875rem] text-muted-foreground">
        {mask(t.owner)} · {new Date(t.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </p>
    </div>
  );
}

const KIND_LABEL: Partial<Record<Step["kind"], string>> = { brief: "Brief", message: "Message", report: "Report", reply: "Answer" };

function ChatMessage({ step: s, model, mask, selected, onOpen }: { step: Step; model: SessionModel; mask: Mask; selected: boolean; onOpen: (s: Step) => void }) {
  const [open, setOpen] = useState(false);
  const from = model.actors[s.from ?? ""];
  const to = model.actors[s.actor];
  const text = typeof s.quote === "string" ? mask(s.quote) : "";
  const long = text.length > 360;
  return (
    <div className={cn("flex gap-2.5 rounded-xl px-2 py-2", selected && "bg-foreground/[0.06]")}>
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg" style={{ background: hueColor(from?.hue ?? 0, 0.16), color: hueColor(from?.hue ?? 0) }} aria-hidden>
        <StepIcon icon={s.icon} className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5 text-[0.8125rem]">
          <span className="max-w-[16rem] truncate font-semibold" style={{ color: hueColor(from?.hue ?? 0) }}>
            {mask(from?.name ?? "Someone")}
          </span>
          <span className="text-muted-foreground">→</span>
          <span className="max-w-[16rem] truncate font-medium">{mask(to?.name ?? "someone")}</span>
          <span className="text-xs text-muted-foreground">
            · {s.title === "Stopped early" ? "Stopped early" : KIND_LABEL[s.kind]} · {new Date(s.ts).toLocaleTimeString()}
          </span>
        </div>
        {text && (
          <div className="mt-1 rounded-xl bg-foreground/[0.05] px-3 py-2 text-[0.8125rem] leading-relaxed">
            <div className={cn("break-words whitespace-pre-wrap", long && !open && "line-clamp-6")}>{text}</div>
            {long && (
              <button type="button" onClick={() => setOpen(!open)} className="mt-1 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground">
                {open ? "Show less" : `Show all (${formatCount(text.length)} characters)`}
              </button>
            )}
          </div>
        )}
        <button type="button" onClick={() => onOpen(s)} className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          Explain this step
        </button>
      </div>
    </div>
  );
}

type ChatProps = { steps: Step[]; model: SessionModel; mask: Mask; selectedId?: string; onOpen: (s: Step) => void };

function Chat(props: ChatProps) {
  const { steps, model, mask, selectedId, onOpen } = props;
  if (!steps.length) return <p className="text-[0.8125rem] text-muted-foreground">No messages match these filters.</p>;
  if (steps.length > VIRTUAL_AT)
    return (
      <VirtualList
        items={steps}
        getKey={(s) => s.id}
        estimate={120}
        boxClassName="h-[70vh] rounded-xl border border-foreground/10"
        render={(s) => (
          <div className="px-1">
            <ChatMessage step={s} model={model} mask={mask} selected={s.id === selectedId} onOpen={onOpen} />
          </div>
        )}
      />
    );
  return (
    <div className="space-y-1">
      {steps.map((s) => (
        <ChatMessage key={s.id} step={s} model={model} mask={mask} selected={s.id === selectedId} onOpen={onOpen} />
      ))}
    </div>
  );
}

