"use client";

// AskUserQuestion: the questions Claude asked you, the options it offered and what you picked.
import { Check } from "lucide-react";
import { outputText } from "@/lib/conversation";
import { useMask } from "@/lib/mask";
import type { Step } from "@/lib/session";
import { cn } from "@/lib/utils";
import { Pill, asText, type Json } from "./shared";

/** Answers from the structured result, or from the text Claude saw: "question"="answer", … */
function answersOf(step: Step): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const a = (step.result as Json)?.answers;
  if (a && typeof a === "object") {
    for (const [q, v] of Object.entries(a)) out[q] = (Array.isArray(v) ? v : [v]).map(String);
    return out;
  }
  for (const m of outputText(step.output).matchAll(/"([^"]+)"="([^"]*)"/g)) out[m[1]] = m[2].split(/,\s*/);
  return out;
}

export function QuestionView({ step }: { step: Step }) {
  const mask = useMask();
  const questions: Json[] = Array.isArray((step.input as Json)?.questions) ? (step.input as Json).questions : [];
  const answers = answersOf(step);
  const out = outputText(step.output);
  return (
    <div className="space-y-3">
      {questions.map((q, i) => {
        const question = asText(q?.question);
        const picked = answers[question] ?? [];
        const options: Json[] = Array.isArray(q?.options) ? q.options : [];
        const labels = options.map((o) => asText(o?.label));
        const other = picked.filter((p) => !labels.includes(p) && p);
        return (
          <div key={i} className="rounded-xl border border-foreground/10 p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {asText(q?.header) && <Pill>{mask(q.header)}</Pill>}
              {q?.multiSelect && <span className="text-[11px] text-muted-foreground">more than one answer allowed</span>}
            </div>
            <p className="mt-1.5 text-[13px] font-medium break-words">{mask(question)}</p>
            {options.length > 0 && (
              <ul className="mt-2 space-y-1">
                {options.map((o, j) => {
                  const chosen = picked.includes(labels[j]);
                  return (
                    <li key={j} className={cn("flex gap-2 rounded-lg px-2 py-1.5 text-[13px]", chosen ? "bg-emerald-500/10" : "bg-foreground/[0.03]")}>
                      <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border", chosen ? "border-emerald-500 bg-emerald-500 text-white" : "border-foreground/20")}>
                        {chosen && <Check className="size-3" />}
                      </span>
                      <span className="min-w-0">
                        <span className={cn("break-words", chosen && "font-medium")}>{mask(labels[j])}</span>
                        {asText(o?.description) && <span className="block text-xs break-words text-muted-foreground">{mask(o.description)}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {other.length > 0 && (
              <p className="mt-2 text-[13px] break-words">
                <span className="text-muted-foreground">Your own answer: </span>
                {mask(other.join(", "))}
              </p>
            )}
          </div>
        );
      })}
      {step.status === "running" ? (
        <Pill tone="info">Waiting for your answer</Pill>
      ) : step.status === "error" ? (
        <Pill tone="bad">{/declin|reject|doesn't want/i.test(out) ? "You didn't answer" : "No answer came back"}</Pill>
      ) : !Object.keys(answers).length && out ? (
        <p className="text-[13px] break-words text-muted-foreground">{mask(out)}</p>
      ) : null}
    </div>
  );
}
