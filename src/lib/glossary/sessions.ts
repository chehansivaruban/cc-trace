// Glossary terms for the session browser, Live now and the session info bar. Same entry shape as GLOSSARY in
// explain.ts (term key -> plain-English sentence); the lead merges it there.
export const GLOSSARY_SESSIONS: Record<string, string> = {
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
};
