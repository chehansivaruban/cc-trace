// Risky-action alerts (N3): steps worth a second look, each explained in plain words.
// "caution": normal in many projects, but good to know about. "danger": hard or impossible to undo.
import type { Step } from "../session.ts";
import { FILE_CHANGE_TOOLS, fileOf, isAbsolutePath, isInside, pathKey } from "./files.ts";

export type Risk = { level: "caution" | "danger"; why: string };
export type RiskContext = { cwds?: string[] };

const COMMAND_TOOLS = new Set(["Bash", "bash", "PowerShell"]);
// Start of a command word: the line start, a space, or a shell separator.
const W = String.raw`(?:^|[\s;&|(\x60])`;

const WHY = {
  deleteFolder: "This deletes a folder and everything in it. It can't be undone from the bin.",
  deleteRebuildable: "This deletes a folder and everything in it. It can't be undone from the bin, but it only holds files the project can rebuild or scratch files.",
  deleteFile: "This deletes a file. It skips the bin, so it can't simply be restored.",
  forcePush: "This overwrites the online copy of the project (for example on GitHub) with this one. Work that anyone else saved there can be lost.",
  forceLease: "This overwrites the online copy of the project with this one. It first checks nobody else changed it, so it's safer than a plain force push, but it still rewrites the project's history.",
  resetHard: "This throws away every change that wasn't saved in a checkpoint. It can't be undone.",
  gitClean: "This deletes the new files that were never saved in a checkpoint. It can't be undone.",
  chmodAll: "This lets anyone using this computer read, change or run these files and everything inside them.",
  chmodOne: "This lets anyone using this computer read, change or run this file.",
  pipeToShell: "This downloads a script from the internet and runs it straight away, without anyone reading it first.",
  skipPermissions: "This starts Claude with its permission checks switched off, so it can act without asking you first.",
  disk: "This writes straight to a disk and can wipe everything on it.",
  sudo: "This runs a command with administrator rights, so it can change anything on the computer, not just your project.",
  install: "This downloads and installs software from the internet. That's normal for most projects, but it's worth knowing what was added.",
  outside: "This changes a file outside your project folder. Claude normally works only inside your project, so it's worth checking this was expected.",
  bypassMode:
    "Claude was allowed to act without asking you first (“bypass permissions” mode), so nothing paused for your OK. That's fine for a quick experiment, but take care with real projects.",
};

const RM_RECURSIVE = String.raw`rm\s+(?:-{1,2}[\w-]+\s+)*(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)(?=\s|$)`;

/** Every rule that matches counts; the first "danger" wins, otherwise the first "caution". */
const COMMAND_RULES: [RegExp, Risk["level"], string][] = [
  [new RegExp(W + RM_RECURSIVE), "danger", WHY.deleteFolder], // keep first: see onlyRebuildable
  [/\bremove-item\b[^;|&\n]*\s-r(?:ecurse)?\b/i, "danger", WHY.deleteFolder],
  [/\b(?:rmdir|rd)\s+(?:\/\w\s+)*\/s\b/i, "danger", WHY.deleteFolder],
  [/\b(?:del|erase)\s+(?:\/\w\s+)*\/s\b/i, "danger", WHY.deleteFolder],
  [/\bgit\s+push\b[^;|&\n]*\s(?:--force(?!-)|-f)(?=\s|$)/, "danger", WHY.forcePush],
  [/\bgit\s+push\b[^;|&\n]*\s--force-with-lease\b/, "caution", WHY.forceLease],
  [/\bgit\s+reset\b[^;|&\n]*\s--hard\b/, "danger", WHY.resetHard],
  [/\bgit\s+clean\b[^;|&\n]*\s-[a-zA-Z]*f/, "danger", WHY.gitClean],
  [/\bchmod\b(?=[^;|&\n]*\s(?:-[a-zA-Z]*R|--recursive)\b)[^;|&\n]*\s(?:0?777|a\+rwx)\b/, "danger", WHY.chmodAll],
  [/\bchmod\b[^;|&\n]*\s(?:0?777|a\+rwx)\b/, "caution", WHY.chmodOne],
  // Piping a download into a shell runs it; piping it into `python -c ...` only parses it.
  [/\b(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^;&\n]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|iex|invoke-expression|python3?|node)\b(?![^;&|\n]*\s-[cem]\b)/i, "danger", WHY.pipeToShell],
  [/--dangerously-skip-permissions\b|--permission-mode[\s=]+bypassPermissions\b/, "danger", WHY.skipPermissions],
  [/\bmkfs(?:\.\w+)?\s|\bdd\b[^;|&\n]*\bof=\/dev\//, "danger", WHY.disk],
  [new RegExp(`${W}sudo\\s`), "caution", WHY.sudo],
  [
    /\b(?:npm|pnpm|yarn|bun)\s+(?:i|install|add|ci)\b|\b(?:pip3?|pipx|gem|brew|cargo|go|choco|winget|scoop|apt|apt-get|dnf|yum)\s+install\b|\bpython3?\s+-m\s+pip\s+install\b|\b(?:flutter|dart)\s+pub\s+(?:add|get)\b/,
    "caution",
    WHY.install,
  ],
  [new RegExp(`${W}(?:rm|unlink)\\s+\\S`), "caution", WHY.deleteFile],
  [/(?:^|[\s;&|(])(?:remove-item|del|erase)\s+\S/i, "caution", WHY.deleteFile],
];

// Scratch folders and Claude's own files (plans, memory) are expected places to write.
const EXPECTED_OUTSIDE = /^(\/tmp|\/private\/tmp|\/var\/folders|\/private\/var\/folders)(\/|$)|\/appdata\/local\/temp(\/|$)|(^|\/)\.claude(\/|$)/;

const HEREDOC = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?(?:\n\s*\2(?=\s|$)|$)/g;
const noHeredocs = (cmd: string) => cmd.replace(HEREDOC, "<<$2");
/** Quoted text and here-documents are data (a commit message, a file's contents), not commands: leave them out. */
const unquote = (cmd: string) => noHeredocs(cmd).replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'[^']*'/g, "''");

