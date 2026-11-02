"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy } from "lucide-react";
import { CAPS } from "@/lib/conversation";
import { useMask } from "@/hooks/use-mask";
import { maskThenClip } from "@/lib/redact";
import { cn } from "@/lib/utils";

// shortcut: render cap keeps huge tool outputs from freezing the drawer; copy still gets everything.
const MAX_RENDER = CAPS.code;

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

// A small, forgiving highlighter for code in files and replies: comments, strings, numbers and keywords.
const HASH_COMMENTS = new Set(["python", "py", "shell", "bash", "sh", "zsh", "ruby", "rb", "yaml", "yml", "toml", "dockerfile", "makefile", "powershell", "r", "perl"]);
const KEYWORDS =
  "const|let|var|function|return|if|else|elif|for|while|do|import|from|export|default|class|new|async|await|def|try|catch|except|finally|throw|raise|type|interface|extends|implements|public|private|protected|static|void|null|undefined|nil|true|false|None|True|False|in|of|switch|case|break|continue|yield|lambda|fn|pub|struct|enum|impl|use|mod|match|package|func|echo|then|fi|done|with|as|not|and|or|is|this|self|super|final|late|required";
const codeToken = (comment: string) =>
  new RegExp(String.raw`(${comment})|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\x60(?:\\.|[^\x60\\])*\x60)|\b(\d+(?:\.\d+)?)\b|\b(${KEYWORDS})\b`, "gm");
const SLASH = codeToken(String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/`);
const HASH = codeToken(String.raw`(?:^|(?<=\s))#[^\n]*`);

function highlightCode(src: string, lang: string): ReactNode[] {
  const re = HASH_COMMENTS.has(lang) ? HASH : SLASH;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of src.matchAll(re)) {
    if (!m[0]) continue;
    if (m.index > last) out.push(src.slice(last, m.index));
    const cls = m[1] ? "text-neutral-500 italic" : m[2] ? "text-emerald-300/85" : m[3] ? "text-amber-300/85" : "text-violet-300/90";
    out.push(
      <span key={m.index} className={cls}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  out.push(src.slice(last));
  return out;
}

const PLAIN = new Set(["text", "txt", "plaintext", "markdown", "md", "output", "console"]);

/** Dark code panel with a copy button. Strings show as written (highlighted when `lang` is given), anything else as JSON. */
export function CodeBlock({ label, value, lang, className }: { label: string; value: unknown; lang?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const mask = useMask();
  const isText = typeof value === "string";
  // Work on the raw text once; mask only the part that's shown (and the copy, when it's made).
  const text = useMemo(() => (isText ? value : JSON.stringify(value, null, 2) ?? String(value)), [isText, value]);
  const shown = useMemo(() => maskThenClip(text, MAX_RENDER, mask), [text, mask]);
  const language = lang?.toLowerCase();
  const body = useMemo(
    () => (!isText || language === "json" ? highlightJson(shown) : language && !PLAIN.has(language) ? highlightCode(shown, language) : shown),
    [isText, language, shown],
  );

  const copy = async () => {
    // With "Hide sensitive text" on, the copy is masked too: it's meant for sharing.
    try {
      await navigator.clipboard.writeText(mask(text));
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // clipboard blocked (insecure context or permission)
    }
  };

  return (
    <section className={cn("overflow-hidden rounded-xl border border-foreground/10 bg-neutral-950/90 text-neutral-200", className)}>
      <header data-find-skip className="flex items-center justify-between gap-2 border-b border-white/5 px-3 py-2">
        <span className="min-w-0 truncate text-[11px] font-medium tracking-wide text-neutral-400 uppercase">
          {label}
          {language && language !== label.toLowerCase() && <span className="ml-2 font-normal tracking-normal text-neutral-500 normal-case">{language}</span>}
        </span>
        <button
          onClick={copy}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100 active:scale-95"
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
        {body}
        {text.length > MAX_RENDER && (
          <span data-find-skip className="mt-2 block text-neutral-500">
            … {(text.length - MAX_RENDER).toLocaleString()} more characters (copy to get all)
          </span>
        )}
      </pre>
    </section>
  );
}
