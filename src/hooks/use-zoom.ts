"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2;
const clamp = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));

/**
 * Zoom and pan for a scrollable area whose content is scaled with CSS `zoom`.
 * `offsetX` is the unscaled space before the content (a sticky label column, say).
 * Pinch / ⌘-scroll / Ctrl-scroll zooms around the pointer; dragging empty space pans.
 */
export function useZoom(scroller: RefObject<HTMLDivElement | null>, offsetX = 0, initial = 1) {
  const [zoom, setZoomState] = useState(initial);
  const zoomRef = useRef(initial);

  /** Changes the zoom, keeping the content under `anchor` (scroller coordinates) in place. */
  const setZoom = useCallback(
    (next: number, anchor?: { x: number; y: number }) => {
      const el = scroller.current;
      const z1 = zoomRef.current;
      const z2 = clamp(next);
      if (z2 === z1) return;
      zoomRef.current = z2;
      setZoomState(z2);
      if (!el) return;
      const a = anchor ?? { x: el.clientWidth / 2, y: el.clientHeight / 2 };
      const cx = (el.scrollLeft + a.x - offsetX) / z1;
      const cy = (el.scrollTop + a.y) / z1;
      // Wait for the new size to lay out before restoring the anchor.
      requestAnimationFrame(() => {
        el.scrollLeft = cx * z2 + offsetX - a.x;
        el.scrollTop = cy * z2 - a.y;
      });
    },
    [scroller, offsetX],
  );

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // Trackpad pinch arrives as a wheel event with ctrlKey set.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setZoom(zoomRef.current * Math.exp(-e.deltaY * 0.01), { x: e.clientX - r.left, y: e.clientY - r.top });
    };

    // Drag empty space to pan, like a map. Buttons, inputs and links keep their own behaviour.
    let drag: { x: number; y: number; left: number; top: number; id: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.pointerType === "touch" || (e.target as HTMLElement).closest("button, input, a, label, [role=button]")) return;
      drag = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, id: e.pointerId };
      el.dataset.panning = "true";
      try {
        el.setPointerCapture(e.pointerId); // keep panning when the pointer leaves the area
      } catch {
        // the pointer is already gone: panning still works while it stays inside
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      el.scrollLeft = drag.left - (e.clientX - drag.x);
      el.scrollTop = drag.top - (e.clientY - drag.y);
    };
    const onUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      delete el.dataset.panning;
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [scroller, setZoom]);

  return { zoom, zoomRef, setZoom };
}
