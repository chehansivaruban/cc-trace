// Agents and teams (F1–F3, N7): who created whom, the to-do and task lists the agents kept,
// teams of agents, and the messages they passed. Pure functions over the session model.
/* eslint-disable @typescript-eslint/no-explicit-any -- tool inputs are untyped JSON */
import { addUsage, type Actor, type SessionModel, type Step, type Turn, type Usage } from "../session.ts";

export type AgentStats = { steps: number; usage: Usage; durationMs: number };
export type AgentNode = { actor: Actor; children: AgentNode[]; stats: AgentStats };

const zero = (): Usage => ({ fresh: 0, cached: 0, written: 0, input: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
const allSteps = (m: SessionModel): Step[] => m.turns.flatMap((t) => t.steps);

/**
 * Steps each agent took (its own tools and notes, plus the messages it sent) and how long it was involved:
 * its first to last step within each request, added up (the same time Stats shows), so the days between
 * requests don't count.
 */
export function agentStats(m: SessionModel): Map<string, AgentStats> {
  const out = new Map<string, AgentStats>();
  for (const a of Object.values(m.actors)) out.set(a.id, { steps: 0, usage: addUsage(zero(), a.usage ?? zero()), durationMs: 0 });
  for (const t of m.turns) {
    const span = new Map<string, [number, number]>();
    const touch = (id: string, ts: number) => {
      const s = span.get(id);
      if (!s) span.set(id, [ts, ts]);
      else {
        if (ts < s[0]) s[0] = ts;
        if (ts > s[1]) s[1] = ts;
      }
    };
    for (const s of t.steps) {
      if (s.kind === "memory") continue;
      const doer = s.from ?? s.actor;
      const st = out.get(doer);
      if (st) st.steps++;
      touch(doer, s.ts);
      if (s.from) touch(s.actor, s.ts); // a helper's work starts when it receives its brief
    }
    for (const [id, [a, b]] of span) {
      const st = out.get(id);
      if (st && b > a) st.durationMs += b - a;
    }
  }
  return out;
}

/** The lead at the root; each helper under whoever created it. Unknown parents fall back to the lead. */
export function agentTree(m: SessionModel): AgentNode {
  const stats = agentStats(m);
  const statOf = (id: string) => stats.get(id) ?? { steps: 0, usage: zero(), durationMs: 0 };
  const lead: Actor = m.actors.lead ?? { id: "lead", kind: "lead", name: "Claude", role: "the lead", hue: 28, state: "idle", firstTs: 0, usage: zero() };
  const helpers = Object.values(m.actors)
    .filter((a) => a.kind === "helper")
    .sort((a, b) => a.firstTs - b.firstTs);
  const kids = new Map<string, Actor[]>();
  for (const h of helpers) {
    const p = h.parent && h.parent !== h.id && m.actors[h.parent] && h.parent !== "you" ? h.parent : "lead";
    kids.set(p, [...(kids.get(p) ?? []), h]);
  }
  const seen = new Set<string>();
  const build = (a: Actor): AgentNode => {
    seen.add(a.id);
    const children: AgentNode[] = [];
    for (const k of kids.get(a.id) ?? []) if (!seen.has(k.id)) children.push(build(k));
    return { actor: a, children, stats: statOf(a.id) };
  };
  const root = build(lead);
  // Helpers caught in a parent loop are unreachable from the lead: hang them off the root.
  for (const h of helpers) if (!seen.has(h.id)) root.children.push(build(h));
  return root;
}

export type TaskStatus = "pending" | "in_progress" | "completed";
export type AgentTask = { id: string; title: string; status: TaskStatus; owner: string; ts: number };

function taskStatus(s: unknown): TaskStatus {
  const v = typeof s === "string" ? s.toLowerCase().replace(/[\s-]+/g, "_") : "";
  if (v === "completed" || v === "complete" || v === "done") return "completed";
  if (v === "in_progress" || v === "active" || v === "doing" || v === "started") return "in_progress";
  return "pending";
}
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const textOf = (v: unknown): string =>
  typeof v === "string" ? v : Array.isArray(v) ? v.map((b) => (typeof b?.text === "string" ? b.text : "")).join("\n") : "";
const isPlanTool = (name?: string) => name === "update_plan" || !!name?.endsWith("__update_plan");

/**
 * Tasks and to-dos the agents kept (TodoWrite, TaskCreate/TaskUpdate, update_plan), in the order they first
 * appeared. The latest status wins.
 */
export function tasksOf(m: SessionModel): AgentTask[] {
  const tasks = new Map<string, AgentTask>();
  const plans = new Map<string, string[]>(); // each agent's current plan, in order, for update_plan's advance/done/start
  const nameOf = (id: string) => m.actors[id]?.name ?? id;
  const set = (id: string, title: string, status: TaskStatus, owner: string, ts: number) => {
    const t = tasks.get(id);
    if (t) Object.assign(t, { title, status, ts: Math.max(t.ts, ts) });
    else tasks.set(id, { id, title, status, owner, ts });
  };
  // TodoWrite and update_plan send the whole list each time: unfinished items left out were dropped.
  const lists = new Map<string, string[]>();
  const replaceList = (list: string, keys: string[]) => {
    for (const k of lists.get(list) ?? []) if (!keys.includes(k) && tasks.get(k)?.status !== "completed") tasks.delete(k);
    lists.set(list, keys);
  };
  for (const s of allSteps(m)) {
    if (!s.tool || s.kind !== "tool") continue;
    const input = (s.input && typeof s.input === "object" ? s.input : {}) as any;
    const who = s.actor;
    if (s.tool === "TodoWrite") {
      if (!Array.isArray(input.todos)) continue;
      const keys: string[] = [];
      for (const td of input.todos) {
        const title = str(td?.content) ?? str(td?.activeForm);
        if (!title) continue;
        const key = `todo:${who}:${str(td?.id) ?? title}`;
        keys.push(key);
        set(key, title, taskStatus(td?.status), nameOf(who), s.ts);
      }
      replaceList(`todo:${who}`, keys);
    } else if (isPlanTool(s.tool)) {
      const items = Array.isArray(input.items) ? input.items : Array.isArray(input.plan) ? input.plan : null;
      if (items) {
        const keys: string[] = [];
        for (const it of items) {
          const title = str(it?.content) ?? str(it?.step);
          if (!title) continue;
          const key = `plan:${who}:${title}`;
          keys.push(key);
          set(key, title, taskStatus(it?.status), nameOf(who), s.ts);
        }
        plans.set(who, keys);
        replaceList(`plan:${who}`, keys);
        continue;
      }
      const keys = plans.get(who) ?? [];
      const mark = (i: number, status: TaskStatus) => {
        const t = Number.isInteger(i) ? tasks.get(keys[i] ?? "") : undefined;
        if (t) Object.assign(t, { status, ts: Math.max(t.ts, s.ts) });
      };
      if (input.advance === true) {
        const cur = keys.findIndex((k) => tasks.get(k)?.status === "in_progress");
        if (cur >= 0) mark(cur, "completed");
        const next = keys.findIndex((k, i) => i > cur && tasks.get(k)?.status === "pending");
        if (next >= 0) mark(next, "in_progress");
      }
      for (const d of Array.isArray(input.done) ? input.done : []) if (typeof d === "number") mark(d - 1, "completed");
      if (typeof input.start === "number") mark(input.start - 1, "in_progress");
    } else if (s.tool === "TaskCreate") {
      const title = str(input.subject) ?? str(input.description);
      if (!title) continue;
      const id = /#(\d+)/.exec(textOf(s.output))?.[1] ?? str((s.result as any)?.task?.id) ?? s.id;
      set(`task:${id}`, title, taskStatus(input.status), nameOf(who), s.ts);
    } else if (s.tool === "TaskUpdate") {
      const id = str(input.taskId) ?? (typeof input.taskId === "number" ? String(input.taskId) : undefined);
      if (!id) continue;
      const key = `task:${id}`;
      if (str(input.status) === "deleted") {
        tasks.delete(key);
        continue;
      }
      const t = tasks.get(key);
      const owner = str(input.owner);
      const title = str(input.subject) ?? t?.title ?? `Task ${id}`;
      set(key, title, input.status !== undefined ? taskStatus(input.status) : t?.status ?? "pending", nameOf(who), s.ts);
      if (owner) tasks.get(key)!.owner = nameOf(owner);
    }
  }
  return [...tasks.values()];
}

export type Team = { name: string; members: { name: string; colour?: string }[] };

/** Teams created with TeamCreate, and the agents started into them (Agent calls with a team name). */
export function teamsOf(m: SessionModel): Team[] {
  const teams = new Map<string, Team>();
  const team = (name: string) => {
    let t = teams.get(name);
    if (!t) teams.set(name, (t = { name, members: [] }));
    return t;
  };
  for (const s of allSteps(m)) {
    const input = (s.input && typeof s.input === "object" ? s.input : {}) as any;
    if (s.tool === "TeamCreate") {
      const name = str(input.team_name) ?? str(input.name);
      if (name) team(name);
    } else if (s.kind === "brief" && str(input.team_name)) {
      const a = m.actors[s.actor];
      const name = str(input.name) ?? a?.name ?? "teammate";
      const t = team(input.team_name.trim());
      if (t.members.some((x) => x.name === name)) continue;
      const recorded = str((s.result as any)?.color) ?? str(input.color);
      t.members.push({ name, colour: recorded ?? (a ? `oklch(0.68 0.15 ${a.hue})` : undefined) });
    }
  }
  return [...teams.values()];
}

const CHAT_KINDS = new Set<Step["kind"]>(["brief", "message", "report", "reply"]);

/** Briefs, messages, reports and replies between agents, in order: for one request, or the whole session. */
export function agentChat(m: SessionModel, turn?: Turn): Step[] {
  return (turn ? turn.steps : allSteps(m)).filter((s) => CHAT_KINDS.has(s.kind) && !!s.from);
}
