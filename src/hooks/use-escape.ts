"use client";

// One Escape key for the whole app. Every dialog, overlay, popup and drawer registers itself while open;
// Escape closes only the one opened last (the top-most), never two at once.
import { useEffect, useRef } from "react";

type KeyLike = { key: string; isComposing?: boolean; defaultPrevented?: boolean; target?: unknown; preventDefault?: () => void };
const TEXT_FIELD = "textarea, input:not([type]), input[type=text], input[type=search]";
type Closest = { closest?: (sel: string) => unknown; value?: unknown; isContentEditable?: boolean };

/**
 * The layers that are open, oldest first. `handle` closes the newest one for an Escape press and says whether
 * it did. Escape is left alone while typing with an input method, when something already handled it (a find
 * bar), inside a menu (menus close themselves), and in a text field that has text in it or is editable text:
 * there it belongs to the field. An empty box (a search that just opened) lets Escape close its layer.
 */
export function createLayerStack() {
  const stack: { close: () => void }[] = [];
  return {
    push(close: () => void) {
      const layer = { close };
      stack.push(layer);
      return () => {
        const i = stack.indexOf(layer);
        if (i >= 0) stack.splice(i, 1);
      };
    },
    get size() {
      return stack.length;
    },
    handle(e: KeyLike): boolean {
      if (e.key !== "Escape" || e.isComposing || e.defaultPrevented || !stack.length) return false;
      const t = (e.target && typeof e.target === "object" ? e.target : null) as Closest | null;
      if (t?.closest?.("[role=menu]")) return false;
      const field = t?.closest?.(TEXT_FIELD) as Closest | null | undefined;
      if (t?.isContentEditable || (field && typeof field.value === "string" && field.value !== "")) return false;
      e.preventDefault?.();
      stack[stack.length - 1].close();
      return true;
    },
  };
}

const layers = createLayerStack();
const onKey = (e: KeyboardEvent) => void layers.handle(e);

/** While `open`, Escape calls `onClose`, unless something opened later is on top of it. */
export function useEscape(open: boolean, onClose: () => void) {
  const ref = useRef(onClose);
  useEffect(() => {
    ref.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const remove = layers.push(() => ref.current());
    if (layers.size === 1) window.addEventListener("keydown", onKey);
    return () => {
      remove();
      if (!layers.size) window.removeEventListener("keydown", onKey);
    };
  }, [open]);
}
