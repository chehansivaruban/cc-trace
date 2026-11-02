"use client";

// Read: which file, which part of it, in what language, and what Claude saw.
import { langOf, readData } from "@/lib/conversation";
import type { Step } from "@/lib/session";
import { CodeBlock } from "../code-block";
import { ImageList } from "./image";
import { Facts, FilePath, Pill, fmt, plural } from "./shared";

export function ReadView({ step }: { step: Step }) {
  const { input, file, path, content, isImage } = readData(step);
  const lang = langOf(path);
  const start = Number(file.startLine ?? input.offset ?? 1) || 1;
  const count = typeof file.numLines === "number" ? file.numLines : undefined;
  const totalLines = typeof file.totalLines === "number" ? file.totalLines : undefined;
  const part =
    count !== undefined && totalLines !== undefined && count < totalLines
      ? `lines ${fmt(start)}–${fmt(start + Math.max(count, 1) - 1)} of ${fmt(totalLines)}`
      : totalLines !== undefined
        ? `the whole file · ${plural(totalLines, "line")}`
        : input.offset || input.limit
          ? `from line ${fmt(Number(input.offset) || 1)}${input.limit ? `, up to ${plural(Number(input.limit), "line")}` : ""}`
          : null;
  return (
    <div className="space-y-2.5">
      <FilePath path={path} />
      <Facts items={[part, typeof input.pages === "string" ? `pages ${input.pages}` : null, lang]} />
      {step.status === "error" && <Pill tone="bad">Couldn&apos;t read it</Pill>}
      {step.images?.length ? <ImageList images={step.images} /> : null}
      {!isImage && content && (step.status === "error" ? <CodeBlock label="What came back" value={content} /> : <CodeBlock label="What Claude saw" value={content} lang={lang} />)}
    </div>
  );
}
