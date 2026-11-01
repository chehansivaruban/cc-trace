// Plain-English terms for settings, alerts, the debug log and bookmarks. The lead merges these into GLOSSARY.
export const GLOSSARY_UX: Record<string, string> = {
  debuglog:
    "A detailed diary Claude Code writes about its own inner workings: settings it loaded, requests it made, errors it hit. It's only saved when Claude Code is started with “claude --debug”.",
  permission:
    "Before Claude runs a command or changes a file, Claude Code can stop and ask you to allow it. Your permission mode decides how often it asks.",
  bookmark: "A shortcut you saved to a session or a step. Bookmarks, tags and names you give sessions stay in this browser only.",
};
