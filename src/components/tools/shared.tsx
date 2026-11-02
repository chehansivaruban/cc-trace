"use client";

// Small building blocks shared by the tool renderers. UI wording (labels, badges, buttons) carries
// `data-find-skip` so find-in-request only searches what came from the log (see src/lib/find-text.ts).
import { useState, type ReactNode } from "react";
import { fmt, plural } from "@/components/view-kit";
import { CAPS, textBoxText } from "@/lib/conversation";
import { useMask } from "@/hooks/use-mask";
import { cn } from "@/lib/utils";

/* eslint-disable @typescript-eslint/no-explicit-any -- tool inputs and results are untyped JSON */
export type Json = any;

export { fmt, plural };
export const asText = (v: unknown) => (typeof v === "string" ? v : "");

export function Label({ children }: { children: ReactNode }) {
  return <div data-find-skip className="mb-1 text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">{children}</div>;
}

const TONES = {
  ok: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  bad: "bg-red-500/12 text-red-700 dark:text-red-300",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  info: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  muted: "bg-foreground/[0.07] text-muted-foreground",
};
export function Pill({ tone = "muted", children, title }: { tone?: keyof typeof TONES; children: ReactNode; title?: string }) {
  return (
    <span data-find-skip title={title} className={cn("inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium", TONES[tone])}>
      {children}
    </span>
  );
}

/** A row of short facts: "Lines 1–40 · typescript · 2.1 KB". */
export function Facts({ items }: { items: ReactNode[] }) {
  const shown = items.filter((x) => x !== null && x !== undefined && x !== false && x !== "");
  if (!shown.length) return null;
  return (
    <div data-find-skip className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
      {shown.map((x, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span aria-hidden>·</span>}
          {x}
        </span>
      ))}
    </div>
  );
}

/** A file path with the file name in bold. */
export function FilePath({ path }: { path: unknown }) {
  const mask = useMask();
  if (typeof path !== "string" || !path) return null;
  const p = mask(path);
  const cut = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1;
  return (
    <p className="font-mono text-[0.75rem] break-all">
      <span className="text-muted-foreground">{p.slice(0, cut)}</span>
      <span className="font-semibold">{p.slice(cut)}</span>
    </p>
  );
}

/** Plain text from the logs in a soft box, collapsed when long. */
export function TextBox({ text, mono, className }: { text: string; mono?: boolean; className?: string }) {
  const mask = useMask();
  const [open, setOpen] = useState(false);
  const long = text.length > CAPS.textBox;
  const shown = open ? mask(text) : textBoxText(text, mask);
  return (
    <div className={cn("rounded-xl bg-foreground/[0.05] px-3 py-2.5 text-[0.8125rem] leading-relaxed", className)}>
      <div className={cn("break-words whitespace-pre-wrap", mono && "font-mono text-[0.75rem]")}>{shown}</div>
      {long && (
        <button data-find-skip onClick={() => setOpen(!open)} className="mt-1.5 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground">
          {open ? "Show less" : `Show all (${fmt(text.length)} characters)`}
        </button>
      )}
    </div>
  );
}
