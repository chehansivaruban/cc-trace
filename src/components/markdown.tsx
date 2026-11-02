"use client";

// Claude's replies are markdown. Rendered safely: no raw HTML, no remote images (nothing is ever fetched),
// links open in a new tab, code blocks get the dark code panel.
import { isValidElement, memo, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CAPS, markdownSource } from "@/lib/conversation";
import { useMask } from "@/hooks/use-mask";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./code-block";

function codeOf(children: ReactNode): { lang?: string; text: string } {
  const el = Array.isArray(children) ? children[0] : children;
  if (!isValidElement(el)) return { text: String(children ?? "") };
  const props = el.props as { className?: string; children?: ReactNode };
  const lang = /language-([\w+#-]+)/.exec(props.className ?? "")?.[1];
  const text = Array.isArray(props.children) ? props.children.join("") : String(props.children ?? "");
  return { lang, text: text.replace(/\n$/, "") };
}

const COMPONENTS: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener" className="font-medium underline underline-offset-2 hover:text-foreground">
      {children}
    </a>
  ),
  // Never load images from the internet: show what they are instead.
  img: ({ alt, src }) => (
    <span data-find-skip className="rounded bg-foreground/[0.06] px-1 text-muted-foreground" title={typeof src === "string" ? src : undefined}>
      [image{alt ? `: ${alt}` : ""}]
    </span>
  ),
  pre: ({ children }) => {
    const { lang, text } = codeOf(children);
    return <CodeBlock label={lang ?? "code"} value={text} lang={lang} className="my-2" />;
  },
  code: ({ children }) => <code className="rounded bg-foreground/[0.07] px-1 py-px font-mono text-[0.92em] break-words">{children}</code>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-0.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-0.5 pl-5">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  h1: ({ children }) => <h4 className="mt-3 mb-1.5 text-[15px] font-semibold first:mt-0">{children}</h4>,
  h2: ({ children }) => <h4 className="mt-3 mb-1.5 text-[14px] font-semibold first:mt-0">{children}</h4>,
  h3: ({ children }) => <h5 className="mt-3 mb-1 text-[13px] font-semibold first:mt-0">{children}</h5>,
  h4: ({ children }) => <h5 className="mt-2 mb-1 text-[13px] font-semibold first:mt-0">{children}</h5>,
  h5: ({ children }) => <h6 className="mt-2 mb-1 text-[13px] font-semibold first:mt-0">{children}</h6>,
  h6: ({ children }) => <h6 className="mt-2 mb-1 text-[13px] font-semibold first:mt-0">{children}</h6>,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-foreground/20 pl-3 text-foreground/80">{children}</blockquote>,
  hr: () => <hr className="my-3 border-foreground/10" />,
  table: ({ children }) => (
    <div className="my-2 max-w-full overflow-x-auto">
      <table className="w-max min-w-full border-collapse text-[12px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-foreground/10 bg-foreground/[0.04] px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-foreground/10 px-2 py-1 align-top">{children}</td>,
  input: ({ checked }) => <input type="checkbox" checked={!!checked} readOnly disabled className="mr-1 align-middle accent-foreground" />,
};

const REMARK = [remarkGfm];

const Rendered = memo(function Rendered({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={REMARK} components={COMPONENTS}>
      {text}
    </ReactMarkdown>
  );
});

/**
 * Markdown text from the logs, masked when "Hide sensitive text" is on. Very long text is masked, then cut
 * before it's parsed, with "Show all".
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const mask = useMask();
  const [all, setAll] = useState(false);
  const long = text.length > CAPS.markdown;
  const shown = useMemo(() => (all ? mask(text) : markdownSource(text, mask)), [all, mask, text]);
  return (
    <div className={cn("min-w-0 text-[13px] leading-relaxed break-words", className)}>
      <Rendered text={shown} />
      {long && (
        <button data-find-skip onClick={() => setAll(!all)} className="mt-1 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground">
          {all ? "Show less" : `Show all (${(text.length - CAPS.markdown).toLocaleString()} more characters)`}
        </button>
      )}
    </div>
  );
}
