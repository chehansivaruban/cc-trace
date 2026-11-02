"use client";

// Edit / MultiEdit / NotebookEdit: a red/green diff with the changed words highlighted.
import { useMemo, useState } from "react";
import { CAPS, diffRows, maskLines, stepDiff, type EditDiff, type WordSegment } from "@/lib/conversation";
import { useMask } from "@/lib/mask";
import type { Step } from "@/lib/session";
import { cn } from "@/lib/utils";
import { Facts, FilePath, Pill, fmt, type Json } from "./shared";

function Words({ words }: { words: WordSegment[] }) {
  return (
    <>
      {words.map((w, i) =>
        w.type === "same" ? (
          <span key={i}>{w.text}</span>
        ) : (
          <mark key={i} className={cn("rounded-[3px] text-inherit", w.type === "removed" ? "bg-red-500/30" : "bg-emerald-500/30")}>
            {w.text}
          </mark>
        ),
      )}
    </>
  );
}

/** Every hunk of a change, line by line: removed in red, added in green, the changed words marked. */
export function DiffView({ diff }: { diff: EditDiff }) {
  const mask = useMask();
  const [all, setAll] = useState(false);
  const total = useMemo(() => diff.hunks.reduce((n, h) => n + h.lines.filter((l) => !l.startsWith("\\")).length, 0), [diff]);
  // Rows (and their word diffs) only for what's shown. Masking runs over each hunk's whole text, so a secret
  // spread over several lines (a private key) is caught; a line that changed under masking loses its word marks.
  const hunks = useMemo(() => {
    let budget = all ? Infinity : CAPS.diffRows;
    const out = [];
    for (const h of diff.hunks) {
      if (budget <= 0) break;
      const rows = diffRows(h, budget);
      budget -= rows.length;
      const masked = maskLines(rows.map((r) => r.text), mask);
      out.push({ h, rows: rows.map((r, i) => ({ ...r, shown: masked[i], words: masked[i] === r.text ? r.words : undefined })) });
    }
    return out;
  }, [diff, all, mask]);
  return (
    <div className="overflow-hidden rounded-xl border border-foreground/10 font-mono text-[12px] leading-[1.55]">
      {hunks.map(({ h, rows }, hi) => (
        <div key={hi} className={cn(hi > 0 && "border-t border-foreground/10")}>
          <div data-find-skip className="bg-foreground/[0.04] px-3 py-1 font-sans text-[11px] text-muted-foreground">
            {diff.fromLog ? `Around line ${fmt(h.newStart || h.oldStart)}` : diff.hunks.length > 1 ? `Change ${hi + 1}` : "The change"}
          </div>
          {rows.map((r, i) => (
            <div key={i} className={cn("flex min-w-0", r.type === "removed" && "bg-red-500/[0.09]", r.type === "added" && "bg-emerald-500/[0.09]")}>
              {diff.fromLog && (
                <span data-find-skip className="w-10 shrink-0 pr-1.5 text-right text-muted-foreground/60 tabular-nums select-none" aria-hidden>
                  {r.type === "added" ? r.newNo : r.oldNo}
                </span>
              )}
              <span
                data-find-skip
                className={cn("w-5 shrink-0 text-center select-none", r.type === "removed" ? "text-red-600 dark:text-red-400" : r.type === "added" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground/40")}
                aria-label={r.type === "removed" ? "removed" : r.type === "added" ? "added" : undefined}
              >
                {r.type === "removed" ? "−" : r.type === "added" ? "+" : " "}
              </span>
              <span className="min-w-0 flex-1 pr-3 break-words whitespace-pre-wrap">{r.words ? <Words words={r.words} /> : r.shown || " "}</span>
            </div>
          ))}
        </div>
      ))}
      {!all && total > CAPS.diffRows && (
        <button data-find-skip onClick={() => setAll(true)} className="w-full border-t border-foreground/10 px-3 py-1.5 text-left font-sans text-xs text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground">
          Show all {fmt(total)} lines
        </button>
      )}
    </div>
  );
}

export function EditView({ step }: { step: Step }) {
  const input = (step.input ?? {}) as Json;
  const diff = useMemo(() => stepDiff(step), [step]);
  return (
    <div className="space-y-2.5">
      <FilePath path={input.file_path ?? input.notebook_path} />
      {diff && (
        <Facts
          items={[
            <span key="a" className="text-emerald-700 dark:text-emerald-400">+{fmt(diff.added)} added</span>,
            <span key="r" className="text-red-700 dark:text-red-400">−{fmt(diff.removed)} removed</span>,
            input.replace_all ? "every match was changed" : null,
            step.tool === "MultiEdit" && Array.isArray(input.edits) ? `${input.edits.length} edits in one go` : null,
          ]}
        />
      )}
      {step.status === "error" && <Pill tone="bad">This change didn&apos;t go through</Pill>}
      {diff ? (
        <>
          <DiffView diff={diff} />
          {!diff.fromLog && (
            <p data-find-skip className="text-[11px] text-muted-foreground">
              Line numbers aren&apos;t in the log for this change, so this compares the replaced text only.
            </p>
          )}
        </>
      ) : (
        <p data-find-skip className="text-xs text-muted-foreground">No before-and-after text was recorded for this change.</p>
      )}
    </div>
  );
}
