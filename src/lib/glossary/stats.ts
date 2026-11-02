// Plain-English terms used by the Stats view and the Dashboard. The lead merges these into GLOSSARY (explain.ts);
// until then, [[cacheHit:…]]-style markers render as plain text.
export const GLOSSARY_STATS: Record<string, string> = {
  cacheHit:
    "The share of what Claude read that came from its cache (remembered from the reply before) instead of being new. Higher is better: cached text is quicker to process and counts for less against usage limits.",
  window:
    "The most text Claude can keep in its working memory at once. It depends on the model: usually 200,000 tokens, or 1,000,000 for models with the large memory.",
  compact:
    "/compact is a command you can type in Claude Code. Claude replaces the conversation so far with a short summary, freeing memory while keeping the gist.",
  clear: "/clear is a command you can type in Claude Code. It starts a fresh conversation with an empty memory: best when you move on to something unrelated.",
  written: "Tokens Claude wrote itself: its answers, its notes, the commands it ran and the text of files it created or changed.",
};
