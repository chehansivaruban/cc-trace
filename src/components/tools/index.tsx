// Stub: Task 2 replaces this with a renderer per tool. Until then: the raw input and output.
import { CodeBlock } from "@/components/code-block";
import type { Step } from "@/lib/session";

export function ToolRenderer({ step }: { step: Step }) {
  return (
    <div className="space-y-2">
      {step.input !== undefined && <CodeBlock label="Input" value={step.input} />}
      {step.output !== undefined && <CodeBlock label="Output" value={step.output} />}
    </div>
  );
}
