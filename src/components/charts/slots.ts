// Pure helpers for categorical charts (no React, so the self-check can import them).

/** A donut shows at most this many slices; past it, the tail folds into "Other". */
export const MAX_SLICES = 6;

/**
 * Colour follows the entity: keys keep the slot they first got, new keys take the next free one, and once the
 * slots run out a key gets none (drawn as "Other"). Returns `known` itself when nothing changes.
 */
export function assignSlots(known: readonly string[], keys: readonly string[], slots: number): string[] {
  const next = [...known];
  for (const k of keys) if (!next.includes(k) && next.length < slots) next.push(k);
  return next.length === known.length ? (known as string[]) : next;
}

/** Biggest first; with more than `max` non-empty slices, the smallest fold into one "Other" slice. */
export function foldSlices<T extends { key: string; value: number }>(slices: T[], max = MAX_SLICES): { shown: T[]; folded: T[] } {
  const sorted = slices.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= max) return { shown: sorted, folded: [] };
  return { shown: sorted.slice(0, max - 1), folded: sorted.slice(max - 1) };
}
