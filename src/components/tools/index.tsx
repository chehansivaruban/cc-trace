"use client";

// One renderer per tool family, shared by the Conversation view and the step details panel.
import { useState, type ComponentType } from "react";
import { ChevronRight } from "lucide-react";
import type { Step } from "@/lib/session";
import { cn } from "@/lib/utils";
import { CodeBlock } from "../code-block";
import { BashView } from "./bash";
import { EditView } from "./edit";
import { GenericView } from "./generic";
import { ImageList } from "./image";
import { QuestionView } from "./question";
import { ReadView } from "./read";
import { SearchView } from "./search";
import { TodoView } from "./todo";
import { WebView } from "./web";
import { WriteView } from "./write";

const RENDERERS: Record<string, ComponentType<{ step: Step }>> = {
  Edit: EditView,
  MultiEdit: EditView,
  NotebookEdit: EditView,
  Write: WriteView,
  Read: ReadView,
  Bash: BashView,
  bash: BashView,
  PowerShell: BashView,
  Grep: SearchView,
  Glob: SearchView,
  WebFetch: WebView,
  WebSearch: WebView,
  AskUserQuestion: QuestionView,
  TodoWrite: TodoView,
  TaskCreate: TodoView,
  TaskUpdate: TodoView,
  mcp__ccd_turn__update_plan: TodoView,
};
// Renderers that say for themselves that no result came back yet.
const OWN_PENDING = new Set(["Bash", "bash", "PowerShell", "AskUserQuestion"]);
// Renderers that show the step's images themselves.
const OWN_IMAGES = new Set<ComponentType<{ step: Step }>>([ReadView]);

/** Picks the renderer for `step.tool`; anything unknown gets the generic view (raw input and output). */
export function ToolRenderer({ step }: { step: Step }) {
  const [raw, setRaw] = useState(false);
  const View = step.tool ? RENDERERS[step.tool] ?? GenericView : undefined;
  const rich = !!View && View !== GenericView;
  return (
    <div className="min-w-0 space-y-3">
      {View && <View step={step} />}
      {step.tool && step.output === undefined && !OWN_PENDING.has(step.tool) && (
        <p data-find-skip className="text-xs text-muted-foreground">
          No result yet.
        </p>
      )}
      {step.images?.length && !(View && OWN_IMAGES.has(View)) ? <ImageList images={step.images} /> : null}
      {rich && (step.input !== undefined || step.output !== undefined) && (
        <div data-find-skip>
          <button onClick={() => setRaw(!raw)} className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground" aria-expanded={raw}>
            <ChevronRight className={cn("size-3 transition-transform", raw && "rotate-90")} />
            {raw ? "Hide" : "Show"} the raw data
          </button>
          {raw && (
            <div className="mt-2 space-y-2">
              {step.input !== undefined && <CodeBlock label="What Claude sent" value={step.input} />}
              {step.output !== undefined && <CodeBlock label="What came back" value={step.output} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
