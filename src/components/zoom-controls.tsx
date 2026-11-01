"use client";

import { Maximize, Minus, Plus } from "lucide-react";
import { ZOOM_MAX, ZOOM_MIN } from "@/hooks/use-zoom";

const btn =
  "flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-foreground/[0.07] hover:text-foreground active:scale-[0.95] disabled:opacity-35";

/** Floating zoom controls, map-style: − 100% + and Fit. */
export function ZoomControls(props: { zoom: number; onZoom: (z: number) => void; onFit?: () => void; fitLabel?: string }) {
  const { zoom, onZoom } = props;
  return (
    <div className="glass flex items-center gap-0.5 rounded-xl p-1 shadow-lg" role="group" aria-label="Zoom">
      <button className={btn} onClick={() => onZoom(zoom / 1.25)} disabled={zoom <= ZOOM_MIN} title="Zoom out (−)" aria-label="Zoom out">
        <Minus className="size-4" />
      </button>
      <button
        className="h-8 w-12 rounded-lg text-xs text-muted-foreground tabular-nums transition-colors hover:bg-foreground/[0.07] hover:text-foreground"
        onClick={() => onZoom(1)}
        title="Reset to 100%"
        aria-label={`Zoom ${Math.round(zoom * 100)}%, reset to 100%`}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button className={btn} onClick={() => onZoom(zoom * 1.25)} disabled={zoom >= ZOOM_MAX} title="Zoom in (+)" aria-label="Zoom in">
        <Plus className="size-4" />
      </button>
      {props.onFit && (
        <button className={btn} onClick={props.onFit} title={props.fitLabel ?? "Fit to screen (0)"} aria-label={props.fitLabel ?? "Fit to screen"}>
          <Maximize className="size-3.5" />
        </button>
      )}
    </div>
  );
}
