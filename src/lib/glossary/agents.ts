// Words used by the Agents view, Search, Compare and exports. The lead merges these into GLOSSARY.
// Same entry shape as GLOSSARY in explain.ts (a key and a plain-English sentence).
export const GLOSSARY_AGENTS: Record<string, string> = {
  task: "A to-do item Claude or a helper wrote down to keep track of the work, with its status: waiting, being worked on, or done.",
  team: "A group of helpers that work side by side on one job and can message each other directly, with the lead coordinating.",
  story: "A short summary cc-trace writes from the log itself (no AI): what you asked, what Claude did, who helped and how it ended.",
  export: "A copy of what you're looking at, saved as a file you can open without cc-trace or share with someone. It's made in your browser.",
};