// Folders a project rebuilds on its own, and scratch folders: deleting them is routine.
const REBUILDABLE =
  /(?:^|[\\/])(?:node_modules|\.next|dist|build|out|\.turbo|\.cache|coverage|target|__pycache__|\.dart_tool|\.pytest_cache|test-results|playwright-report|\.vite|\.svelte-kit|\.nuxt|\.parcel-cache)(?:[\\/]|$)|^(?:\/tmp|\/private\/tmp|\$TMPDIR|\$\{TMPDIR\})(?:[\\/]|$)/;

/** Whether every `rm -r` in the command only removes rebuildable or scratch folders. */
function onlyRebuildable(command: string): boolean {
  let any = false;
  for (const m of noHeredocs(command).matchAll(new RegExp(`${W}${RM_RECURSIVE}([^;&|\\n]*)`, "g"))) {
    const targets = m[1].trim().split(/\s+/).filter((t) => t && !t.startsWith("-")).map((t) => t.replace(/^["']+|["']+$/g, ""));
    if (!targets.length || !targets.every((t) => REBUILDABLE.test(t))) return false;
    any = true;
  }
  return any;
}

/**
 * Whether a step is worth a second look, and why. `ctx.cwds` (the session's working folders) turns on the
 * "writes outside the project" check; without it, only commands are checked.
 */
export function riskOf(step: Step, ctx: RiskContext = {}): Risk | undefined {
  const input = step.input as Record<string, unknown> | null | undefined;
  if (!step.tool || !input || typeof input !== "object") return undefined;
  if (COMMAND_TOOLS.has(step.tool)) {
    if (typeof input.command !== "string") return undefined;
    const cmd = unquote(input.command);
    const hits: Risk[] = [];
    COMMAND_RULES.forEach(([re, level, why], i) => {
      if (!re.test(cmd)) return;
      // rm -r of only rebuildable or scratch folders: still worth knowing, not a danger.
      hits.push(i === 0 && onlyRebuildable(input.command as string) ? { level: "caution", why: WHY.deleteRebuildable } : { level, why });
    });
    return hits.find((h) => h.level === "danger") ?? hits[0];
  }
  if (FILE_CHANGE_TOOLS.has(step.tool) && ctx.cwds?.length) {
    const file = fileOf(step);
    if (!file || !isAbsolutePath(file) || EXPECTED_OUTSIDE.test(pathKey(file))) return undefined;
    if (!ctx.cwds.some((dir) => isInside(file, dir))) return { level: "caution", why: WHY.outside };
  }
  return undefined;
}

/** "Bypass permissions" mode: Claude never stops to ask before acting. */
export function permissionModeRisk(mode?: string): Risk | undefined {
  return mode === "bypassPermissions" ? { level: "danger", why: WHY.bypassMode } : undefined;
}
