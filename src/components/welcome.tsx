"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

const KEY = "cc-trace:welcomed";

/** A one-time card for first visits: the three things to know, then out of the way. */
export function Welcome({ onHelp }: { onHelp: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(!localStorage.getItem(KEY));
    } catch {
      // storage blocked: skip the welcome rather than show it every time
    }
  }, []);
  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // storage blocked: it just shows again next visit
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, transform: "translateY(8px)" }}
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          exit={{ opacity: 0, transform: "translateY(4px)", transition: { duration: 0.15 } }}
          transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
          className="glass-strong absolute top-3 right-3 left-3 z-40 mx-auto max-w-[520px] rounded-2xl p-5 shadow-2xl"
          role="dialog"
          aria-label="Welcome to cc-trace"
        >
          <button onClick={close} className="absolute top-3 right-3 rounded-full p-1.5 text-muted-foreground hover:bg-foreground/10" aria-label="Close">
            <X className="size-4" />
          </button>
          <h2 className="text-base font-semibold tracking-tight">Welcome to cc-trace</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">See what Claude is doing while it works, in plain words.</p>
          <ol className="mt-3 space-y-2 text-[13px] leading-relaxed">
            <li>
              <b>1.</b> Each message you send is a <b>request</b>. Pick one on the left, or open <b>Whole session</b> to see how they connect.
            </li>
            <li>
              <b>2.</b> Each row on the map is an agent: you, Claude, and any helpers. Arrows are messages between them.
            </li>
            <li>
              <b>3.</b> Click any box for an explanation, or press <b>Replay</b> to watch it happen step by step.
            </li>
          </ol>
          <div className="mt-4 flex gap-2">
            <button onClick={close} className="h-8 rounded-lg bg-foreground px-3.5 text-xs font-medium text-background transition-transform duration-150 active:scale-[0.97]">
              Got it
            </button>
            <button
              onClick={() => {
                close();
                onHelp();
              }}
              className="h-8 rounded-lg border border-foreground/15 px-3.5 text-xs font-medium transition-[background-color,transform] duration-150 hover:bg-foreground/[0.06] active:scale-[0.97]"
            >
              How Claude Code works
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
