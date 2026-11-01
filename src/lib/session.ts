import { explainTool, type IconKey } from "./explain.ts";

/* eslint-disable @typescript-eslint/no-explicit-any -- log records are untyped JSON */
export type LogRecord = Record<string, any>;

/** "<agentId>.meta.json", written by Claude Code next to each sub-agent log. */
export type AgentMeta = { agentType?: string; description?: string; toolUseId?: string; model?: string; requestShape?: string };
export type AgentLog = { meta?: AgentMeta; records: LogRecord[] };

export type Usage = { fresh: number; cached: number; written: number };

export type ActorState = "working" | "done" | "failed" | "idle";
export type Actor = {
  id: string; // "you", "lead", or the sub-agent id
  kind: "you" | "lead" | "helper";
  name: string;
  role: string;
  hue: number; // colour on the map
  parent?: string; // who created this helper
  brief?: string;
  model?: string;
  state: ActorState;
  firstTs: number;
  usage: Usage;
};

export type StepKind = "prompt" | "memory" | "tool" | "brief" | "message" | "report" | "reply" | "note" | "stop";
// Kinds that pass something between two actors.
export const MESSAGE_KINDS: StepKind[] = ["prompt", "memory", "brief", "message", "report", "reply"];

export type Step = {
  id: string;
  kind: StepKind;
  actor: string; // the lane the step sits on (the receiver, for messages)
  from?: string; // the sender, for messages
  icon: IconKey;
  title: string;
  subtitle: string;
  doing: string;
  what: string;
  why: string;
  quote?: string;
  status?: "running" | "success" | "error";
  tool?: string;
  input?: unknown;
  output?: unknown;
  ts: number;
  seq: number;
  usage?: Usage; // the reply this step came from
  /** For "memory" steps: which earlier requests Claude still had in mind. */
  memory?: { from: number; to: number; summarized: boolean; tokens: number };
};

export type Turn = {
  index: number;
  text: string;
  ts: number;
  end: number;
  steps: Step[];
  actors: string[];
  usage: Usage;
  /** How much Claude had in its working memory when it started on this request (tokens). */
  context: number;
};

export type Live = { active: boolean; sentence: string; helpersWorking: number; thinking: boolean };

export type SessionModel = { actors: Record<string, Actor>; turns: Turn[]; live: Live; usage: Usage; stale: boolean };

// A session whose last write is older than this was interrupted or finished, not still working.
export const STALE_MS = 2 * 60_000;
// Title of the work logged before your first message (a continued or resumed session).
export const SESSION_START = "Work before your first message here";
// Spread around the colour wheel, away from You (220, blue) and Claude (28, orange).
const HUES = [152, 290, 95, 330, 180, 60, 305, 125, 255];
const AGENT_TOOLS = new Set(["Agent", "Task"]);

export function promptText(rec: LogRecord): string | undefined {
  const content = rec.message?.content;
  const texts: string[] =
    typeof content === "string"
      ? [content]
      : Array.isArray(content)
        ? content.filter((b) => b?.type === "text").map((b) => String(b.text))
        : [];
  // Claude Code injects context as tagged blocks (<ide_opened_file>, <system-reminder>, ...)
  const human = texts.filter((t) => !t.trimStart().startsWith("<")).join("\n").trim();
  return human || undefined;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.filter((b) => b?.type === "text").map((b) => b.text).join("\n");
  return "";
}

function resultContent(content: unknown): unknown {
  if (Array.isArray(content) && content.every((b) => b?.type === "text")) return content.map((b) => b.text).join("\n");
  return content;
}

const zero = (): Usage => ({ fresh: 0, cached: 0, written: 0 });
const add = (a: Usage, b: Usage) => {
  a.fresh += b.fresh;
  a.cached += b.cached;
  a.written += b.written;
};
export const totalTokens = (u: Usage) => u.fresh + u.cached + u.written;

function usageOf(u: any): Usage {
  return {
    fresh: (u?.input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0),
    cached: u?.cache_read_input_tokens ?? 0,
    written: u?.output_tokens ?? 0,
  };
}

function shortName(s: string) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 34 ? t.slice(0, 33) + "…" : t;
}

