/* eslint-disable @typescript-eslint/no-explicit-any -- tool inputs are untyped JSON */

// Plain-English explanations of what Claude Code's tools do, for people who have never coded.
// Text may contain [[term:label]] markers; the UI turns them into hover explanations from GLOSSARY.
import { safeClip } from "./redact.ts";

export const GLOSSARY = {
  lead: "The main Claude you're chatting with. It plans the work, does some itself, and hands bigger pieces to helpers, like a team lead.",
  helper:
    "A helper (also called a sub-agent) is a separate copy of Claude that the lead creates for one job. It starts with an empty memory and only knows what it was told in its brief.",
  brief: "The message the lead sends when it creates a helper. It's everything the helper knows about the job, so it has to be detailed.",
  report: "The helper's final message back. The lead never watches a helper work: this report is all it learns.",
  tool: "An action Claude can take on your computer, like reading a file, running a command or searching the web. Each box on the map is one tool use.",
  tokens:
    "Tokens are how Claude measures text, about ¾ of a word each. Usage limits are counted in tokens. cc-trace itself uses none.",
  cached:
    "Before every reply Claude re-reads the whole conversation so far. Most of that is cached (remembered from last time), which is much quicker to process than new text and counts for less against usage limits.",
  context:
    "Claude's working memory for this conversation: your requests, its answers and what its tools showed it, all re-read before every reply. It has a size limit; when it fills up Claude summarises older parts. Each helper has its own, separate memory.",
  file: "Your project is made of files, like documents in a folder. Code files hold the instructions that make your app work.",
  command: "A typed instruction to your computer, like “run the tests” or “list the files”. Claude uses the terminal, the text-based way to control a computer.",
  tests: "Small programs that check your app still does what it should. Passing tests are a good sign nothing broke.",
  git: "Git keeps a history of every saved version of your project, so changes can be reviewed or undone. A commit is one saved checkpoint.",
  connector: "An add-on (also called an MCP server) that lets Claude use another app or service, like a browser, a database or your calendar.",
  skill: "A saved set of instructions Claude can load for a particular kind of job, like a recipe card.",
  model: "Which version of Claude did the work. Bigger models are more capable; smaller ones are faster and use up your limits more slowly.",
  // Finding and opening sessions
  session:
    "One conversation with Claude Code, from when you open it until you close it or start fresh. Claude Code saves each one as a log file on your computer.",
  live: "Claude Code has this session open right now, so new steps appear here as they happen.",
  resume:
    "Opening an old session again in Claude Code so you can carry on where you left off. Claude re-reads the whole conversation first.",
  fork: "Starting a new session that begins with a copy of an old conversation. The original stays as it was.",
  sessionId: "The unique name Claude Code gives each session. It's also the log file's name.",
  worktree:
    "A second working copy of the same project, often used so Claude can work on something without touching your main copy. cc-trace lists it under the main project.",
  branch: "A named line of work in a project that uses git (a tool that keeps the history of changes). “main” is usually the main one.",
  permissionMode:
    "How freely Claude may act: ask before every change, edit files without asking, only plan, or skip all safety prompts.",
  logFile: "The file Claude Code writes as you work: every message, step and result, one line each. cc-trace only reads it.",
  // Reading a request
  thinking:
    "Before some replies Claude reasons privately, like scribbling notes before answering. Claude Code only sometimes saves these notes in the log; newer versions usually hide them.",
  diff: "A before-and-after view of a change: removed lines in red, added lines in green.",
  exitCode: "The number a command reports when it ends. 0 means it worked; anything else means something went wrong.",
  task: "A to-do item Claude or a helper wrote down to keep track of the work, with its status: waiting, being worked on, or done.",
  team: "A group of helpers that work side by side on one job and can message each other directly, with the lead coordinating.",
  // Understanding a session
  cacheHit:
    "The share of what Claude read that came from its cache (remembered from the reply before) instead of being new. Higher is better: cached text is quicker to process and counts for less against usage limits.",
  window:
    "The most text Claude can keep in its working memory at once. It depends on the model: usually 200,000 tokens, or 1,000,000 for models with the large memory.",
  compact:
    "/compact is a command you can type in Claude Code. Claude replaces the conversation so far with a short summary, freeing memory while keeping the gist.",
  clear: "/clear is a command you can type in Claude Code. It starts a fresh conversation with an empty memory: best when you move on to something unrelated.",
  written: "Tokens Claude wrote itself: its answers, its notes, the commands it ran and the text of files it created or changed.",
  hook: "A hook is a small script you (or an add-on you installed) set up to run automatically at certain moments, like when a session starts or after Claude changes a file.",
  healthScore:
    "A rough guide from 0 to 100, worked out on your computer by counting things like repeated steps, loops and errors. 100 means nothing stood out. It isn't a grade of you or your request.",
  fixLoop: "When Claude runs the same thing, it fails, Claude tries a fix, and it fails again, over and over. A hint from you often breaks the loop.",
  phase: "A stretch of a request where Claude was mostly doing one kind of thing: looking around, changing files, testing, checking its work or answering you.",
  bypassPermissions: "A mode where Claude Code never stops to ask before running commands or changing files. Handy for experiments, risky for real projects.",
  permission:
    "Before Claude runs a command or changes a file, Claude Code can stop and ask you to allow it. Your permission mode decides how often it asks.",
  debuglog:
    "A detailed diary Claude Code writes about its own inner workings: settings it loaded, requests it made, errors it hit. It's only saved when Claude Code is started with “claude --debug”.",
  // Sharing and keeping
  story: "A short summary cc-trace writes from the log itself (no AI): what you asked, what Claude did, who helped and how it ended.",
  export: "A copy of what you're looking at, saved as a file you can open without cc-trace or share with someone. It's made in your browser.",
  bookmark: "A shortcut you saved to a session or a step. Bookmarks, tags and names you give sessions stay in this browser only.",
} as const;

