"use client";

// Find in this request (⌘/Ctrl+F): match count, Enter / Shift+Enter for next / previous, Esc to close.
// Matches are painted with the CSS Custom Highlight API, so the page's DOM is never rewritten.
// Long, virtualized lists pass `texts` (one per row) and `reveal`: matches are then counted in the data,
// and the row holding the current match is scrolled into view before it's highlighted.
import { useDeferredValue, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";

const MAX_MATCHES = 5000;
const STYLE = `::highlight(cc-find){background-color:rgb(250 204 21/.35);color:inherit}::highlight(cc-find-current){background-color:rgb(249 115 22/.7);color:inherit}`;

type Registry = { set: (name: string, h: unknown) => void; delete: (name: string) => void };
const registry = (): Registry | undefined => (typeof CSS !== "undefined" && "highlights" in CSS ? (CSS.highlights as unknown as Registry) : undefined);
const makeHighlight = (ranges: Range[]) => (typeof Highlight === "function" ? new Highlight(...ranges) : undefined);

function clear() {
  const reg = registry();
  reg?.delete("cc-find");
  reg?.delete("cc-find-current");
}

/** Every case-insensitive occurrence of `q` in the visible text under `root`. */
function findRanges(root: HTMLElement, q: string): Range[] {
  const needle = q.toLowerCase();
  const out: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest("[data-find-skip],script,style") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n && out.length < MAX_MATCHES; n = walker.nextNode()) {
    const hay = (n.nodeValue ?? "").toLowerCase();
    for (let i = hay.indexOf(needle); i !== -1 && out.length < MAX_MATCHES; i = hay.indexOf(needle, i + needle.length)) {
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + needle.length);
      out.push(r);
    }
  }
  return out;
}

export function FindBar({ target, texts, reveal }: { target: RefObject<HTMLElement | null>; texts?: string[]; reveal?: (index: number) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim());
  const [cur, setCur] = useState(0);
  const [domCount, setDomCount] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  // Counted in the data when the list is virtualized (most rows aren't in the page).
  const dataMatches = useMemo(() => {
    if (!texts || !q) return [];
    const needle = q.toLowerCase();
    const out: { row: number; k: number }[] = [];
    texts.forEach((t, row) => {
      const hay = t.toLowerCase();
      for (let i = hay.indexOf(needle), k = 0; i !== -1 && out.length < MAX_MATCHES; i = hay.indexOf(needle, i + needle.length)) out.push({ row, k: k++ });
    });
    return out;
  }, [texts, q]);
  const total = texts ? dataMatches.length : domCount;
  const index = total ? Math.min(cur, total - 1) : 0;

  const show = () => {
    setOpen(true);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
  };
  const close = () => {
    setOpen(false);
    clear();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f" && target.current) {
        e.preventDefault();
        show();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target]);

  useEffect(() => setCur(0), [q]);

  // Paint every match on screen, mark the current one, keep painting as rows mount or expand.
  useEffect(() => {
    const root = target.current;
    if (!open || !q || !root) {
      clear();
      setDomCount(0);
      return;
    }
    const m = texts ? dataMatches[index] : undefined;
    if (m) reveal?.(m.row);
    let scrolled = false;
    const paint = () => {
      const ranges = findRanges(root, q);
      let current: Range | undefined;
      if (!texts) {
        setDomCount(ranges.length);
        current = ranges[Math.min(index, ranges.length - 1)];
      } else if (m) {
        const rowEl = root.querySelector(`[data-find-row="${m.row}"]`);
        const inRow = rowEl ? ranges.filter((r) => rowEl.contains(r.startContainer)) : [];
        current = inRow[Math.min(m.k, inRow.length - 1)];
      }
      const reg = registry();
      const all = makeHighlight(ranges.filter((r) => r !== current));
      const now = makeHighlight(current ? [current] : []);
      if (reg && all && now) {
        reg.set("cc-find", all);
        reg.set("cc-find-current", now);
      }
      if (current && !scrolled) {
        scrolled = true;
        current.startContainer.parentElement?.scrollIntoView({ block: "center" });
      }
    };
    let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(paint)));
    const obs = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(paint);
    });
    obs.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      obs.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [open, q, index, texts, dataMatches, reveal, target]);

  useEffect(() => clear, []);

  const step = (d: number) => total && setCur((index + d + total) % total);

  if (!open)
    return (
      <button
        onClick={show}
        className="flex h-8 items-center gap-1.5 rounded-lg border border-foreground/10 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        title="Find in this request (⌘F / Ctrl+F)"
      >
        <Search className="size-3.5" /> Find
      </button>
    );

  return (
    <div className="flex h-8 items-center gap-1 rounded-lg border border-foreground/15 bg-background pr-1 pl-2 shadow-sm" role="search" data-find-skip>
      <style>{STYLE}</style>
      <Search className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        ref={input}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
        placeholder="Find in this request"
        aria-label="Find in this request"
        className="h-full w-28 min-w-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground sm:w-44"
      />
      <span className="shrink-0 px-1 text-[11px] text-muted-foreground tabular-nums" aria-live="polite">
        {q ? (total ? `${index + 1} of ${total >= MAX_MATCHES ? `${MAX_MATCHES}+` : total}` : "No matches") : ""}
      </span>
      <button onClick={() => step(-1)} disabled={!total} className="rounded p-1 text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground disabled:opacity-40" aria-label="Previous match">
        <ChevronUp className="size-3.5" />
      </button>
      <button onClick={() => step(1)} disabled={!total} className="rounded p-1 text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground disabled:opacity-40" aria-label="Next match">
        <ChevronDown className="size-3.5" />
      </button>
      <button onClick={close} className="rounded p-1 text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground" aria-label="Close find">
        <X className="size-3.5" />
      </button>
    </div>
  );
}
