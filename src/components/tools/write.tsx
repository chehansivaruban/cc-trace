"use client";

// Write: a whole file written in one go. New files show their contents; replaced files show what changed.
import { editDiff, langOf } from "@/lib/conversation";
import type { Step } from "@/lib/session";
import { CodeBlock } from "../code-block";
import { DiffView } from "./edit";
import { Facts, FilePath, Pill, asText, plural, type Json } from "./shared";

export function WriteView({ step }: { step: Step }) {
  const input = (step.input ?? {}) as Json;
  const result = step.result as Json;
  const content = asText(input.content);
  const lines = content ? content.split("\n").length : 0;
  const lang = langOf(input.file_path);
  const created = result?.type === "create";
  const replaced = result?.type === "update";
  const diff = replaced ? editDiff("Write", input, result) : undefined;
  return (
    <div className="space-y-2.5">
      <FilePath path={input.file_path} />
      <Facts
        items={[
          created ? <Pill key="n" tone="ok">New file</Pill> : replaced ? <Pill key="r" tone="warn">Replaced the whole file</Pill> : null,
          plural(lines, "line"),
          lang,
        ]}
      />
      {step.status === "error" && <Pill tone="bad">The file wasn&apos;t written</Pill>}
      {diff ? <DiffView diff={diff} /> : content ? <CodeBlock label={created ? "The new file" : "What was written"} value={content} lang={lang} /> : null}
    </div>
  );
}