export type TermKey = keyof typeof GLOSSARY;

export type IconKey =
  | "prompt" | "read" | "edit" | "create" | "search" | "terminal" | "test" | "save" | "upload" | "install"
  | "web" | "browser" | "todo" | "brief" | "report" | "message" | "reply" | "ask" | "plan" | "skill"
  | "tool" | "note" | "stop" | "plug" | "wait" | "memory";

export type Explained = {
  icon: IconKey;
  /** Short box label: "Reads a file". */
  title: string;
  /** Second line of the box: usually the file, command or search. */
  subtitle: string;
  /** Present tense, with the actor's name: "Builder is reading auth.dart". */
  doing: string;
  /** Plain-English description for the details panel. */
  what: string;
  why: string;
};

const base = (p: unknown) => (typeof p === "string" ? p.split(/[\\/]/).filter(Boolean).pop() ?? p : "");
// Whole words only, with a generous cap: the page shortens these on screen, and masking has to see each
// secret whole (a key cut in half no longer looks like a key).
const clip = (s: unknown) => safeClip(typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "", 300);
const lines = (s: unknown) => (typeof s === "string" && s ? s.split("\n").length : 0);

/** "mcp__claude-in-chrome__navigate" -> ["claude in chrome", "navigate"] */
function mcpParts(name: string) {
  const [, server = "", ...rest] = name.split("__");
  return [server.replace(/^plugin_[^_]+_/, "").replace(/[_-]+/g, " ").trim(), rest.join("__")];
}

const TEST_RUNNERS =
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(flutter|dart|go|cargo|swift|deno|dotnet|mvn)\s+test\b|\b(pytest|jest|vitest|mocha|rspec|phpunit|playwright\s+test)\b|\bpython3?\s+-m\s+(pytest|unittest)\b|\bgradlew?\s+test\b/;

