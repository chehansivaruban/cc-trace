// Bookmarks, tags and your own session names, kept in this browser only (localStorage `cc-trace:bookmarks`).
// Nothing is sent anywhere. Storage can be missing or throw: everything then works in memory until the page closes.
import { useMemo, useSyncExternalStore } from "react";
import { isDroppedFile } from "./paths.ts";
import { createMasker, type Masker } from "./redact.ts";

export type Bookmark = { file: string; step?: string; turn?: number; label: string; createdAt: number };
export type BookmarkData = { items: Bookmark[]; tags: Record<string, string[]>; names: Record<string, string> };
type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void };

export const BOOKMARKS_KEY = "cc-trace:bookmarks";
const EMPTY: BookmarkData = { items: [], tags: {}, names: {} };
const LABEL_MAX = 160;
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** Turns stored JSON into valid data; anything malformed is dropped. */
export function parseBookmarks(raw: string | null | undefined): BookmarkData {
  let v: Record<string, unknown>;
  try {
    v = raw ? JSON.parse(raw) : null;
  } catch {
    return EMPTY;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return EMPTY;
  const items: Bookmark[] = [];
  for (const b of Array.isArray(v.items) ? v.items : []) {
    if (!b || typeof b !== "object" || !str(b.file)) continue;
    items.push({
      file: b.file,
      ...(str(b.step) ? { step: b.step } : {}),
      ...(Number.isInteger(b.turn) && b.turn >= 0 ? { turn: b.turn } : {}),
      label: typeof b.label === "string" ? b.label : "",
      createdAt: typeof b.createdAt === "number" ? b.createdAt : 0,
    });
  }
  const tags: Record<string, string[]> = {};
  if (v.tags && typeof v.tags === "object") {
    for (const [f, t] of Object.entries(v.tags as Record<string, unknown>)) {
      const clean = cleanTags(Array.isArray(t) ? t : []);
      if (clean.length) tags[f] = clean;
    }
  }
  const names: Record<string, string> = {};
  if (v.names && typeof v.names === "object") {
    for (const [f, n] of Object.entries(v.names as Record<string, unknown>)) if (str(n)) names[f] = n;
  }
  return { items, tags, names };
}

function cleanTags(tags: unknown[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const c = typeof t === "string" ? t.trim().toLowerCase().slice(0, 40) : "";
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

const shapeMask = createMasker();
const sameSpot = (b: Bookmark, file: string, step?: string) => b.file === file && (b.step ?? "") === (step ?? "");

/** A bookmark store over any storage; the app uses one over localStorage, the self-check one over fakes. */
export function createBookmarkStore(getStorage: () => StorageLike | null | undefined) {
  let current: BookmarkData | null = null;
  // Set once storage fails to read or write: the in-memory copy is then the only one, so it is never dropped.
  let memoryOnly = false;
  const listeners = new Set<() => void>();

  const storage = () => {
    try {
      return getStorage() ?? null;
    } catch {
      return null;
    }
  };
  const get = (): BookmarkData => {
    if (current) return current;
    let raw: string | null = null;
    try {
      raw = storage()?.getItem(BOOKMARKS_KEY) ?? null;
    } catch {
      memoryOnly = true; // blocked: start empty and keep what follows in memory
    }
    current = parseBookmarks(raw);
    return current;
  };
  const save = (next: BookmarkData) => {
    current = next;
    try {
      const st = storage();
      if (st) st.setItem(BOOKMARKS_KEY, JSON.stringify(next));
      else memoryOnly = true; // no storage at all
    } catch {
      memoryOnly = true; // blocked or full: the change lasts until the page is closed
    }
    for (const l of listeners) l();
  };

  return {
    get,
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
        // Re-read on the next subscribe (another tab may have changed it), unless memory is all there is.
        if (!listeners.size && !memoryOnly) current = null;
      };
    },
    /** Another tab changed storage. */
    reload() {
      if (!memoryOnly) current = null;
      for (const l of listeners) l();
    },
    /**
     * Adds or removes a bookmark. The label is always masked before it's saved: with `mask` (the open
     * session's full masker: secrets, home folders and the user names known now) or, without one, secrets
     * and home folders by their shape.
     */
    toggle(b: Omit<Bookmark, "createdAt">, mask: Masker = shapeMask) {
      // A dropped log isn't in the Claude folder, so a bookmark could never reopen it.
      if (isDroppedFile(b.file)) return;
      const d = get();
      if (d.items.some((x) => sameSpot(x, b.file, b.step))) {
        save({ ...d, items: d.items.filter((x) => !sameSpot(x, b.file, b.step)) });
        return;
      }
      const label = mask(b.label).replace(/\s+/g, " ").trim().slice(0, LABEL_MAX);
      const item: Bookmark = { file: b.file, ...(b.step ? { step: b.step } : {}), ...(b.turn !== undefined ? { turn: b.turn } : {}), label, createdAt: Date.now() };
      save({ ...d, items: [item, ...d.items] });
    },
    has: (file: string, step?: string) => get().items.some((x) => sameSpot(x, file, step)),
    tags: (file: string) => get().tags[file] ?? [],
    setTags(file: string, tags: string[]) {
      const d = get();
      const next = { ...d.tags };
      const clean = cleanTags(tags);
      if (clean.length) next[file] = clean;
      else delete next[file];
      save({ ...d, tags: next });
    },
    rename(file: string, name?: string) {
      const d = get();
      const next = { ...d.names };
      const n = name?.replace(/\s+/g, " ").trim().slice(0, LABEL_MAX);
      if (n) next[file] = n;
      else delete next[file];
      save({ ...d, names: next });
    },
    nameOf: (file: string): string | undefined => get().names[file],
  };
}

export type BookmarkStore = ReturnType<typeof createBookmarkStore>;

const store = createBookmarkStore(() => (typeof window === "undefined" ? null : window.localStorage));

function subscribe(cb: () => void) {
  const off = store.subscribe(cb);
  const onStorage = (e: StorageEvent) => (e.key === null || e.key === BOOKMARKS_KEY) && store.reload();
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("storage", onStorage);
    off();
  };
}
const getServer = () => EMPTY;

/** Bookmarks, tags and custom names, shared by every caller in the tab and synced across tabs. */
export function useBookmarks() {
  const data = useSyncExternalStore(subscribe, store.get, getServer);
  return useMemo(
    () => ({
      items: data.items,
      data,
      toggle: store.toggle,
      has: (file: string, step?: string) => data.items.some((x) => sameSpot(x, file, step)),
      tags: (file: string) => data.tags[file] ?? [],
      setTags: store.setTags,
      rename: store.rename,
      nameOf: (file: string): string | undefined => data.names[file],
    }),
    [data],
  );
}
