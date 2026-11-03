// Risky-action alerts (N3): steps worth a second look, each explained in plain words.
// "caution": normal in many projects, but good to know about. "danger": hard or impossible to undo.
import type { Step } from "../session.ts";
import { FILE_CHANGE_TOOLS, fileOf, isAbsolutePath, isInside } from "./files.ts";
import { normalizePath } from "../paths.ts";

export type Risk = { level: "caution" | "danger"; why: string };
export type RiskContext = { cwds?: string[] };

const COMMAND_TOOLS = new Set(["Bash", "bash", "PowerShell"]);
// Where a command word can start: the line start or a shell separator (and, for sudo, nowhere else).
const CMD_START = "(?:^|[;&|(\\n\\x60]|\\$\\()\\s*";

const WHY = {
  deleteFolder: "This deletes a folder and everything in it. It can't be undone from the bin.",
  deleteRebuildable: "This deletes a folder and everything in it. It can't be undone from the bin, but it only holds files the project can rebuild.",
  deleteTemp:
    "This deletes a folder in the computer's temporary space, where programs keep scratch files. It can't be undone from the bin, but those files are usually throwaway.",
  deleteContainer:
    "This deletes a folder inside a container (a sealed-off copy of a system that runs on your computer), not your own files. It can't be undone there.",
  deleteFile: "This deletes a file. It skips the bin, so it can't simply be restored.",
  forcePush: "This overwrites the online copy of the project (for example on GitHub) with this one. Work that anyone else saved there can be lost.",
  findDelete: "This deletes every file the search finds. It skips the bin, so they can't simply be restored.",
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

/** Every rule that matches counts; the first "danger" wins, otherwise the first "caution". Deleting is handled by `deletions`. */
const COMMAND_RULES: [RegExp, Risk["level"], string][] = [
  [/\bfind\b[^;|&\n]*\s-delete\b/, "danger", WHY.findDelete],
  // --force, -f, "+src:dst" or "src:+dst" refspecs.
  [/\bgit\s+push\b[^;|&\n]*\s(?:--force(?!-)|-f(?=\s|$)|\+[\w./-]|[\w./@{}~^-]*:\+[\w./-])/, "danger", WHY.forcePush],
  [/\bgit\s+push\b[^;|&\n]*\s--force-(?:with-lease|if-includes)\b/, "caution", WHY.forceLease],
  [/\bgit\s+reset\b[^;|&\n]*\s--hard\b/, "danger", WHY.resetHard],
  [/\bgit\s+clean\b[^;|&\n]*\s-[a-zA-Z]*f/, "danger", WHY.gitClean],
  [/\bchmod\b(?=[^;|&\n]*\s(?:-[a-zA-Z]*R|--recursive)\b)[^;|&\n]*\s(?:0?777|a\+rwx)\b/, "danger", WHY.chmodAll],
  [/\bchmod\b[^;|&\n]*\s(?:0?777|a\+rwx)\b/, "caution", WHY.chmodOne],
  // Piping a download into a shell runs it; piping it into `python -c ...` only parses it.
  [/\b(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^;&\n]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|iex|invoke-expression|python3?|node)\b(?![^;&|\n]*\s-[cem]\b)/i, "danger", WHY.pipeToShell],
  [/--dangerously-skip-permissions\b|--permission-mode[\s=]+bypassPermissions\b/, "danger", WHY.skipPermissions],
  [/\bmkfs(?:\.\w+)?\s|\bdd\b[^;|&\n]*\bof=\/dev\//, "danger", WHY.disk],
  [new RegExp(`${CMD_START}sudo\\s`), "caution", WHY.sudo],
  [
    /\b(?:npm|pnpm|yarn|bun)\s+(?:i|install|add|ci)\b|\b(?:pip3?|pipx|gem|brew|cargo|go|choco|winget|scoop|apt|apt-get|dnf|yum)\s+install\b|\bpython3?\s+-m\s+pip\s+install\b|\b(?:flutter|dart)\s+pub\s+(?:add|get)\b/,
    "caution",
    WHY.install,
  ],
];

// Scratch folders and Claude's own files (plans, memory) are expected places to write.
const EXPECTED_OUTSIDE = /^(\/tmp|\/private\/tmp|\/var\/folders|\/private\/var\/folders)(\/|$)|\/appdata\/local\/temp(\/|$)|(^|\/)\.claude(\/|$)/;

const HEREDOC = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?(?:\n\s*\2(?=\s|$)|$)/g;
// A quoted argument right after one of these is itself a command: `bash -c '…'`, `ssh host "…"`, `cmd /c "…"`.
// The -c, -Command and /c flags only count once a shell's name was seen earlier in the same command segment
// (`grep -c "…"` just counts matches); other flags and their values may sit in between
// (`bash -o pipefail -c`, `powershell -ExecutionPolicy Bypass -Command`).
const SHELL_WORD = String.raw`(?:^|[\s;&|(/\\])`;
const SAME_SEGMENT = String.raw`(?:\s[^;&|\n]*)?`;
const WRAPPER = new RegExp(
  "(?:" +
    [
      String.raw`${SHELL_WORD}(?:sh|bash|zsh|fish|dash|ksh)(?:\.exe)?${SAME_SEGMENT}\s-\w*c`,
      String.raw`${SHELL_WORD}(?:pwsh|powershell)(?:\.exe)?${SAME_SEGMENT}\s-(?:c|command|encodedcommand|ec)`,
      String.raw`${SHELL_WORD}cmd(?:\.exe)?${SAME_SEGMENT}\s\/[ck]`,
      String.raw`(?:^|[\s;&|(])eval`,
      String.raw`(?:^|[\s;&|(])ssh(?:\s+[^\s;&|"']+)+`,
      String.raw`${SHELL_WORD}(?:sh|bash|zsh|fish|dash|ksh|pwsh|powershell|cmd)(?:\.exe)?`,
    ].join("|") +
    String.raw`)\s*$`,
  "i",
);

/**
 * The command with data left out: here-documents (a file's contents) are dropped, and quoted text (a commit
 * message, a search pattern) is kept as one inert word so file names survive but nothing in it reads as a
 * command. Quoted arguments of wrappers (`bash -c`, `ssh host`, `powershell -Command`, `eval`) are commands, and
 * are read like the rest. An apostrophe inside a word (don't) doesn't start a quote.
 */
function unquote(cmd: string, depth = 0): string {
  const src = depth ? cmd : cmd.replace(HEREDOC, "<<$2");
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const prev = i ? src[i - 1] : " ";
    if ((c === "'" || c === '"') && prev !== "\\" && !(c === "'" && /\w/.test(prev))) {
      let j = i + 1;
      if (c === "'") j = src.indexOf("'", j);
      else while (j < src.length && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
      if (j < 0 || j > src.length) j = src.length;
      const inner = src.slice(i + 1, j);
      out += depth < 3 && WRAPPER.test(out)
        ? ` ; ${unquote(c === '"' ? inner.replace(/\\(["\\$`])/g, "$1") : inner, depth + 1)} ; `
        : c + inner.replace(/[\s;&|<>()`$]+/g, "_") + c;
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// Folders a project rebuilds on its own: deleting them is routine (when they're the project's own).
const REBUILDABLE =
  /(?:^|[\\/])(?:node_modules|\.next|dist|build|out|\.turbo|\.cache|coverage|target|__pycache__|\.dart_tool|\.pytest_cache|test-results|playwright-report|\.vite|\.svelte-kit|\.nuxt|\.parcel-cache)(?:[\\/]\*?)?$|(?:^|[\\/])(?:node_modules|\.next|dist|build|out|\.turbo|\.cache|coverage|target|test-results|playwright-report)[\\/]/;

