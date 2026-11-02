"use client";

// TodoWrite and friends: Claude's checklist for the job, with each item's state.
import { Circle, CircleCheck, CircleDot } from "lucide-react";
import { todoItems } from "@/lib/conversation";
import { useMask } from "@/hooks/use-mask";
import type { Step } from "@/lib/session";
import { cn } from "@/lib/utils";
import { Pill, asText, type Json } from "./shared";

const STATUS: Record<string, string> = { pending: "to do", in_progress: "in progress", completed: "done", deleted: "removed" };

export function TodoView({ step }: { step: Step }) {
  const mask = useMask();
  const input = (step.input ?? {}) as Json;
  const items = todoItems(input);
  if (!items.length) {
    // TaskCreate / TaskUpdate / advancing a plan: one change, not a whole list.
    const subject = asText(input.subject) || asText(input.description);
    const status = asText(input.status);
    return (
      <div className="space-y-1.5 text-[13px]">
        {subject && <p className="break-words">{mask(subject)}</p>}
        {input.taskId !== undefined && (
          <p data-find-skip className="text-muted-foreground">
            Task #{mask(String(input.taskId))}
          </p>
        )}
        {status && <Pill tone={status === "completed" ? "ok" : status === "in_progress" ? "info" : "muted"}>Now {STATUS[status] ?? status}</Pill>}
        {input.advance === true && (
          <p data-find-skip className="text-muted-foreground">
            Moved on to the next step of the plan.
          </p>
        )}
        {!subject && !status && input.advance !== true && (
          <p data-find-skip className="text-muted-foreground">
            Updated its checklist.
          </p>
        )}
      </div>
    );
  }
  const done = items.filter((i) => i.status === "completed").length;
  return (
    <div className="space-y-2">
      <p data-find-skip className="text-xs text-muted-foreground">
        {done} of {items.length} done
      </p>
      <ul className="space-y-1">
        {items.map((it, i) => {
          const Icon = it.status === "completed" ? CircleCheck : it.status === "in_progress" ? CircleDot : Circle;
          return (
            <li key={i} className="flex gap-2 text-[13px]">
              <Icon
                className={cn("mt-0.5 size-4 shrink-0", it.status === "completed" ? "text-emerald-500" : it.status === "in_progress" ? "text-sky-500" : "text-muted-foreground/60")}
                aria-label={STATUS[it.status] ?? it.status}
              />
              <span className={cn("min-w-0 break-words", it.status === "completed" && "text-muted-foreground line-through decoration-foreground/30")}>{mask(it.text)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
