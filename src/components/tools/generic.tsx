"use client";

// Everything else: helper briefs and messages as text, connectors by name, and the raw data for the rest.
import { mcpLabel, outputText } from "@/lib/conversation";
import type { Step } from "@/lib/session";
import { CodeBlock } from "../code-block";
import { Markdown } from "../markdown";
import { Facts, Label, Pill, asText, type Json } from "./shared";

function Message({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <Label>{title}</Label>
      <div className="max-h-96 overflow-auto rounded-xl border border-foreground/10 px-3 py-2.5">
        <Markdown text={text} />
      </div>
    </div>
  );
}

export function GenericView({ step }: { step: Step }) {
  const input = step.input as Json;
  const out = outputText(step.output);
  const mcp = mcpLabel(step.tool);
  if (step.tool === "Agent" || step.tool === "Task") {
    return (
      <div className="space-y-3">
        <Facts items={[asText(input?.subagent_type), asText(input?.model), input?.run_in_background ? "works in the background" : null]} />
        {asText(input?.prompt) && <Message title="The brief" text={input.prompt} />}
        {out && <Message title="What came back" text={out} />}
      </div>
    );
  }
  if (step.tool === "SendMessage" || step.tool === "SubagentHandback") {
    const msg = typeof input?.message === "string" ? input.message : outputText(input?.message);
    return (
      <div className="space-y-3">
        {msg && <Message title={step.tool === "SendMessage" ? `Message${input?.to ? ` to ${input.to}` : ""}` : "The report"} text={msg} />}
        {out && step.tool === "SendMessage" && <Message title="What came back" text={out} />}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {mcp && (
        <p className="text-[13px]">
          Used the <b>{mcp.server || "unnamed"}</b> connector to <b>{mcp.tool}</b>.
        </p>
      )}
      {step.status === "error" && <Pill tone="bad">This didn&apos;t work</Pill>}
      {input !== undefined && <CodeBlock label="What Claude sent" value={input} />}
      {step.output !== undefined ? <CodeBlock label="What came back" value={out || step.output} /> : step.status === "running" ? <p className="text-xs text-muted-foreground">No result yet.</p> : null}
    </div>
  );
}
