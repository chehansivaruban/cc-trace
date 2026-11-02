"use client";

// Grep / Glob: what Claude looked for, where, and what turned up.
import { CAPS, searchData } from "@/lib/conversation";
import { useMask } from "@/hooks/use-mask";
import type { Step } from "@/lib/session";
import { CodeBlock } from "../code-block";
import { Facts, Pill, fmt, plural } from "./shared";

function FileList({ files }: { files: string[] }) {
  const mask = useMask();
  return (
    <ul className="max-h-72 overflow-auto rounded-xl bg-foreground/[0.04] px-3 py-2 font-mono text-[12px] leading-relaxed">
      {files.slice(0, CAPS.files).map((f, i) => (
        <li key={i} className="break-all">
          {mask(f)}
        </li>
      ))}
      {files.length > CAPS.files && (
        <li data-find-skip className="font-sans text-xs text-muted-foreground">
          …and {fmt(files.length - CAPS.files)} more
        </li>
      )}
    </ul>
  );
}

export function SearchView({ step }: { step: Step }) {
  const mask = useMask();
  const { input, result: r, pattern, files, content, text, count: n } = searchData(step);
  const grep = step.tool === "Grep";
  return (
    <div className="space-y-2.5">
      <p className="text-[13px]">
        <span data-find-skip>{grep ? "Searched inside files for " : "Looked for files named "}</span>
        <code className="rounded bg-foreground/[0.07] px-1 font-mono text-[12px] break-all">{mask(pattern)}</code>
      </p>
      <Facts
        items={[
          input.path ? <span key="p" className="break-all">in {mask(String(input.path))}</span> : null,
          input.glob ? `only ${mask(String(input.glob))}` : null,
          input.type ? `only ${mask(String(input.type))} files` : null,
          input["-i"] ? "ignoring upper/lower case" : null,
          input.output_mode === "content" ? "showing matching lines" : input.output_mode === "count" ? "counting matches" : null,
        ]}
      />
      {step.status === "error" ? (
        <Pill tone="bad">The search failed</Pill>
      ) : r ? (
        <Pill tone={n || content ? "ok" : "muted"}>
          {content ? (typeof r.numLines === "number" ? `${plural(r.numLines, "matching line")}` : "Found matches") : n ? `Found ${plural(n, "file")}` : "Nothing found"}
          {r.truncated ? " (list cut short)" : ""}
        </Pill>
      ) : null}
      {content ? <CodeBlock label="Matches" value={content} /> : files.length ? <FileList files={files} /> : text ? <CodeBlock label="What came back" value={text} /> : null}
    </div>
  );
}
