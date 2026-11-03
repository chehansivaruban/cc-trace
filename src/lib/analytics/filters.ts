// Step filters (C2), shared by the Map, the Conversation and the Agents view. Groups combine with AND
// (a tool AND an agent); choices inside one group combine with OR (Read OR Grep). An empty group lets
// everything through. Text is a plain, case-insensitive substring, never a pattern.
import { DENIED, outputString, type Step } from "../session.ts";

export type StepCategory = "you" | "tools" | "helpers" | "errors" | "permissions" | "memory" | "connectors";
export type StepFilter = {
  categories: Set<StepCategory>;
  tools: Set<string>;
  commands: Set<string>;
  agents: Set<string>;
  text: string;
};

export const CATEGORIES: { id: StepCategory; label: string }[] = [
  { id: "you", label: "Your messages" },
  { id: "tools", label: "Tools" },
  { id: "helpers", label: "Helpers" },
  { id: "errors", label: "Errors" },
  { id: "permissions", label: "Permissions" },
  { id: "memory", label: "Memory" },
  { id: "connectors", label: "Connectors" },
];

export const emptyFilter = (): StepFilter => ({ categories: new Set(), tools: new Set(), commands: new Set(), agents: new Set(), text: "" });
export const isFilterEmpty = (f: StepFilter) => !f.categories.size && !f.tools.size && !f.commands.size && !f.agents.size && !f.text.trim();

const isHelper = (id?: string) => !!id && id !== "you" && id !== "lead";
const outputText = (s: Step) => (typeof s.output === "string" ? s.output : "");

export function stepCategories(s: Step): StepCategory[] {
  const out: StepCategory[] = [];
  if (s.actor === "you" || s.from === "you") out.push("you");
  if (s.kind === "tool") out.push("tools");
  if (isHelper(s.actor) || isHelper(s.from)) out.push("helpers");
  if (s.status === "error" || s.event === "api_error") out.push("errors");
  if (s.tool === "ExitPlanMode" || (s.kind === "tool" && DENIED.test(outputString(s.output).slice(0, 600)))) out.push("permissions");
  if (s.kind === "memory" || s.event === "compact") out.push("memory");
  if (s.tool?.startsWith("mcp__")) out.push("connectors");
  return out;
}

/** The program a terminal step ran: "git", "npm", "pytest"… (after any `cd …&&`, env settings or sudo). */
export function commandOf(s: Step): string | undefined {
  if (s.tool !== "Bash" && s.tool !== "PowerShell") return undefined;
  const cmd = (s.input as { command?: unknown } | undefined)?.command;
  if (typeof cmd !== "string") return undefined;
  const rest = cmd
    .replace(/^\s*cd\s+[^&;|]+(&&|;)\s*/, "")
    .replace(/^\s*(\w+=("[^"]*"|'[^']*'|\S*)\s+)+/, "")
    .replace(/^\s*(sudo|time|exec)\s+/, "");
  const word = rest.trim().split(/\s+/)[0]?.replace(/^["']|["']$/g, "");
  const name = word?.split(/[\\/]/).pop();
  return name && /^[\w.+-]+$/.test(name) ? name : undefined;
}

// Lower-cased searchable text per step, built once per step object.
const haystacks = new WeakMap<Step, string>();
function haystack(s: Step): string {
  let h = haystacks.get(s);
  if (h === undefined) {
    const cmd = (s.input as { command?: unknown } | undefined)?.command;
    h = [s.title, s.subtitle, typeof s.quote === "string" ? s.quote : "", s.tool ?? "", typeof cmd === "string" ? cmd : "", outputText(s).slice(0, 4000)].join("\n").toLowerCase();
    haystacks.set(s, h);
  }
  return h;
}

export function filterSteps(steps: Step[], f: StepFilter): Step[] {
  if (isFilterEmpty(f)) return steps;
  const text = f.text.trim().toLowerCase();
  return steps.filter((s) => {
    if (f.categories.size && !stepCategories(s).some((c) => f.categories.has(c))) return false;
    if (f.tools.size && !(s.tool && f.tools.has(s.tool))) return false;
    if (f.commands.size) {
      const c = commandOf(s);
      if (!c || !f.commands.has(c)) return false;
    }
    if (f.agents.size && !f.agents.has(s.actor) && !(s.from && f.agents.has(s.from))) return false;
    if (text && !haystack(s).includes(text)) return false;
    return true;
  });
}

export type FilterOptions = {
  categories: Record<StepCategory, number>;
  tools: { name: string; count: number }[];
  commands: { name: string; count: number }[];
  agents: { id: string; count: number }[];
};

/** What the filter bar can offer for these steps, with counts, most common first. */
export function filterOptions(steps: Step[]): FilterOptions {
  const categories = Object.fromEntries(CATEGORIES.map((c) => [c.id, 0])) as Record<StepCategory, number>;
  const tools = new Map<string, number>();
  const commands = new Map<string, number>();
  const agents = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const s of steps) {
    for (const c of stepCategories(s)) categories[c]++;
    if (s.tool) bump(tools, s.tool);
    const c = commandOf(s);
    if (c) bump(commands, c);
    bump(agents, s.actor);
    if (s.from && s.from !== s.actor) bump(agents, s.from);
  }
  const sorted = (m: Map<string, number>) => [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { categories, tools: sorted(tools), commands: sorted(commands), agents: sorted(agents).map(({ name, count }) => ({ id: name, count })) };
}
