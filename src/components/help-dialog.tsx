"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Brain, Inbox, Keyboard, MessagesSquare, Send, ShieldCheck, Users, Wrench, X } from "lucide-react";
import { hueColor } from "./step-icon";
import { TermText } from "./term-text";

const SECTIONS = [
  {
    icon: Users,
    title: "A lead and its helpers",
    text: "When you message Claude Code, the Claude you talk to is the [[lead:lead]]. For bigger jobs it creates [[helper:helpers]]: separate copies of Claude, each with its own fresh memory. They work like a small team: the lead plans and coordinates, helpers do focused pieces of work.",
  },
  {
    icon: Send,
    title: "How agents talk to each other",
    text: "Helpers can't read the lead's mind. When the lead creates a helper it sends a [[brief:brief]], a message describing the job. The helper works on its own, then sends back a [[report:report]]. The lead can also send follow-up messages to a helper that's still around. On the map these are the dashed arrows, and you can watch an envelope travel along them during a replay.",
  },
  {
    icon: Brain,
    title: "Claude remembers the conversation",
    text: "Claude doesn't start fresh with each request. Before every reply it re-reads the whole conversation so far: your earlier requests, its answers and what its tools showed it. That's its [[context:working memory]]. Each request on the map starts with a “Remembers earlier” box, and the “Whole session” view shows how every request feeds into the next. When memory gets full, Claude summarises older parts. A new session starts with an empty memory, and helpers never see the conversation, only their brief.",
  },
  {
    icon: Inbox,
    title: "Why use helpers at all?",
    text: "Claude's [[context:working memory]] has a limit. Giving a big job to a helper keeps the lead's memory free for the big picture, lets several pieces happen at the same time, and lets a reviewer check work with fresh eyes.",
  },
  {
    icon: Wrench,
    title: "What each box means",
    text: "Each box is one action: reading a [[file:file]], running a [[command:command]], searching, changing code, and so on. A ✓ means it worked and ✕ means it didn't (Claude usually tries another way). Click any box for a plain explanation, and open “technical details” if you're curious about the exact command.",
  },
  {
    icon: MessagesSquare,
    title: "Reading the map",
    text: "Each row is one agent: you, Claude, then each helper. Time runs left to right. Press Replay to watch a request unfold step by step, use ← and → to step through, or tick “Only messages between agents” to see just the conversation between them.",
  },
  {
    icon: Keyboard,
    title: "Getting around",
    text: "Zoom with the − and + buttons in the corner, by pinching on a trackpad, or by holding ⌘ (Mac) or Ctrl (Windows) while you scroll. The ⤢ button fits a whole request on screen. Drag any empty space to move around. Keyboard: ← and → step through, space plays or pauses, + and − zoom, 0 fits to screen.",
  },
  {
    icon: ShieldCheck,
    title: "Does cc-trace cost anything?",
    text: "No. cc-trace only reads the logs Claude Code already saves on your computer. It never talks to Claude or the internet, so it uses no [[tokens:tokens]] and saves no extra copies of your history. The token numbers you see are what Claude itself used.",
  },
];

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal
            aria-labelledby="help-title"
            initial={{ y: 16, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={{ type: "spring", bounce: 0, duration: 0.35 }}
            onClick={(e) => e.stopPropagation()}
            className="glass-strong max-h-[85vh] w-full max-w-[640px] overflow-y-auto rounded-2xl p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="help-title" className="text-xl font-semibold tracking-tight">How Claude Code works</h2>
                <p className="mt-1 text-sm text-muted-foreground">A two-minute guide to what you&apos;re seeing in cc-trace.</p>
              </div>
              <button onClick={onClose} className="rounded-full p-1.5 text-muted-foreground hover:bg-foreground/10" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-5 space-y-5">
              {SECTIONS.map(({ icon: Icon, title, text }, i) => (
                <section key={title} className="flex gap-3.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl" style={{ background: hueColor(30 + i * 55, 0.16), color: hueColor(30 + i * 55) }}>
                    <Icon className="size-4" />
                  </span>
                  <div>
                    <h3 className="text-[14px] font-semibold">{title}</h3>
                    <p className="mt-1 text-[13px] leading-relaxed text-foreground/85">
                      <TermText text={text} />
                    </p>
                  </div>
                </section>
              ))}
            </div>
            <p className="mt-6 text-xs text-muted-foreground">Words with a dotted underline explain themselves when you hover or tap them.</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