function bash(input: any, who: string): Explained {
  const cmd: string = typeof input?.command === "string" ? input.command : "";
  const desc = clip(input?.description);
  const sub = desc || clip(cmd);
  // Most commands start with "cd somewhere &&": classify by what follows.
  const primary = cmd.replace(/^\s*cd\s+[^&;]+(&&|;)\s*/, "");
  const kinds: [RegExp, IconKey, string, string, string][] = [
    [/\bgit\s+commit\b/, "save", "Saves a checkpoint", "saving a checkpoint",
      "Claude saved the changes as a [[git:commit]], a checkpoint in the project's history that can be undone later."],
    [/\bgit\s+push\b|\bgh\s+pr\s+create\b/, "upload", "Uploads the changes", "uploading the changes",
      "Claude sent the saved changes to an online copy of the project, such as GitHub."],
    [TEST_RUNNERS, "test", "Runs the tests", "running the tests",
      "Claude ran your project's [[tests:tests]] to check that everything still works."],
    [/\b(npm|pnpm|yarn|bun|pip3?|brew|cargo|gem|flutter\s+pub)\s+(i|install|add|get)\b/, "install", "Installs software", "installing software",
      "Claude downloaded software packages (ready-made building blocks) that the project needs."],
    [/\b(npm|pnpm|yarn|bun)\s+(run\s+)?build\b|\b(flutter|next|cargo|go|swift|dotnet)\s+build\b|\btsc\b|\bxcodebuild\b|\bgradlew?\s+assemble/, "terminal", "Builds the project", "building the project",
      "Claude turned the code into a runnable app, which also catches many mistakes."],
  ];
  const starts: [RegExp, IconKey, string, string, string][] = [
    [/^git\s+(status|diff|log|show|branch)\b/, "search", "Checks the change history", "checking what changed",
      "Claude looked at the project's [[git:history]] to see what has changed."],
    [/^(curl|wget)\b/, "web", "Contacts a website", "contacting a website", "Claude fetched something from the internet with a [[command:command]]."],
  ];
  const match = kinds.find(([re]) => re.test(cmd)) ?? starts.find(([re]) => re.test(primary));
  if (match) {
    const [, icon, title, doing, what] = match;
    return { icon, title, subtitle: sub, doing: `${who} is ${doing}`, what: desc ? `${what} Claude's note: “${desc}”.` : what, why: WHY.command };
  }
  return {
    icon: "terminal",
    title: "Runs a command",
    subtitle: sub,
    doing: desc ? `${who} is running a command: ${desc}` : `${who} is running a command`,
    what: desc
      ? `Claude typed a [[command:command]] into the terminal. Its own description: “${desc}”.`
      : "Claude typed a [[command:command]] into the terminal.",
    why: WHY.command,
  };
}

const WHY = {
  command: "Commands let Claude do anything you could do by typing in a terminal. Open the technical details to see the exact command and what it printed.",
  read: "Reading never changes anything. Claude reads before it acts, the way you'd read a document before editing it.",
  edit: "This is where your project actually changes. The technical details show exactly which lines were replaced.",
  search: "Searching is the fastest way to find the right place in a big project without reading every file.",
  todo: "Claude keeps a checklist for longer jobs so it doesn't lose track. You often see the same list in Claude's window.",
  web: "Claude's built-in knowledge has a cut-off date, so it looks things up when it needs current or specific information.",
  browser: "With a [[connector:connector]] Claude can drive a real browser: open pages, click and read them, much like you would.",
};

