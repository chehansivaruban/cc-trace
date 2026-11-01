"use client";

import { Fragment, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Keyboard, X } from "lucide-react";
import { SHORTCUTS, SHORTCUTS_EVENT } from "@/hooks/use-shortcuts";

/** "j or ↓" → [j] or [↓]; "g d" → [g] [d]. */
export function Keys({ keys }: { keys: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
      {keys.split(" or ").map((alt, i) => (
        <Fragment key={alt}>
          {i > 0 && <span className="text-[11px] text-muted-foreground">or</span>}
          {alt.split(" ").map((k, j) =>
            k === "–" ? (
              <span key={j} className="text-[11px] text-muted-foreground">
                to
              </span>
            ) : (
              <kbd
                key={j}
                className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-foreground/15 bg-foreground/[0.04] px-1.5 font-sans text-[11px] font-medium shadow-[0_1px_0] shadow-foreground/10"
              >
                {k}
              </kbd>
            ),
          )}
        </Fragment>
      ))}
    </span>
  );
}

/** The shortcut table, shared by the `?` overlay and the help dialog. */
export function ShortcutList() {
  return (
    <dl className="divide-y divide-foreground/[0.06]">
      {SHORTCUTS.map((s) => (
        <div key={s.keys} className="flex items-center justify-between gap-4 py-2">
          <dt className="text-[13px] text-foreground/85">{s.label}</dt>
          <dd>
            <Keys keys={s.keys} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The `?` overlay. Mounted once in the layout; opened with `toggleShortcuts()` (the `?` key by default). */
export function ShortcutsOverlay() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const toggle = () => setOpen((o) => !o);
    window.addEventListener(SHORTCUTS_EVENT, toggle);
    return () => window.removeEventListener(SHORTCUTS_EVENT, toggle);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
        >
          <motion.div
            role="dialog"
            aria-modal
            aria-labelledby="shortcuts-title"
            initial={{ y: 16, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={{ type: "spring", bounce: 0, duration: 0.35 }}
            onClick={(e) => e.stopPropagation()}
            className="glass-strong max-h-[85vh] w-full max-w-[520px] overflow-y-auto rounded-2xl p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.06] text-muted-foreground">
                  <Keyboard className="size-4" />
                </span>
                <div>
                  <h2 id="shortcuts-title" className="text-base font-semibold tracking-tight">
                    Keyboard shortcuts
                  </h2>
                  <p className="text-[13px] text-muted-foreground">Get around cc-trace without the mouse.</p>
                </div>
              </div>
              <button autoFocus onClick={() => setOpen(false)} className="rounded-full p-1.5 text-muted-foreground hover:bg-foreground/10" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-4">
              <ShortcutList />
            </div>
            <p className="mt-4 text-xs text-muted-foreground">Shortcuts pause while you type in a box.</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
