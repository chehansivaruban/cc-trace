"use client";

// One Escape key for the whole app. Every dialog, overlay, popup and drawer registers itself while open;
// Escape closes only the one opened last (the top-most), never two at once.
import { useEffect, useRef } from "react";

type Layer = { close: () => void };
const stack: Layer[] = [];

function onKey(e: KeyboardEvent) {
  if (e.key !== "Escape" || e.isComposing || e.defaultPrevented || !stack.length) return;
  // Menus close themselves on Escape; the layer under them stays open.
  if ((e.target as Element | null)?.closest?.("[role=menu]")) return;
  e.preventDefault();
  stack[stack.length - 1].close();
}

/** While `open`, Escape calls `onClose`, unless something opened later is on top of it. */
export function useEscape(open: boolean, onClose: () => void) {
  const ref = useRef(onClose);
  useEffect(() => {
    ref.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const layer: Layer = { close: () => ref.current() };
    stack.push(layer);
    if (stack.length === 1) window.addEventListener("keydown", onKey);
    return () => {
      const i = stack.indexOf(layer);
      if (i >= 0) stack.splice(i, 1);
      if (!stack.length) window.removeEventListener("keydown", onKey);
    };
  }, [open]);
}

/** True while any dialog, overlay or drawer is open. */
export const anyLayerOpen = () => stack.length > 0;