type Deletion = { recursive: boolean; targets: string[]; container: boolean };

// The computer's temporary space: /tmp, macOS's /var/folders, a fresh `mktemp -d`, $TMPDIR, %TEMP%, $env:TEMP.
// Inside quotes unquote() has turned "$(" and "$" into "_" ("$(mktemp -d)" reads "_mktemp_-d_").
const TEMP_TARGET =
  /^(?:(?:\/private)?\/tmp\/|(?:\/private)?\/var\/folders\/|[$_]\(?mktemp(?![a-z])|[$_]\{?TMPDIR\}?[\\/]|%TE?MP%[\\/]|[$_]env:TE?MP[\\/])/i;
const isTempTarget = (t: string) => TEMP_TARGET.test(t) && !/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(t);

/** Every delete in the command: rm, git rm (not --cached), unlink, Remove-Item, rmdir /s, del. */
function deletions(cmd: string): Deletion[] {
  const out: Deletion[] = [];
  for (const seg of cmd.split(/&&|\|\||[;|&\n]/)) {
    const m = /(?:^|[\s(`])(git\s+rm|rm|unlink|remove-item|ri|rmdir|rd|del|erase)(?=\s|$)(.*)$/i.exec(seg);
    if (!m || /\b(?:npm|pnpm|yarn|bun)\s+$/.test(seg.slice(0, m.index + 1))) continue;
    const word = m[1].toLowerCase().replace(/\s+/g, " ");
    const tokens = m[2].trim().split(/\s+/).filter(Boolean).map((t) => t.replace(/[)}]+$/, ""));
    const dosStyle = word === "rmdir" || word === "rd" || word === "del" || word === "erase";
    const isFlag = (t: string) => t.startsWith("-") || (dosStyle && /^\/\w$/.test(t));
    const flags = tokens.filter(isFlag);
    const targets = tokens.filter((t) => t && !isFlag(t)).map((t) => t.replace(/^["']+|["']+$/g, ""));
    if (word === "git rm" && flags.includes("--cached")) continue;
    let recursive = false;
    if (word === "rm" || word === "git rm") recursive = flags.some((f) => /^-[fiIdvP]*[rR][fiIdvrRP]*$/.test(f) || f === "--recursive");
    else if (word === "remove-item" || word === "ri") recursive = flags.some((f) => /^-r(?:ecurse)?$/i.test(f));
    else if (dosStyle) recursive = flags.some((f) => /^\/s$/i.test(f));
    // rmdir without /s only removes an empty folder: nothing is lost.
    if ((word === "rmdir" || word === "rd") && !recursive) continue;
    // `docker exec <container> rm …` runs inside the container, not on this computer.
    const container = /\b(?:docker|podman)\s+(?:compose\s+|container\s+)?exec\b/i.test(seg.slice(0, m.index + 1));
    out.push({ recursive, targets, container });
  }
  return out;
}

/** A folder the project rebuilds, written relative to the project or as a path inside it. */
function rebuildable(target: string, cwds: string[]): boolean {
  if (/^[~$%]/.test(target)) return false; // the home folder or a variable: can't tell where it points
  // Judged on the resolved path: "node_modules/.." is the project itself, "../node_modules" someone else's.
  const resolved = normalizePath(target);
  if (!resolved || !REBUILDABLE.test(resolved)) return false;
  if (!isAbsolutePath(target)) return !resolved.startsWith("..");
  return cwds.some((dir) => isInside(target, dir));
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
    const hits: Risk[] = COMMAND_RULES.filter(([re]) => re.test(cmd)).map(([, level, why]) => ({ level, why }));
    const dels = deletions(cmd);
    const folders = dels.filter((d) => d.recursive);
    if (folders.length) {
      const own = folders.filter((d) => !d.container);
      const safe = (t: string) => rebuildable(t, ctx.cwds ?? []) || isTempTarget(t);
      const routine = own.every((d) => d.targets.length && d.targets.every(safe));
      if (!routine) hits.push({ level: "danger", why: WHY.deleteFolder });
      else if (own.some((d) => d.targets.some((t) => !isTempTarget(t)))) hits.push({ level: "caution", why: WHY.deleteRebuildable });
      else if (own.length) hits.push({ level: "caution", why: WHY.deleteTemp });
      if (own.length < folders.length) hits.push({ level: "caution", why: WHY.deleteContainer });
    }
    if (dels.some((d) => !d.recursive)) hits.push({ level: "caution", why: WHY.deleteFile });
    // Deleting comes first among cautions: it's the one that loses work.
    const order = (h: Risk) => (h.level === "danger" ? 0 : h.why === WHY.deleteRebuildable || h.why === WHY.deleteFile ? 1 : 2);
    return hits.sort((x, y) => order(x) - order(y))[0];
  }
  if (FILE_CHANGE_TOOLS.has(step.tool) && ctx.cwds?.length) {
    const file = fileOf(step);
    if (!file || !isAbsolutePath(file) || EXPECTED_OUTSIDE.test(normalizePath(file))) return undefined;
    if (!ctx.cwds.some((dir) => isInside(file, dir))) return { level: "caution", why: WHY.outside };
  }
  return undefined;
}

/** "Bypass permissions" mode: Claude never stops to ask before acting. */
export function permissionModeRisk(mode?: string): Risk | undefined {
  return mode === "bypassPermissions" ? { level: "danger", why: WHY.bypassMode } : undefined;
}
