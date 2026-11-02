"use client";

// App-wide keyboard shortcuts. The page passes what each key does; this hook decides when a key counts.
import { useEffect, useRef } from "react";

/** Every shortcut, for the `?` overlay and the help dialog. `keys` is for display: "or" separates alternatives. */
export const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: "?", label: "Show these shortcuts" },
  { keys: "/", label: "Search all sessions" },
  { keys: "g d", label: "Go to the dashboard" },
  { keys: "g l", label: "Go to Live now" },
  { keys: "1 – 7", label: "Switch view: Map, Conversation, Agents, Stats, Health, Files, Whole session" },
  { keys: "j or ↓", label: "Next request (↓ on the map)" },
  { keys: "k or ↑", label: "Previous request (↑ on the map)" },
  { keys: "g g", label: "First request" },
  { keys: "G", label: "Newest request" },
  { keys: "[ or ]", label: "Previous or next session" },
  { keys: "b", label: "Bookmark the selected step, or the session" },
  { keys: "Esc", label: "Close a panel or dialog" },
  { keys: "← or →", label: "Step through the request on the map" },
  { keys: "Space", label: "Play or pause the replay" },
  { keys: "+ or −", label: "Zoom the map in or out" },
  { keys: "0", label: "Fit the map to the screen" },
];

type KeyLike = { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; repeat?: boolean; isComposing?: boolean; target?: unknown };
type Closest = { closest?: (sel: string) => unknown; isContentEditable?: boolean };

/** True when the key press is someone typing: a text field, a select, or editable text. */
export function isTypingTarget(t: unknown): boolean {
  if (!t || typeof t !== "object") return false;
  const el = t as Closest;
  return !!el.isContentEditable || !!el.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])");
}

const inOverlay = (t: unknown) => !!(t && typeof t === "object" && (t as Closest).closest?.("[role=dialog], [role=alertdialog], [role=menu], [role=listbox]"));

/**
 * Which binding a key press triggers. `keys` are the bound names ("j", "ArrowDown", "?", "Escape", or a two-key
 * sequence like "g d"); `pending` is the first key of a sequence pressed just before.
 */
export function matchShortcut(e: KeyLike, pending: string | null, keys: string[]): { action?: string; pending: string | null } {
  // isComposing: a key that is part of typing with an input method (Japanese, Chinese…), never a shortcut.
  if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return { pending: null };
  if (inOverlay(e.target)) return { action: e.key === "Escape" && keys.includes("Escape") ? "Escape" : undefined, pending: null };
  if (pending && keys.includes(`${pending} ${e.key}`)) return { action: `${pending} ${e.key}`, pending: null };
  if (keys.some((k) => k.startsWith(e.key + " "))) return { pending: e.key };
  return { action: keys.includes(e.key) ? e.key : undefined, pending: null };
}

export const SHORTCUTS_EVENT = "cc-trace:shortcuts";
/** Opens (or closes) the shortcuts overlay from anywhere. */
export function toggleShortcuts() {
  window.dispatchEvent(new Event(SHORTCUTS_EVENT));
}

/**
 * Runs `map[key]` for each shortcut pressed. Keys: "?", "/", "g d", "g l", "g g", "G", "1"–"7", "j", "k",
 * "ArrowDown", "ArrowUp", "[", "]", "b", "Escape". Typing in fields and presses with ⌘/Ctrl/Alt are ignored;
 * inside a dialog only Escape counts. Without a "?" entry, "?" toggles the shortcuts overlay.
 */
export function useShortcuts(map: Record<string, () => void>) {
  const ref = useRef(map);
  useEffect(() => {
    ref.current = map;
  });
  useEffect(() => {
    let pending: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const bound: Record<string, () => void> = { "?": toggleShortcuts, ...ref.current };
      const r = matchShortcut(e, pending, Object.keys(bound));
      pending = r.pending;
      clearTimeout(timer);
      if (pending) timer = setTimeout(() => (pending = null), 1200);
      if (!r.action) return;
      e.preventDefault();
      bound[r.action]?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}
