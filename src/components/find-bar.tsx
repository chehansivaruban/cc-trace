"use client";

// Find in this request (⌘/Ctrl+F): match count, Enter / Shift+Enter for next / previous, Esc to close.
// Matches are painted with the CSS Custom Highlight API, so the page's DOM is never rewritten.
//
// One model for every list size: with `texts` (one string per `[data-find-row]`, from src/lib/find-text.ts)
// matches are counted in the data, so rows that are off screen or folded count too. Going to a match calls
// `reveal(row)` (scroll it in, unfold it), then the same match is found in the page: the k-th match in the
// data row is the k-th match in that row's text, read with the same block rules (joinPieces). Without
// `texts`, the page text under `target` is all there is.
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { findAll, joinPieces } from "@/lib/find-text";

const MAX_MATCHES = 5000;
const STYLE = `::highlight(cc-find){background-color:rgb(250 204 21/.35);color:inherit}::highlight(cc-find-current){background-color:rgb(249 115 22/.7);color:inherit}`;
// Elements whose text never runs into the next element's.
const BLOCK = new Set(["P", "DIV", "LI", "PRE", "TD", "TH", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "UL", "OL", "TABLE", "TR", "SECTION", "HEADER", "BUTTON", "LABEL"]);

type Registry = { set: (name: string, h: unknown) => void; delete: (name: string) => void };
const registry = (): Registry | undefined => (typeof CSS !== "undefined" && "highlights" in CSS ? (CSS.highlights as unknown as Registry) : undefined);
const makeHighlight = (ranges: Range[]) => (typeof Highlight === "function" ? new Highlight(...ranges) : undefined);

function clear() {
  const reg = registry();
  reg?.delete("cc-find");
  reg?.delete("cc-find-current");
}

function blockOf(node: Node, unit: Element): Element {
  for (let el = node.parentElement; el && el !== unit; el = el.parentElement) if (BLOCK.has(el.tagName) || el.hasAttribute("data-find-block")) return el;
  return unit;
}

/** Every match of `q` in one unit (a chat row, or the whole target), in order. */
function unitRanges(unit: Element, q: string): Range[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(unit, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (!n.nodeValue || n.parentElement?.closest("[data-find-skip],script,style") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  if (!nodes.length) return [];
  const { text, starts } = joinPieces(nodes.map((n) => ({ text: n.nodeValue ?? "", block: blockOf(n, unit) })));
  // The text node holding an offset; for an end offset, the node it closes.
  const at = (pos: number, end: boolean) => {
    let i = starts.length - 1;
    while (i > 0 && (end ? starts[i] >= pos : starts[i] > pos)) i--;
    return { node: nodes[i], offset: pos - starts[i] };
  };
  return findAll(text, q, MAX_MATCHES).map((i) => {
    const a = at(i, false);
    const b = at(i + q.length, true);
    const r = document.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
    return r;
  });
}

export function FindBar({
  target,
  texts,
  reveal,
}: {
  target: RefObject<HTMLElement | null>;
  /** One searchable text per `[data-find-row]` element, or a function returning them (only called while finding). */
  texts?: string[] | (() => string[]);
  /** Bring row `index` into the page and unfold it, so its match can be shown. */
  reveal?: (index: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim());
  const [cur, setCur] = useState(0);
  const [domCount, setDomCount] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => (open && q && texts ? (typeof texts === "function" ? texts() : texts) : undefined), [open, q, texts]);
  const dataMatches = useMemo(() => {
    if (!rows) return [];
    const out: { row: number; k: number }[] = [];
    rows.forEach((t, row) => findAll(t, q, MAX_MATCHES - out.length).forEach((_, k) => out.push({ row, k })));
    return out;
  }, [rows, q]);
  const dataMode = !!texts;
  const total = dataMode ? dataMatches.length : domCount;
  const index = total ? Math.min(cur, total - 1) : 0;

  const show = useCallback(() => {
    setOpen(true);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
  }, []);
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
  }, [target, show]);

  useEffect(() => setCur(0), [q]);

  // Paint every match in the page, mark the current one, keep painting as rows mount or unfold.
  useEffect(() => {
    const root = target.current;
    if (!open || !q || !root) {
      clear();
      setDomCount(0);
      return;
    }
    const m = dataMode ? dataMatches[index] : undefined;
    if (m) reveal?.(m.row);
    let scrollPending = true;
    const paint = () => {
      const units = root.querySelectorAll("[data-find-row]");
      const all: Range[] = [];
      let current: Range | undefined;
      for (const unit of units.length ? [...units] : [root]) {
        const ranges = unitRanges(unit, q);
        if (m && unit.getAttribute("data-find-row") === String(m.row)) current = ranges[Math.min(m.k, ranges.length - 1)];
        all.push(...ranges);
      }
      if (!dataMode) {
        setDomCount(all.length);
        current = all[Math.min(index, all.length - 1)];
      }
      // A match inside folded text (a clamped message, hidden thinking): unfold it, then paint again.
      const fold = current?.startContainer.parentElement?.closest('[data-find-reveal="closed"]');
      if (fold) {
        fold.dispatchEvent(new CustomEvent("cc-find-reveal"));
        scrollPending = true;
      }
      const reg = registry();
      const others = makeHighlight(all.filter((r) => r !== current));
      const now = makeHighlight(current ? [current] : []);
      if (reg && others && now) {
        reg.set("cc-find", others);
        reg.set("cc-find-current", now);
      }
      if (current && !fold && scrollPending) {
        scrollPending = false;
        current.startContainer.parentElement?.scrollIntoView({ block: "center" });
      }
    };
    let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(paint)));
    const obs = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(paint);
    });
    obs.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden", "data-find-reveal"] });
    return () => {
      obs.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [open, q, index, dataMode, dataMatches, reveal, target]);

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
