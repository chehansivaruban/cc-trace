"use client";

// AskUserQuestion: the questions Claude asked you, the options it offered and what you picked.
import { Check } from "lucide-react";
import { questionData } from "@/lib/conversation";
import { useMask } from "@/hooks/use-mask";
import type { Step } from "@/lib/session";
import { cn } from "@/lib/utils";
import { Pill } from "./shared";

export function QuestionView({ step }: { step: Step }) {
  const mask = useMask();
  const { questions, answered, out } = questionData(step);
  return (
    <div className="space-y-3">
      {questions.map((q, i) => (
        <div key={i} className="rounded-xl border border-foreground/10 p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {q.header && <Pill>{mask(q.header)}</Pill>}
            {q.multi && (
              <span data-find-skip className="text-[11px] text-muted-foreground">
                more than one answer allowed
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[13px] font-medium break-words">{mask(q.question)}</p>
          {q.options.length > 0 && (
            <ul className="mt-2 space-y-1">
              {q.options.map((o, j) => (
                <li key={j} className={cn("flex gap-2 rounded-lg px-2 py-1.5 text-[13px]", o.chosen ? "bg-emerald-500/10" : "bg-foreground/[0.03]")}>
                  <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border", o.chosen ? "border-emerald-500 bg-emerald-500 text-white" : "border-foreground/20")}>
                    {o.chosen && <Check className="size-3" />}
                  </span>
                  <span className="min-w-0">
                    <span className={cn("break-words", o.chosen && "font-medium")}>{mask(o.label)}</span>
                    {o.description && (
                      <span data-find-block className="block text-xs break-words text-muted-foreground">
                        {mask(o.description)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {q.other.length > 0 && (
            <p className="mt-2 text-[13px] break-words">
              <span data-find-skip className="text-muted-foreground">
                Your own answer:{" "}
              </span>
              {mask(q.other.join(", "))}
            </p>
          )}
        </div>
      ))}
      {step.status === "running" ? (
        <Pill tone="info">Waiting for your answer</Pill>
      ) : step.status === "error" ? (
        <Pill tone="bad">{/declin|reject|doesn't want/i.test(out) ? "You didn't answer" : "No answer came back"}</Pill>
      ) : !answered && out ? (
        <p className="text-[13px] break-words text-muted-foreground">{mask(out)}</p>
      ) : null}
    </div>
  );
}
