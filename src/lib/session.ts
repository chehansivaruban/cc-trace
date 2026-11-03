import { explainTool, type IconKey } from "./explain.ts";
import { safeClip } from "./redact.ts";

/* eslint-disable @typescript-eslint/no-explicit-any -- log records are untyped JSON */
export type LogRecord = Record<string, any>;

/** "<agentId>.meta.json", written by Claude Code next to each sub-agent log. */
export type AgentMeta = { agentType?: string; description?: string; toolUseId?: string; model?: string; requestShape?: string };
export type AgentLog = { meta?: AgentMeta; records: LogRecord[] };

/**
 * Tokens of one reply (or a sum of replies). fresh = input + cacheWrite5m + cacheWrite1h (new to Claude),
 * cached = re-read from the cache, written = Claude's output.
 */
export type Usage = { fresh: number; cached: number; written: number; input: number; cacheWrite5m: number; cacheWrite1h: number };

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
  model?: string; // the model that wrote the reply this step came from
  durationMs?: number; // tools: from the call to its result
  thinking?: string; // the reply's recorded thinking (absent when hidden), on its first step
  result?: unknown; // tools: Claude Code's raw toolUseResult (e.g. structuredPatch for edits)
  images?: { mediaType: string; data: string }[]; // base64 images in your message or a tool result
  event?: "api_error" | "hook" | "interrupted" | "compact" | "recap";
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

export type SessionMeta = {
  customTitle?: string; // set with /rename
  aiTitle?: string;
  permissionMode?: string;
  gitBranch?: string;
  cwds: string[];
  version?: string; // Claude Code version
  entrypoint?: string; // cli, claude-vscode, claude-desktop, ...
  models: string[];
  firstTs: number;
  lastTs: number;
};

/** A system record or hook run, kept raw for the health and hook views. */
export type SessionEvent = { ts: number; actor: string; type: "system" | "hook"; subtype: string; data: Record<string, unknown> };

/** Tokens of a reply that shows no step (e.g. only thinking), with the model that wrote it. */
export type HiddenUsage = { turn: number; ts: number; actor: string; model?: string; usage: Usage };

export type SessionModel = {
  actors: Record<string, Actor>;
  turns: Turn[];
  live: Live;
  usage: Usage;
  stale: boolean;
  meta: SessionMeta;
  events: SessionEvent[];
  /** Replies with nothing to show still used tokens: these keep the per-model totals adding up. */
  hiddenUsage?: HiddenUsage[];
};

// What Claude Code writes as a tool's result when you (or your settings) said no to it.
export const DENIED = /doesn't want to proceed|tool use was rejected|user (?:rejected|denied)|permission (?:to use .* )?(?:was )?denied|was rejected by the user|requires approval/i;

/** A step's result as plain text (text blocks joined), for matching. */
export function outputString(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return output.map((b) => (typeof b?.text === "string" ? b.text : "")).join("\n");
  return "";
}

/** A step you said no to (a declined permission prompt): it "failed", but Claude didn't. */
export const isDenied = (s: Pick<Step, "status" | "output">): boolean => s.status === "error" && DENIED.test(outputString(s.output).slice(0, 600));

/** A step that went wrong on Claude's side: an error that isn't you saying no. */
export const isFailed = (s: Pick<Step, "status" | "output">): boolean => s.status === "error" && !isDenied(s);

/** "Tool calls", one definition for every view: every step that used a tool (helpers' briefs included). */
export const isToolCall = (s: Step): s is Step & { tool: string } => !!s.tool;

/** "Steps with errors", one definition for every view: failed steps, not counting declines or helper reports. */
export const isErrorStep = (s: Step): boolean => s.kind !== "report" && isFailed(s);

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