function helperRole(meta: AgentMeta | undefined, input: any) {
  const type = meta?.agentType ?? input?.subagent_type;
  const model = meta?.model ?? input?.model;
  const parts = ["helper", type && type !== "general-purpose" ? type : null, model].filter(Boolean);
  return parts.join(" · ");
}

export function buildSession(main: LogRecord[], agents: Record<string, AgentLog>, now = Date.now()): SessionModel {
  const actors: Record<string, Actor> = {
    you: { id: "you", kind: "you", name: "You", role: "the person asking", hue: 220, state: "idle", firstTs: 0, usage: zero() },
    lead: { id: "lead", kind: "lead", name: "Claude", role: "the lead", hue: 28, state: "idle", firstTs: 0, usage: zero() },
  };
  const logs: [string, LogRecord[]][] = [["lead", main], ...Object.entries(agents).map(([id, a]) => [id, a.records] as [string, LogRecord[]])];

  // Pass 1: who started which helper. Each Agent tool call is matched to a helper by the
  // helper's metadata, or by the "agentId: ..." line Claude Code puts in the tool result.
  const toolOwner = new Map<string, { actor: string; input: any; ts: number }>();
  const helperByCall = new Map<string, string>();
  for (const [actor, recs] of logs) {
    for (const rec of recs) {
      for (const b of Array.isArray(rec.message?.content) ? rec.message.content : []) {
        if (b?.type === "tool_use" && AGENT_TOOLS.has(b.name)) toolOwner.set(b.id, { actor, input: b.input, ts: Date.parse(rec.timestamp) || 0 });
        if (b?.type === "tool_result") {
          const m = /agentId: ([\w-]+)/.exec(textOf(b.content));
          if (m) helperByCall.set(b.tool_use_id, m[1]);
        }
      }
    }
  }
  for (const [id, a] of Object.entries(agents)) if (a.meta?.toolUseId) helperByCall.set(a.meta.toolUseId, id);
  const callByHelper = new Map([...helperByCall].map(([call, id]) => [id, call]));

  const helperIds = Object.keys(agents).sort(
    (a, b) => (Date.parse(agents[a].records[0]?.timestamp) || 0) - (Date.parse(agents[b].records[0]?.timestamp) || 0),
  );
  helperIds.forEach((id, i) => {
    const a = agents[id];
    const call = toolOwner.get(callByHelper.get(id) ?? "");
    const first = a.records.find((r) => r.type === "user");
    actors[id] = {
      id,
      kind: "helper",
      name: shortName(a.meta?.description ?? call?.input?.description ?? `Helper ${i + 1}`),
      role: helperRole(a.meta, call?.input),
      hue: HUES[i % HUES.length],
      parent: call?.actor ?? "lead",
      brief: call?.input?.prompt ?? (first ? textOf(first.message?.content) : undefined),
      model: a.meta?.model ?? call?.input?.model,
      state: "idle",
      firstTs: Date.parse(a.records[0]?.timestamp) || call?.ts || 0,
      usage: zero(),
    };
  });

  const steps: Step[] = [];
  const toolSteps = new Map<string, Step>();
  const usageByMsg = new Map<string, { actor: string; ts: number; usage: Usage; step?: Step }>();
  const failed = new Map<string, string>();
  const compactions: number[] = [];
  let seq = 0;
  const push = (s: Omit<Step, "seq" | "id"> & { id?: string }) => {
    const step = { ...s, id: s.id ?? `s${seq}`, seq: seq++ } as Step;
    steps.push(step);
    return step;
  };
  const nameOf = (id: string) => actors[id]?.name ?? "a helper";

  // Pass 2: each actor's own log becomes steps on its lane.
  for (const [actorId, recs] of logs) {
    const isLead = actorId === "lead";
    const actor = actors[actorId];
    let lastTs = 0;
    for (const rec of recs) {
      if (rec.type !== "user" && rec.type !== "assistant") continue;
      // Older Claude Code versions wrote helper records into the main log; we read helpers from their own logs.
      if (isLead && rec.isSidechain) continue;
      const ts = (lastTs = Date.parse(rec.timestamp) || lastTs);
      const content = rec.message?.content;

      if (rec.type === "user") {
        const results = Array.isArray(content) ? content.filter((b: any) => b?.type === "tool_result") : [];
        for (const r of results) {
          const step = toolSteps.get(r.tool_use_id);
          if (!step) continue;
          step.output = resultContent(r.content);
          if (step.kind === "tool" || step.status === "running") step.status = r.is_error ? "error" : "success";
          // Older helpers have no log of their own: their report only exists as this tool result.
          if (step.kind === "brief" && !agents[step.actor]) {
            const text = textOf(r.content);
            if (text && !/^Async agent launched/.test(text)) {
              push({ kind: "report", actor: step.from!, from: step.actor, icon: "report", title: "Reports back", subtitle: `${step.title.replace(/^Brief to /, "")} → ${nameOf(step.from!)}`,
                doing: `A helper is reporting back`, what: "The helper's final message:", quote: text, why: WHY_REPORT, ts });
            }
          }
        }
        if (results.length || !isLead || rec.isMeta) continue;

        const raw = textOf(content);
        if (rec.origin?.kind === "task-notification" || raw.trimStart().startsWith("<task-notification>")) {
          const status = /<status>(\w+)<\/status>/.exec(raw)?.[1];
          const id = /<task-id>([\w-]+)<\/task-id>/.exec(raw)?.[1];
          if (id && status && status !== "completed") failed.set(id, /<summary>([\s\S]*?)<\/summary>/.exec(raw)?.[1] ?? status);
          continue;
        }
        if (rec.isCompactSummary) {
          compactions.push(ts);
          push({ kind: "note", actor: "lead", icon: "note", title: "Tidies its memory", subtitle: "summarised the conversation", doing: "Claude is summarising the conversation",
            what: "The conversation got long, so Claude replaced it with a summary to free up its [[context:working memory]].",
            why: "Without this, Claude would run out of room and couldn't continue.", ts });
          continue;
        }
        const text = promptText(rec);
        if (!text) continue;
        if (text.startsWith("[Request interrupted")) {
          push({ kind: "stop", actor: "you", icon: "stop", title: "You stopped Claude", subtitle: "pressed Esc / Stop", doing: "You stopped Claude",
            what: "You interrupted Claude before it finished.", why: "Claude stops right away and waits for your next message.", ts });
          continue;
        }
        push({ kind: "prompt", actor: "you", icon: "prompt", title: "Your request", subtitle: `“${text.replace(/\s+/g, " ").slice(0, 48)}”`,
          doing: "You sent Claude a message", what: "You wrote:", quote: text,
          why: "Everything starts with your message. Claude reads it, decides how to handle it, and may bring in helpers.", ts });
        continue;
      }

      // assistant: Claude Code writes one record per content block, all sharing the reply's usage.
      const msgId = rec.message?.id ?? rec.uuid;
      const u = usageByMsg.get(msgId);
      if (rec.message?.usage) usageByMsg.set(msgId, { actor: actorId, ts: u?.ts ?? ts, usage: usageOf(rec.message.usage), step: u?.step });
      const final = rec.message?.stop_reason === "end_turn" || rec.message?.stop_reason === "stop_sequence";
      const made: Step[] = [];

      for (const block of Array.isArray(content) ? content : []) {
        if (block?.type === "text" && block.text?.trim()) {
          const text: string = block.text.trim();
          if (final && isLead) {
            made.push(push({ kind: "reply", actor: "you", from: "lead", icon: "reply", title: "Answers you", subtitle: "Claude → You", doing: "Claude answered you",
              what: "Claude's reply to you:", quote: text, why: "Claude sums up what happened, including the helpers' work. Click earlier steps to see what really went on.", ts }));
          } else if (final) {
            made.push(push({ kind: "report", actor: actor.parent ?? "lead", from: actorId, icon: "report", title: "Reports back", subtitle: `${actor.name} → ${nameOf(actor.parent ?? "lead")}`,
              doing: `${actor.name} is reporting back`, what: `${actor.name}'s [[report:report]]:`, quote: text, why: WHY_REPORT, ts }));
          } else {
            made.push(push({ kind: "note", actor: actorId, icon: "note", title: isLead ? "Tells you" : "Notes", subtitle: `“${text.replace(/\s+/g, " ").slice(0, 44)}”`,
              doing: `${actor.name} is explaining what it's doing`, what: isLead ? "Claude wrote this to you while working:" : `${actor.name} wrote this while working (only its lead sees it):`,
              quote: text, why: "Claude narrates its work in plain words between steps. These notes are often the easiest way to follow along.", ts }));
          }
          continue;
        }
        if (block?.type !== "tool_use") continue;
        const name: string = block.name;
        const input = block.input;

        if (AGENT_TOOLS.has(name)) {
          const helper = helperByCall.get(block.id) ?? `call:${block.id}`;
          if (!actors[helper]) {
            actors[helper] = { id: helper, kind: "helper", name: shortName(input?.description ?? "Helper"), role: helperRole(undefined, input),
              hue: HUES[(Object.keys(actors).length - 2) % HUES.length], parent: actorId, brief: input?.prompt, model: input?.model, state: "idle", firstTs: ts, usage: zero() };
          }
          const h = actors[helper];
          const step = push({ kind: "brief", actor: helper, from: actorId, icon: "brief", title: `Brief to ${h.name}`, subtitle: `${actor.name} → ${h.name}`,
            doing: `${actor.name} is handing work to a new helper, ${h.name}`,
            what: `${actor.name} created a [[helper:helper]]${input?.run_in_background ? " that works in the background" : ""} and gave it this [[brief:brief]]:`,
            quote: input?.prompt, why: "The helper starts with a blank memory, so the brief has to hold everything it needs. Splitting work this way keeps the lead's own memory free for the big picture.",
            status: "running", tool: name, input, ts, id: block.id });
          toolSteps.set(block.id, step);
          made.push(step);
          continue;
        }
        if (name === "SendMessage") {
          const to = resolveRecipient(input?.to, actorId, actors);
          const step = push(
            to
              ? { kind: "message", actor: to, from: actorId, icon: "message", title: `Message to ${nameOf(to)}`, subtitle: `${actor.name} → ${nameOf(to)}`,
                  doing: `${actor.name} is sending a message to ${nameOf(to)}`, what: `${actor.name} sent ${nameOf(to)} a message${input?.summary ? ` (“${input.summary}”)` : ""}:`,
                  quote: textOf(input?.message) || JSON.stringify(input?.message ?? ""),
                  why: to === "lead" || to === actor.parent ? "Helpers can check in with the agent that created them." : "A helper that already exists remembers its earlier work, so a short follow-up message is enough.",
                  status: "running", tool: name, input, ts, id: block.id }
              : { kind: "tool", actor: actorId, icon: "message", title: "Sends a message", subtitle: `to ${input?.to}`, doing: `${actor.name} is sending a message`,
                  what: `Sent a message to “${input?.to}”.`, quote: textOf(input?.message), why: "Agents can message each other while they work.", status: "running", tool: name, input, ts, id: block.id },
          );
          toolSteps.set(block.id, step);
          made.push(step);
          continue;
        }
        if (name === "SubagentHandback") {
          const to = actor.parent ?? "lead";
          const step = push({ kind: "report", actor: to, from: actorId, icon: "report", title: "Reports back", subtitle: `${actor.name} → ${nameOf(to)}`,
            doing: `${actor.name} is reporting back`, what: `${actor.name}'s [[report:report]]:`, quote: textOf(input?.message) || input?.message,
            why: WHY_REPORT, status: "running", tool: name, input, ts, id: block.id });
          toolSteps.set(block.id, step);
          made.push(step);
          continue;
        }
        if (name === "AskUserQuestion") {
          const qs = (input?.questions ?? []).map((q: any) => q?.question).filter(Boolean).join("\n");
          const step = push({ kind: "message", actor: "you", from: actorId, icon: "ask", title: "Asks you", subtitle: `${actor.name} → You`, doing: `${actor.name} is waiting for your answer`,
            what: "Claude needed a decision from you:", quote: qs, why: "Some choices are yours to make, so Claude stops and asks.", status: "running", tool: name, input, ts, id: block.id });
          toolSteps.set(block.id, step);
          made.push(step);
          continue;
        }
        const ex = explainTool(name, input, actor.name);
        const step = push({ kind: "tool", actor: actorId, ...ex, status: "running", tool: name, input, ts, id: block.id });
        toolSteps.set(block.id, step);
        made.push(step);
      }
      const entry = usageByMsg.get(msgId);
      if (entry && !entry.step && made[0]) entry.step = made[0];
    }
  }

  for (const { step, usage } of usageByMsg.values()) if (step) step.usage = usage;

  // Background helpers that stopped early only show up as a notification to the lead.
  for (const [id, summary] of failed) {
    const a = actors[id];
    if (!a) continue;
    const last = Math.max(...steps.filter((s) => s.actor === id || s.from === id).map((s) => s.ts), a.firstTs);
    push({ kind: "report", actor: a.parent ?? "lead", from: id, icon: "stop", title: "Stopped early", subtitle: `${a.name} → ${nameOf(a.parent ?? "lead")}`,
      doing: `${a.name} stopped early`, what: `${a.name} stopped before finishing:`, quote: summary,
      why: "Helpers can stop because of an error, a usage limit, or because they were cancelled. The lead decides what to do next.", status: "error", ts: last });
  }

  steps.sort((a, b) => a.ts - b.ts || a.seq - b.seq);

  // Live state: helpers are done once they report after their last incoming message.
  const lastTs = Math.max(0, ...steps.map((s) => s.ts));
  const stale = now - lastTs > STALE_MS;
  for (const a of Object.values(actors)) {
    if (a.kind !== "helper") continue;
    const incoming = steps.filter((s) => s.actor === a.id && s.from && s.kind !== "report");
    const lastIn = incoming.at(-1);
    const outgoing = steps.filter((s) => s.from === a.id && s.kind === "report");
    const lastOut = outgoing.at(-1);
    const own = steps.filter((s) => s.actor === a.id || s.from === a.id).at(-1);
    a.state = failed.has(a.id) ? "failed" : lastOut && (!lastIn || lastOut.ts >= lastIn.ts) ? "done" : own && now - own.ts < STALE_MS ? "working" : "idle";
  }
  for (const s of steps) {
    if (s.kind === "brief" || s.kind === "message") {
      const h = actors[s.actor];
      if (s.kind === "brief" && h?.kind === "helper") s.status = h.state === "failed" ? "error" : h.state === "done" ? "success" : h.state === "working" ? "running" : s.status === "running" ? "success" : s.status;
    }
    if (s.kind === "report" && s.status === "running") s.status = "success";
  }

  // Turns: each of your messages starts one; every step belongs to the turn it happened in.
  const prompts = steps.filter((s) => s.kind === "prompt");
  const turns: Turn[] = [];
  if (steps.length && (!prompts.length || steps[0].kind !== "prompt")) {
    turns.push({ index: 0, text: SESSION_START, ts: steps[0].ts, end: 0, steps: [], actors: [], usage: zero(), context: 0 });
  }
  for (const p of prompts) turns.push({ index: turns.length, text: p.quote ?? "", ts: p.ts, end: 0, steps: [], actors: [], usage: zero(), context: 0 });
  const turnAt = (ts: number) => {
    let i = 0;
    while (i + 1 < turns.length && turns[i + 1].ts <= ts) i++;
    return turns[i];
  };
  for (const s of steps) {
    // A prompt always opens its own turn, even when timestamps tie with the previous step.
    const t = s.kind === "prompt" ? turns.find((t) => t.ts === s.ts && !t.steps.some((x) => x.kind === "prompt")) ?? turnAt(s.ts) : turnAt(s.ts);
    t.steps.push(s);
  }
  const usage = zero();
  const firstLeadReply = new Map<Turn, number>();
  for (const { ts, actor, usage: u } of usageByMsg.values()) {
    add(usage, u);
    if (actors[actor]) add(actors[actor].usage, u);
    if (!turns.length) continue;
    const t = turnAt(ts);
    add(t.usage, u);
    // Everything Claude read before its first reply: instructions, the whole conversation so far and your new message.
    if (actor === "lead" && ts < (firstLeadReply.get(t) ?? Infinity)) {
      firstLeadReply.set(t, ts);
      t.context = u.fresh + u.cached;
    }
  }

  // Claude re-reads the whole conversation before every reply, so each request starts
  // with everything said earlier, back to the last time it summarised its memory.
  for (const t of turns) {
    if (t.index === 0 || t.steps[0]?.kind !== "prompt") continue;
    const lastCompact = compactions.filter((ts) => ts < t.ts).at(-1);
    const from = lastCompact === undefined ? 0 : turnAt(lastCompact).index;
    const summarized = lastCompact !== undefined;
    const n = t.index - from;
    const range = n === 1 ? `request ${from + 1}` : `requests ${from + 1}–${t.index}`;
    t.steps.splice(1, 0, {
      id: `memory-${t.index}`,
      seq: seq++,
      kind: "memory",
      actor: "lead",
      icon: "memory",
      title: "Remembers earlier",
      subtitle: summarized ? `a summary + ${range}` : `${range} + answers`,
      doing: "Claude reads your message together with everything said earlier",
      what: `Claude doesn't only see your new message. Before replying it re-reads the whole conversation so far: ${summarized ? `a summary of the older parts, then ${range}` : range}, its answers, and everything its tools showed it (files it read, command results).`,
      why: "That's how Claude can follow up on earlier work (“now add a test”) without you repeating yourself. It's also why long conversations use more [[tokens:tokens]]: the whole memory is re-read for every reply, mostly from [[cached:cache]]. [[helper:Helpers]] are different: they don't see any of this, only their [[brief:brief]].",
      ts: t.ts,
      memory: { from, to: t.index - 1, summarized, tokens: t.context },
    });
  }
  for (const t of turns) {
    t.end = t.steps.at(-1)?.ts ?? t.ts;
    const seen = new Set<string>(["you", "lead"]);
    for (const s of t.steps) {
      if (s.from) seen.add(s.from);
      seen.add(s.actor);
    }
    t.actors = [...seen].filter((id) => actors[id]);
  }

  return { actors, turns, live: liveState(main, steps, actors, stale), usage, stale };
}