/** Turns one tool call into plain English. `who` is the actor's display name. */
export function explainTool(name: string, input: any, who: string): Explained {
  const file = base(input?.file_path ?? input?.notebook_path ?? input?.path);
  switch (name) {
    case "Read":
      return { icon: "read", title: "Reads a file", subtitle: file, doing: `${who} is reading ${file}`,
        what: `Opened the [[file:file]] ${file} to see what's inside.`, why: WHY.read };
    case "Write":
      return { icon: "create", title: "Writes a file", subtitle: `${file} · ${lines(input?.content)} lines`, doing: `${who} is writing ${file}`,
        what: `Wrote the whole [[file:file]] ${file} (${lines(input?.content)} lines). If it already existed, it was replaced.`, why: WHY.edit };
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit": {
      const n = name === "MultiEdit" ? (input?.edits ?? []).reduce((s: number, e: any) => s + lines(e?.new_string), 0) : lines(input?.new_string ?? input?.new_source);
      return { icon: "edit", title: "Changes a file", subtitle: n ? `${file} · ${n} lines` : file, doing: `${who} is changing ${file}`,
        what: `Changed part of the [[file:file]] ${file}${n ? `, writing ${n} new line${n === 1 ? "" : "s"}` : ""}.`, why: WHY.edit };
    }
    case "Bash":
    case "bash":
    case "PowerShell":
      return bash(input, who);
    case "Grep":
      return { icon: "search", title: "Searches the project", subtitle: `for “${clip(input?.pattern)}”`, doing: `${who} is searching for “${clip(input?.pattern)}”`,
        what: `Searched inside every file for “${clip(input?.pattern)}”, like pressing Ctrl+F across the whole project.`, why: WHY.search };
    case "Glob":
      return { icon: "search", title: "Looks for files", subtitle: clip(input?.pattern), doing: `${who} is looking for files`,
        what: `Listed the files whose names match “${clip(input?.pattern)}”.`, why: WHY.search };
    case "WebSearch":
      return { icon: "web", title: "Searches the web", subtitle: `“${clip(input?.query)}”`, doing: `${who} is searching the web`,
        what: `Searched the internet for “${clip(input?.query)}”.`, why: WHY.web };
    case "WebFetch": {
      let host = "";
      try { host = new URL(input?.url).host; } catch { /* not a URL */ }
      return { icon: "web", title: "Reads a web page", subtitle: host || clip(input?.url), doing: `${who} is reading a web page`,
        what: `Opened ${host || "a web page"} and read it.`, why: WHY.web };
    }
    case "TodoWrite":
    case "TaskCreate":
    case "TaskUpdate":
    case "mcp__ccd_turn__update_plan":
      return { icon: "todo", title: "Updates its to-do list", subtitle: "progress checklist", doing: `${who} is updating its to-do list`,
        what: "Wrote down or ticked off steps on its checklist for this job.", why: WHY.todo };
    case "Skill":
      return { icon: "skill", title: "Uses a skill", subtitle: clip(input?.skill ?? input?.command), doing: `${who} is loading a skill`,
        what: `Loaded the [[skill:skill]] “${clip(input?.skill ?? input?.command)}”, saved instructions for this kind of job.`,
        why: "Skills let Claude follow a proven routine instead of improvising." };
    case "ToolSearch":
      return { icon: "tool", title: "Looks up more tools", subtitle: clip(input?.query), doing: `${who} is looking up tools`,
        what: "Some [[tool:tools]] are only loaded when needed, to keep Claude's [[context:memory]] small. Claude just fetched the ones it needs.",
        why: "Loading tools on demand saves [[tokens:tokens]]." };
    case "EnterPlanMode":
    case "ExitPlanMode":
      return { icon: "plan", title: "Shares a plan", subtitle: "for your approval", doing: `${who} is preparing a plan for you`,
        what: "Claude wrote up a plan and asked you to approve it before making changes.", why: "Agreeing on a plan first avoids wasted work." };
    case "Monitor":
    case "ScheduleWakeup":
      return { icon: "wait", title: "Waits", subtitle: clip(input?.reason ?? input?.description), doing: `${who} is waiting for something to finish`,
        what: "Claude set itself to wait until something finishes, instead of checking over and over.", why: "Waiting quietly costs no [[tokens:tokens]]." };
    case "ListAgents":
      return { icon: "wait", title: "Checks on helpers", subtitle: "who's still working", doing: `${who} is checking on its helpers`,
        what: "Claude looked at which [[helper:helpers]] are still working.", why: "The lead keeps track of the helpers it started." };
    case "TaskStop":
      return { icon: "stop", title: "Stops a task", subtitle: "", doing: `${who} is stopping a task`,
        what: "Claude stopped something that was running in the background.", why: "It was no longer needed." };
  }
  if (name.startsWith("mcp__")) {
    const [server, tool] = mcpParts(name);
    if (/browser|chrome|playwright/i.test(server)) {
      const act = /navigate|open|preview_start/.test(tool) ? "Opens a web page"
        : /click|type|fill|press|form|computer/.test(tool) ? "Uses a web page"
        : /screenshot|snapshot|read|text|find/.test(tool) ? "Looks at a web page" : "Uses the browser";
      return { icon: "browser", title: act, subtitle: clip(input?.url ?? tool), doing: `${who} is using the browser`,
        what: `Used the browser through a [[connector:connector]] (${tool.replace(/_/g, " ")}).`, why: WHY.browser };
    }
    return { icon: "plug", title: `Uses ${server || "a connector"}`, subtitle: tool.replace(/_/g, " "), doing: `${who} is using ${server || "a connector"}`,
      what: `Used the ${server} [[connector:connector]] to ${tool.replace(/_/g, " ")}.`,
      why: "Connectors let Claude reach apps and services outside your project folder." };
  }
  return { icon: "tool", title: `Uses ${name}`, subtitle: clip(Object.values(input ?? {}).find((v) => typeof v === "string")),
    doing: `${who} is using ${name}`, what: `Used the [[tool:tool]] “${name}”.`, why: "Open the technical details to see exactly what was sent and what came back." };
}

export const ERROR_NOTE =
  "This step didn't work. That's normal: Claude reads the error message and usually tries another way in the next steps.";
