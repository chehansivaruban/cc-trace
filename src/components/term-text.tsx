"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GLOSSARY, type TermKey } from "@/lib/explain";
import { rootRem } from "@/lib/utils";

/** A word with a dotted underline that explains itself on hover, focus or tap. */
export function Term({ k, children }: { k: TermKey; children: ReactNode }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const show = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    // Keep the bubble (16.25rem wide, so it grows with the text size) on screen.
    setPos({ x: Math.max(8, Math.min(r.left, window.innerWidth - 16.25 * rootRem() - 8)), y: r.bottom + 6 });
  };
  return (
    <>
      <span
        tabIndex={0}
        role="button"
        aria-label={`${typeof children === "string" ? children : k}: ${GLOSSARY[k]}`}
        className="cursor-help underline decoration-foreground/40 decoration-dotted underline-offset-[3px] outline-none focus-visible:decoration-foreground"
        onMouseEnter={(e) => show(e.currentTarget)}
        onMouseLeave={() => setPos(null)}
        onFocus={(e) => show(e.currentTarget)}
        onBlur={() => setPos(null)}
        onClick={(e) => (pos ? setPos(null) : show(e.currentTarget))}
      >
        {children}
      </span>
      {pos &&
        createPortal(
          <span
            role="tooltip"
            style={{ left: pos.x, top: pos.y }}
            className="pointer-events-none fixed z-[100] w-[16.25rem] rounded-xl bg-foreground px-3 py-2 text-[0.75rem] leading-snug font-normal text-background not-italic shadow-xl"
          >
            {GLOSSARY[k]}
          </span>,
          document.body,
        )}
    </>
  );
}

const MARK = /\[\[(\w+):([^\]]+)\]\]/g;

/** Renders explanation text, turning [[term:label]] markers into <Term>s. */
export function TermText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MARK)) {
    out.push(text.slice(last, m.index));
    out.push(
      m[1] in GLOSSARY ? (
        <Term key={m.index} k={m[1] as TermKey}>
          {m[2]}
        </Term>
      ) : (
        m[2]
      ),
    );
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

/** Explanation text with the markers removed, for places that can't hold tooltips. */
export const plain = (text: string) => text.replace(MARK, "$2");
