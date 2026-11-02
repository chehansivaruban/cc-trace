// Search snippets for /api/search, kept apart from the route so the self-check can test them.

/**
 * The text around the first case-insensitive match of `query` (plain substring), `around` characters each
 * side. The whole text is masked first and only then cut: cutting first could split a secret so the
 * masking patterns no longer recognise the half that's left. Returns null when there's no match, including
 * when the only match was inside text the mask hid.
 */
export function snippetOf(text: string, query: string, mask: (s: string) => string = (s) => s, around = 60): string | null {
  const t = mask(text);
  const at = t.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return null;
  const from = Math.max(0, at - around);
  const to = Math.min(t.length, at + query.length + around);
  return `${from > 0 ? "…" : ""}${t.slice(from, to).replace(/\s+/g, " ").trim()}${to < t.length ? "…" : ""}`;
}