const WHY_REPORT = "The lead never watches a helper work. This report is everything it learns about what the helper did.";

/** SendMessage's "to" is an agent id or a name; agents can also address the lead. */
function resolveRecipient(to: unknown, sender: string, actors: Record<string, Actor>): string | undefined {
  if (typeof to !== "string") return undefined;
  if (actors[to]) return to;
  if (/^(main|lead|team-lead|parent|leader)$/i.test(to)) return actors[sender]?.parent ?? "lead";
  const t = to.toLowerCase();
  return Object.values(actors).find((a) => a.kind === "helper" && a.name.toLowerCase() === t)?.id;
}

function liveState(main: LogRecord[], steps: Step[], actors: Record<string, Actor>, stale: boolean): Live {
  const helpersWorking = Object.values(actors).filter((a) => a.state === "working").length;
  if (stale) return { active: false, sentence: "Waiting for your next message", helpersWorking: 0, thinking: false };
  const running = steps.findLast((s) => s.status === "running" && s.kind === "tool");
  let lastRole: string | undefined;
  let lastStop: string | undefined;
  for (const rec of main) {
    if (rec.isSidechain || (rec.type !== "user" && rec.type !== "assistant") || rec.isMeta) continue;
    lastRole = rec.type;
    lastStop = rec.message?.stop_reason;
  }
  const thinking = !running && (lastRole === "user" || (lastRole === "assistant" && lastStop !== "end_turn" && lastStop !== "stop_sequence"));
  const helpers = helpersWorking ? ` · ${helpersWorking} helper${helpersWorking === 1 ? "" : "s"} working` : "";
  if (running) return { active: true, sentence: running.doing + helpers, helpersWorking, thinking: false };
  if (thinking) return { active: true, sentence: "Claude is thinking" + helpers, helpersWorking, thinking: true };
  if (helpersWorking) return { active: true, sentence: `${helpersWorking} helper${helpersWorking === 1 ? " is" : "s are"} working`, helpersWorking, thinking: false };
  return { active: false, sentence: "Waiting for your next message", helpersWorking: 0, thinking: false };
}
