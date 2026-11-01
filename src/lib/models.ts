// How much text each Claude model can hold in its working memory (tokens).
// Only models whose larger window shows in local logs (replies that read over 200k tokens)
// are listed; anything else gets the long-standing default. A "[1m]" suffix on a model
// name means Claude Code asked for the 1M window.
const DEFAULT_WINDOW = 200_000;
const WINDOWS: Record<string, number> = {
  "claude-opus-5-5": 1_000_000,
  "claude-opus-5": 1_000_000,
  "claude-opus-4-8": 1_000_000,
  "claude-sonnet-5-5": 1_000_000,
  "claude-sonnet-5": 1_000_000,
};

export function contextWindow(model?: string): number {
  if (!model) return DEFAULT_WINDOW;
  if (/\[1m\]$/i.test(model)) return 1_000_000;
  // "claude-haiku-4-5-20251001" -> "claude-haiku-4-5"
  return WINDOWS[model.replace(/\[.*\]$/, "").replace(/-\d{8}$/, "")] ?? DEFAULT_WINDOW;
}
