"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * While `open`: moves focus into `ref` (unless it is already there), keeps Tab and Shift+Tab cycling inside it,
 * and on close gives focus back to whatever had it before. Give the container `tabIndex={-1}`.
 */
export function useFocusTrap(open: boolean, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    // Don't use autoFocus inside the container: focus would already be inside and there'd be nothing to give back.
    let before = active instanceof HTMLElement && !ref.current?.contains(active) ? active : null;
    // Opened from a menu item: the item disappears with the menu, so give focus back to the menu's button.
    if (before?.closest("[role=menu]")) before = document.querySelector<HTMLElement>('[aria-haspopup][aria-expanded="true"]') ?? before;
    const items = () => [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((el) => el.offsetParent !== null || el === document.activeElement);
    const frame = requestAnimationFrame(() => {
      const box = ref.current;
      if (box && !box.contains(document.activeElement)) (items()[0] ?? box).focus();
    });
    const onKey = (e: KeyboardEvent) => {
      const box = ref.current;
      if (e.key !== "Tab" || !box) return;
      const list = items();
      const active = document.activeElement;
      if (!list.length) {
        e.preventDefault();
        box.focus();
      } else if (e.shiftKey && (active === list[0] || active === box || !box.contains(active))) {
        e.preventDefault();
        list[list.length - 1].focus();
      } else if (!e.shiftKey && (active === list[list.length - 1] || !box.contains(active))) {
        e.preventDefault();
        list[0].focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey, true);
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, [open, ref]);
}
