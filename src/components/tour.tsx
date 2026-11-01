"use client";

// Guided tour (N9): highlights each part of the screen in turn. Stops point at elements marked
// `data-tour="<id>"`; a stop whose element is missing or hidden (small screens) is skipped.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

export type TourStop = { id: string; title: string; text: string };

export const TOUR_STEPS: TourStop[] = [
  { id: "pickers", title: "Pick a project and a session", text: "A project is a folder you used Claude Code in. A session is one conversation with Claude there." },
  { id: "requests", title: "Your requests", text: "Every message you send Claude is a request. Pick one to see what happened while Claude worked on it." },
  { id: "tabs", title: "Ways to look at it", text: "Switch between the map, the conversation, the helpers, the numbers, health checks and the files that changed." },
  { id: "map", title: "The map", text: "Each row is an agent: you, Claude and any helpers. Time runs left to right. Click any box to learn what it did." },
  { id: "explanations", title: "Plain-English explanations", text: "Whatever you click is explained here. The exact technical details stay tucked away until you want them." },
  { id: "zoom", title: "Zoom and fit", text: "Zoom in and out, or fit the whole request on screen. Pinching on a trackpad works too." },
];

export const TOUR_EVENT = "cc-trace:tour";
/** Starts the tour from anywhere (welcome card, Settings). */
export function startTour() {
  window.dispatchEvent(new Event(TOUR_EVENT));
}

type Box = { top: number; left: number; width: number; height: number };
const PAD = 6;
const GAP = 12;

function anchor(id: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(id)}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

/** Mounted once in the layout. Arrow keys or Enter move through it, Esc closes it. */
export function Tour({ steps = TOUR_STEPS }: { steps?: TourStop[] }) {
  const [index, setIndex] = useState<number | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [cardH, setCardH] = useState(190);
  const [view, setView] = useState({ w: 1024, h: 768 });
  const card = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  // Only the stops whose element is on screen right now.
  const [stops, setStops] = useState<TourStop[]>([]);

  const close = useCallback(() => setIndex(null), []);

  useEffect(() => {
    const start = () => {
      setStops(steps.filter((s) => anchor(s.id)));
      setIndex(0);
    };
    window.addEventListener(TOUR_EVENT, start);
    return () => window.removeEventListener(TOUR_EVENT, start);
  }, [steps]);

  const stop = index !== null ? stops[index] : undefined;

  // Follow the highlighted element as the page scrolls or resizes.
  useLayoutEffect(() => {
    if (!stop) return;
    let el = anchor(stop.id);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!el?.isConnected) el = anchor(stop.id);
        const r = el?.getBoundingClientRect();
        setBox(r && r.width > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null);
        setView({ w: window.innerWidth, h: window.innerHeight });
        if (card.current) setCardH(card.current.offsetHeight);
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (el) ro.observe(el);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [stop]);

  useEffect(() => {
    if (index === null) return;
    next.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const go = e.key === "ArrowRight" || e.key === "Enter" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!go && e.key !== "Escape") return;
      // Keep the map and the app shortcuts from also reacting.
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") return close();
      const to = index + go;
      if (to >= stops.length) close();
      else setIndex(Math.max(0, to));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [index, stops.length, close]);

  const open = index !== null;
  const last = index === stops.length - 1;
  const cardW = Math.min(340, view.w - 24);
  const pos = (() => {
    if (!box) return { top: Math.max(12, (view.h - cardH) / 2), left: (view.w - cardW) / 2 };
    const below = box.top + box.height + PAD + GAP;
    const above = box.top - PAD - GAP - cardH;
    const top = below + cardH <= view.h - 12 ? below : above >= 12 ? above : Math.max(12, view.h - cardH - 12);
    const left = Math.min(Math.max(12, box.left + box.width / 2 - cardW / 2), view.w - cardW - 12);
    return { top, left };
  })();

  return (
    <AnimatePresence>
      {open && (
        <motion.div key="tour" className="fixed inset-0 z-[60]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          {/* The dimmed page with a hole over the highlighted part; clicks on the page are blocked. */}
          <svg className="pointer-events-none fixed inset-0 size-full" aria-hidden>
            <defs>
              <mask id="tour-hole">
                <rect width="100%" height="100%" fill="white" />
                {box && <rect x={box.left - PAD} y={box.top - PAD} width={box.width + PAD * 2} height={box.height + PAD * 2} rx={12} fill="black" />}
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="rgb(0 0 0 / 0.55)" mask="url(#tour-hole)" />
            {box && (
              <rect x={box.left - PAD} y={box.top - PAD} width={box.width + PAD * 2} height={box.height + PAD * 2} rx={12} fill="none" stroke="rgb(255 255 255 / 0.75)" strokeWidth={2} />
            )}
          </svg>
          <div className="fixed inset-0" onClick={close} aria-hidden />
          <div
            ref={card}
            role="dialog"
            aria-modal
            aria-labelledby="tour-title"
            aria-describedby="tour-text"
            className="glass-strong fixed rounded-2xl p-4 shadow-2xl transition-[top,left] duration-300 ease-out"
            style={{ top: pos.top, left: pos.left, width: cardW }}
          >
            <button onClick={close} className="absolute top-2.5 right-2.5 rounded-full p-1.5 text-muted-foreground hover:bg-foreground/10" aria-label="Close the tour">
              <X className="size-4" />
            </button>
            {stop ? (
              <>
                <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Tour · {index + 1} of {stops.length}
                </div>
                <h2 id="tour-title" className="mt-1 pr-6 text-[15px] font-semibold tracking-tight">
                  {stop.title}
                </h2>
                <p id="tour-text" className="mt-1 text-[13px] leading-relaxed text-foreground/85">
                  {stop.text}
                </p>
                <div className="mt-4 flex items-center gap-2">
                  <div className="flex gap-1" aria-hidden>
                    {stops.map((s, i) => (
                      <span key={s.id} className={i === index ? "h-1.5 w-4 rounded-full bg-foreground" : "size-1.5 rounded-full bg-foreground/20"} />
                    ))}
                  </div>
                  <div className="ml-auto flex gap-2">
                    {index > 0 && (
                      <button
                        onClick={() => setIndex(index - 1)}
                        className="h-8 rounded-lg border border-foreground/15 px-3 text-xs font-medium transition-[background-color,transform] duration-150 hover:bg-foreground/[0.06] active:scale-[0.97]"
                      >
                        Back
                      </button>
                    )}
                    <button
                      ref={next}
                      onClick={() => (last ? close() : setIndex(index + 1))}
                      className="h-8 rounded-lg bg-foreground px-3.5 text-xs font-medium text-background transition-transform duration-150 active:scale-[0.97]"
                    >
                      {last ? "Done" : "Next"}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <h2 id="tour-title" className="pr-6 text-[15px] font-semibold tracking-tight">
                  Open a session first
                </h2>
                <p id="tour-text" className="mt-1 text-[13px] leading-relaxed text-foreground/85">
                  The tour points out the parts of a session screen. Pick a session, then start the tour again.
                </p>
                <button ref={next} onClick={close} className="mt-4 h-8 rounded-lg bg-foreground px-3.5 text-xs font-medium text-background">
                  OK
                </button>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
