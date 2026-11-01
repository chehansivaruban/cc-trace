// Glossary terms used by the Conversation view and the tool renderers. The lead merges this into GLOSSARY.
// Same entry shape as GLOSSARY in explain.ts (term key -> one plain sentence or two).
export const GLOSSARY_CONVERSATION: Record<string, string> = {
  thinking:
    "Before some replies Claude reasons privately, like scribbling notes before answering. Claude Code only sometimes saves these notes in the log; newer versions usually hide them.",
  diff: "A before-and-after view of a change: removed lines in red, added lines in green, with the changed words marked.",
  exitCode: "The number a command reports when it ends. 0 means it worked; anything else means something went wrong.",
};
