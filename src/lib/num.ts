// Number helpers safe for any size of input: spreading a big array into Math.max/min overflows the call stack
// (a RangeError past ~65k items in Safari, ~130k in Chrome).

/** The largest `f(item)`, at least `floor` (and `floor` for an empty list). */
export function maxOf<T>(items: Iterable<T>, f: (item: T) => number, floor = -Infinity): number {
  let max = floor;
  for (const it of items) {
    const v = f(it);
    if (v > max) max = v;
  }
  return max;
}

/** Appends every item to `out` (push(...items) overflows the call stack for very large arrays). */
export function pushAll<T>(out: T[], items: Iterable<T>): T[] {
  for (const it of items) out.push(it);
  return out;
}
