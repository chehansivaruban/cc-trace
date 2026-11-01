"use client";

import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy } from "lucide-react";

// shortcut: render cap keeps huge tool outputs from freezing the drawer; copy still gets everything.
const MAX_RENDER = 60_000;

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g;

function highlightJson(src: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of src.matchAll(TOKEN)) {
    if (m.index > last) out.push(src.slice(last, m.index));
    const cls = m[1]
      ? m[2]
        ? "text-sky-300/90"
        : "text-emerald-300/80"
      : m[3]
        ? "text-violet-300/90"
        : "text-amber-300/80";
    out.push(
      <span key={m.index} className={cls}>
        {m[1] ?? m[0]}
      </span>,
    );
    if (m[2]) out.push(m[2]);
    last = m.index + m[0].length;
  }
  out.push(src.slice(last));
  return out;
}

export function CodeBlock({ label, value }: { label: string; value: unknown }) {
  const [copied, setCopied] = useState(false);
  const isText = typeof value === "string";
  const text = isText ? value : JSON.stringify(value, null, 2) ?? String(value);
  const shown = text.length > MAX_RENDER ? text.slice(0, MAX_RENDER) : text;

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <section className="overflow-hidden rounded-xl border border-foreground/10 bg-neutral-950/90 text-neutral-200">
      <header className="flex items-center justify-between border-b border-white/5 px-3 py-2">
        <span className="text-[11px] font-medium tracking-wide text-neutral-400 uppercase">{label}</span>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100 active:scale-95"
          aria-label={`Copy ${label}`}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={copied ? "y" : "n"}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ type: "spring", bounce: 0, duration: 0.25 }}
            >
              {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
            </motion.span>
          </AnimatePresence>
          {copied ? "Copied" : "Copy"}
        </button>
      </header>
      <pre className="max-h-[50vh] overflow-auto p-3 font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap">
        {isText ? shown : highlightJson(shown)}
        {shown !== text && (
          <span className="mt-2 block text-neutral-500">
            … {(text.length - MAX_RENDER).toLocaleString()} more characters (copy to get all)
          </span>
        )}
      </pre>
    </section>
  );
}
