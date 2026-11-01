"use client";

// Bash / PowerShell: the command, what it printed and how it ended. (Claude's own note about it is in the step's plain-English text.)
import { bashOutcome } from "@/lib/conversation";
import type { Step } from "@/lib/session";
import { CodeBlock } from "../code-block";
import { Pill, asText, type Json } from "./shared";

export function BashView({ step }: { step: Step }) {
  const input = (step.input ?? {}) as Json;
  const o = bashOutcome(step);
  const shell = step.tool === "PowerShell" ? "powershell" : "shell";
  return (
    <div className="space-y-2.5">
      <CodeBlock label="Command" value={asText(input.command) || JSON.stringify(input)} lang={shell} />
      <div className="flex flex-wrap gap-1.5">
        {o.interrupted ? (
          <Pill tone="warn">Stopped before it finished</Pill>
        ) : o.exitCode === 0 ? (
          <Pill tone="ok" title="Exit code 0">Finished without errors</Pill>
        ) : o.exitCode !== undefined ? (
          <Pill tone="bad" title={o.note}>Ended with an error (exit code {o.exitCode})</Pill>
        ) : step.status === "running" ? (
          <Pill tone="info">Still running</Pill>
        ) : null}
        {o.background && <Pill tone="info">Runs in the background</Pill>}
        {o.note && o.exitCode !== 0 && !/exit code/i.test(o.note) && <Pill>{o.note}</Pill>}
        {input.run_in_background === true && !o.background && <Pill tone="info">Started in the background</Pill>}
      </div>
      {o.stdout.trim() && <CodeBlock label="What it printed" value={o.stdout.replace(/\s+$/, "")} />}
      {o.stderr.trim() && <CodeBlock label="Warnings and errors it printed" value={o.stderr.replace(/\s+$/, "")} />}
      {!o.stdout.trim() && !o.stderr.trim() && step.status !== "running" && <p className="text-xs text-muted-foreground">It printed nothing.</p>}
    </div>
  );
}