const zero = (): Usage => ({ fresh: 0, cached: 0, written: 0, input: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
export const addUsage = (a: Usage, b: Usage): Usage => ({
  fresh: a.fresh + b.fresh,
  cached: a.cached + b.cached,
  written: a.written + b.written,
  input: a.input + b.input,
  cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
  cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
});
export const totalTokens = (u: Usage) => u.fresh + u.cached + u.written;

const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
function usageOf(u: any): Usage {
  const input = num(u?.input_tokens);
  // Older logs only have the total cache write, which was always the 5-minute kind.
  const split = u?.cache_creation && typeof u.cache_creation === "object";
  let cacheWrite5m = split ? num(u.cache_creation.ephemeral_5m_input_tokens) : num(u?.cache_creation_input_tokens);
  const cacheWrite1h = split ? num(u.cache_creation.ephemeral_1h_input_tokens) : 0;
  // A split that sums to 0 next to a real total is an empty breakdown: trust the total.
  if (split && cacheWrite5m + cacheWrite1h === 0) cacheWrite5m = num(u?.cache_creation_input_tokens);
  return { fresh: input + cacheWrite5m + cacheWrite1h, cached: num(u?.cache_read_input_tokens), written: num(u?.output_tokens), input, cacheWrite5m, cacheWrite1h };
}

/** Base64 images in a message or tool result, ready for a data: URL. */
function imagesOf(content: unknown): Step["images"] {
  if (!Array.isArray(content)) return undefined;
  const images = content
    .filter((b) => b?.type === "image" && b.source?.type === "base64" && typeof b.source.data === "string")
    .map((b) => ({ mediaType: String(b.source.media_type ?? "image/png"), data: b.source.data as string }));
  return images.length ? images : undefined;
}

// Names and subtitles keep their whole text (the page shortens them on screen), so masking always sees whole
// words. Only very long text is cut, at a word boundary and with a visible "…".
const TEXT_MAX = 300;
const oneLine = (s: string) => safeClip(s.replace(/\s+/g, " ").trim(), TEXT_MAX);
const shortName = (s: string) => oneLine(String(s));

function helperRole(meta: AgentMeta | undefined, input: any) {
  const type = meta?.agentType ?? input?.subagent_type;
  const model = meta?.model ?? input?.model;
  const parts = ["helper", type && type !== "general-purpose" ? type : null, model].filter(Boolean);
  return parts.join(" · ");
}

export function buildSession(rawMain: LogRecord[], rawAgents: Record<string, AgentLog>, now = Date.now()): SessionModel {
  // A half-written or odd line can parse to null, a number or an array: skip it.
  const clean = (recs: unknown) => (Array.isArray(recs) ? recs.filter((r): r is LogRecord => !!r && typeof r === "object" && !Array.isArray(r)) : []);
  const main = clean(rawMain);
  const agents: Record<string, AgentLog> = {};
  for (const [id, a] of Object.entries(rawAgents ?? {})) agents[id] = { meta: a?.meta, records: clean(a?.records) };
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
  const usageByMsg = new Map<string, { actor: string; ts: number; usage: Usage; model?: string }>();
  // The first step of each reply carries its usage and thinking.
  const firstStep = new Map<string, Step>();
  const thinkingByMsg = new Map<string, string[]>();
  const events: SessionEvent[] = [];
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
    // Retries arrive as back-to-back api_error records: they share one step.
    let retryStep: Step | undefined;
    for (const [i, rec] of recs.entries()) {
      // Older Claude Code versions wrote helper records into the main log; we read helpers from their own logs.
      if (isLead && rec.isSidechain) continue;
      if (rec.type === "system" || (rec.type === "attachment" && /^hook_/.test(rec.attachment?.type ?? ""))) {
        const ts = (lastTs = Date.parse(rec.timestamp) || lastTs);
        const hook = rec.type === "attachment";
        events.push({ ts, actor: actorId, type: hook ? "hook" : "system", subtype: String((hook ? rec.attachment.type : rec.subtype) ?? "unknown"), data: hook ? rec.attachment : rec });
        if (rec.subtype === "api_error") {
          const err = rec.error?.formatted ?? rec.error?.message ?? "unknown error";
          const retry = rec.retryAttempt ? ` (try ${rec.retryAttempt}${rec.maxRetries ? ` of ${rec.maxRetries}` : ""})` : "";
          const fields = { title: "Request failed", subtitle: oneLine(String(err)) + (rec.retryAttempt ? ` · try ${rec.retryAttempt}${rec.maxRetries ? ` of ${rec.maxRetries}` : ""}` : ""),
            what: `Claude Code's request to Claude failed${retry}: “${err}”.`, ts };
          if (retryStep && seq === retryStep.seq + 1) Object.assign(retryStep, fields);
          else retryStep = push({ kind: "note", actor: actorId, icon: "stop", doing: "Claude Code is retrying a failed request", ...fields,
            why: "This happens with network problems, busy servers or usage limits. Claude Code retries on its own; it isn't something you did.",
            status: "error", event: "api_error" });
        }
        continue;
      }
      if (rec.type !== "user" && rec.type !== "assistant") continue;
      const ts = (lastTs = Date.parse(rec.timestamp) || lastTs);
      const content = rec.message?.content;

      if (rec.type === "user") {
        const results = Array.isArray(content) ? content.filter((b: any) => b?.type === "tool_result") : [];
        for (const r of results) {
          const step = toolSteps.get(r.tool_use_id);
          if (!step) continue;
          step.output = resultContent(r.content);
          if (ts >= step.ts && step.ts) step.durationMs = ts - step.ts;
          // One result per record is the norm; with several, toolUseResult belongs to the last.
          if (rec.toolUseResult !== undefined) step.result = rec.toolUseResult;
          const images = imagesOf(r.content);
          if (images) step.images = images;
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
            why: "Without this, Claude would run out of room and couldn't continue.", event: "compact", ts });
          continue;
        }
        const text = promptText(rec);
        if (!text) continue;
        if (text.startsWith("[Request interrupted")) {
          push({ kind: "stop", actor: "you", icon: "stop", title: "You stopped Claude", subtitle: "pressed Esc / Stop", doing: "You stopped Claude",
            what: "You interrupted Claude before it finished.", why: "Claude stops right away and waits for your next message.", event: "interrupted", ts });
          continue;
        }
        push({ kind: "prompt", actor: "you", icon: "prompt", title: "Your request", subtitle: `“${oneLine(text)}”`,
          doing: "You sent Claude a message", what: "You wrote:", quote: text,
          why: "Everything starts with your message. Claude reads it, decides how to handle it, and may bring in helpers.", images: imagesOf(content), ts });
        continue;
      }

      // assistant: Claude Code writes one record per content block, all sharing the reply's usage.
      const msgId: string = rec.message?.id ?? rec.uuid ?? `${actorId}#${i}`;
      const u = usageByMsg.get(msgId);
      const replyModel = typeof rec.message?.model === "string" && rec.message.model !== "<synthetic>" ? rec.message.model : undefined;
      if (rec.message?.usage) usageByMsg.set(msgId, { actor: actorId, ts: u?.ts ?? ts, usage: usageOf(rec.message.usage), model: replyModel ?? u?.model });
      const final = rec.message?.stop_reason === "end_turn" || rec.message?.stop_reason === "stop_sequence";
      const made: Step[] = [];

      for (const block of Array.isArray(content) ? content : []) {
        // Thinking is often hidden (recorded as ""): only keep what was actually written.
        if (block?.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()) {
          thinkingByMsg.set(msgId, [...(thinkingByMsg.get(msgId) ?? []), block.thinking.trim()]);
          continue;
        }
        if (block?.type === "text" && block.text?.trim()) {
          const text: string = block.text.trim();
          if (final && isLead) {
            made.push(push({ kind: "reply", actor: "you", from: "lead", icon: "reply", title: "Answers you", subtitle: "Claude → You", doing: "Claude answered you",
              what: "Claude's reply to you:", quote: text, why: "Claude sums up what happened, including the helpers' work. Click earlier steps to see what really went on.", ts }));
          } else if (final) {
            made.push(push({ kind: "report", actor: actor.parent ?? "lead", from: actorId, icon: "report", title: "Reports back", subtitle: `${actor.name} → ${nameOf(actor.parent ?? "lead")}`,
              doing: `${actor.name} is reporting back`, what: `${actor.name}'s [[report:report]]:`, quote: text, why: WHY_REPORT, ts }));
          } else {
            made.push(push({ kind: "note", actor: actorId, icon: "note", title: isLead ? "Tells you" : "Notes", subtitle: `“${oneLine(text)}”`,
              doing: `${actor.name} is explaining what it's doing`, what: isLead ? "Claude wrote this to you while working:" : `${actor.name} wrote this while working (only its lead sees it):`,
              quote: text, why: "Claude narrates its work in plain words between steps. These notes are often the easiest way to follow along.", ts }));
          }
          continue;
        }
        if (block?.type !== "tool_use" || typeof block.name !== "string") continue;
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
          const qs = (Array.isArray(input?.questions) ? input.questions : []).map((q: any) => q?.question).filter(Boolean).join("\n");
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
      for (const s of made) {
        if (replyModel) s.model = replyModel;
        // Claude Code writes errors (usage limits, failed requests) as fake "<synthetic>" replies.
        if (rec.isApiErrorMessage) {
          s.event = "api_error";
          s.status = "error";
        }
      }
      if (made[0] && !firstStep.has(msgId)) firstStep.set(msgId, made[0]);
    }
  }

  for (const [msgId, { usage }] of usageByMsg) {
    const step = firstStep.get(msgId);
    if (step) step.usage = usage;
  }
  for (const [msgId, parts] of thinkingByMsg) {
    const step = firstStep.get(msgId);
    if (step) step.thinking = parts.join("\n\n");
  }

  // Background helpers that stopped early only show up as a notification to the lead.
  const lastOfFailed = new Map<string, number>();
  if (failed.size) {
    for (const s of steps) {
      for (const id of [s.actor, s.from]) if (id && failed.has(id) && s.ts > (lastOfFailed.get(id) ?? -Infinity)) lastOfFailed.set(id, s.ts);
    }
  }
  for (const [id, summary] of failed) {
    const a = actors[id];
    if (!a) continue;
    const last = Math.max(lastOfFailed.get(id) ?? -Infinity, a.firstTs);
    push({ kind: "report", actor: a.parent ?? "lead", from: id, icon: "stop", title: "Stopped early", subtitle: `${a.name} → ${nameOf(a.parent ?? "lead")}`,
      doing: `${a.name} stopped early`, what: `${a.name} stopped before finishing:`, quote: summary,
      why: "Helpers can stop because of an error, a usage limit, or because they were cancelled. The lead decides what to do next.", status: "error", ts: last });
  }

  steps.sort((a, b) => a.ts - b.ts || a.seq - b.seq);

  // Live state: helpers are done once they report after their last incoming message.
  // One pass (no spreading into Math.max: huge arrays overflow the call stack).
  let lastTs = 0;
  type Seen = { lastIn?: Step; lastOut?: Step; own?: Step };
  const seenBy = new Map<string, Seen>();
  const seenOf = (id: string) => {
    let x = seenBy.get(id);
    if (!x) seenBy.set(id, (x = {}));
    return x;
  };
  for (const s of steps) {
    if (s.ts > lastTs) lastTs = s.ts;
    const lane = seenOf(s.actor);
    lane.own = s;
    if (s.from && s.kind !== "report") lane.lastIn = s;
    if (s.from) {
      const sender = seenOf(s.from);
      sender.own = s;
      if (s.kind === "report") sender.lastOut = s;
    }
  }
  const stale = now - lastTs > STALE_MS;
  for (const a of Object.values(actors)) {
    if (a.kind !== "helper") continue;
    const { lastIn, lastOut, own } = seenBy.get(a.id) ?? {};
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
  // Turns are in time order: the last one that started at or before `ts` (binary search), else the first.
  const turnAt = (ts: number) => {
    let lo = 0;
    let hi = turns.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (turns[mid].ts <= ts) lo = mid;
      else hi = mid - 1;
    }
    return turns[lo];
  };
  // A prompt always opens its own turn, even when timestamps tie with the previous step: the k-th prompt
  // is the k-th prompt turn.
  const promptOffset = turns.length - prompts.length;
  let promptNo = 0;
  for (const s of steps) {
    const t = s.kind === "prompt" ? turns[promptOffset + promptNo++] : turnAt(s.ts);
    t.steps.push(s);
  }
  const firstLeadReply = new Map<Turn, number>();
  const hiddenUsage: HiddenUsage[] = [];
  let usage = zero();
  for (const [msgId, { ts, actor, usage: u, model }] of usageByMsg) {
    usage = addUsage(usage, u);
    if (actors[actor]) actors[actor].usage = addUsage(actors[actor].usage, u);
    if (!turns.length) continue;
    const t = turnAt(ts);
    t.usage = addUsage(t.usage, u);
    if (!firstStep.has(msgId)) hiddenUsage.push({ turn: t.index, ts, actor, model, usage: u });
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

  events.sort((a, b) => a.ts - b.ts);
  return { actors, turns, live: liveState(main, steps, actors, stale), usage, stale, meta: sessionMeta(main, agents), events, hiddenUsage };
}

/** Titles, mode, branch, folders, versions and models, from the records that carry them. */
function sessionMeta(main: LogRecord[], agents: Record<string, AgentLog>): SessionMeta {
  const meta: SessionMeta = { cwds: [], models: [], firstTs: 0, lastTs: 0 };
  const cwds = new Set<string>();
  const models = new Set<string>();
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  for (const [lead, recs] of [[true, main], ...Object.values(agents).map((a) => [false, a.records])] as [boolean, LogRecord[]][]) {
    for (const rec of recs) {
      if (lead && rec.isSidechain) continue;
      const ts = Date.parse(rec.timestamp);
      if (ts) {
        if (!meta.firstTs || ts < meta.firstTs) meta.firstTs = ts;
        if (ts > meta.lastTs) meta.lastTs = ts;
      }
      if (str(rec.cwd)) cwds.add(rec.cwd);
      const model = str(rec.message?.model);
      if (rec.type === "assistant" && model && model !== "<synthetic>") models.add(model);
      if (!lead) continue;
      // The latest value wins: titles can be renamed, the mode and branch can change mid-session.
      if (rec.type === "custom-title") meta.customTitle = str(rec.customTitle) ?? meta.customTitle;
      if (rec.type === "ai-title") meta.aiTitle = str(rec.aiTitle) ?? meta.aiTitle;
      // The mode is on your messages ("default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions").
      // "mode" records only say "normal" (a different setting), so they're ignored.
      meta.permissionMode = str(rec.permissionMode) ?? meta.permissionMode;
      meta.gitBranch = str(rec.gitBranch) ?? meta.gitBranch;
      meta.version = str(rec.version) ?? meta.version;
      meta.entrypoint = str(rec.entrypoint) ?? meta.entrypoint;
    }
  }
  meta.cwds = [...cwds];
  meta.models = [...models];
  return meta;
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
