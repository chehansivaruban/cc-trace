"use client";

import { useEffect, useRef } from "react";
import { useMask } from "@/hooks/use-mask";
import { safeClip } from "@/lib/redact";
import type { Actor, Turn } from "@/lib/session";
import { cn } from "@/lib/utils";

function ago(ms: number) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Every message you sent in this session; each one is a "request" with its own map. */
export function TurnList(props: { turns: Turn[]; actors: Record<string, Actor>; selectedIndex?: number; liveIndex?: number; onPick: (i: number) => void }) {
  const active = useRef<HTMLButtonElement>(null);
  const mask = useMask();
  useEffect(() => {
    active.current?.scrollIntoView({ block: "nearest" });
  }, [props.selectedIndex]);

  return (
    <nav className="flex h-full min-h-0 flex-col" aria-label="Your requests">
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-[13px] font-semibold">Your requests</h2>
        <p className="text-xs text-muted-foreground">Each message you sent, and what it set off.</p>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-4">
        {props.turns.map((t) => {
          const helpers = t.actors.filter((id) => props.actors[id]?.kind === "helper").length;
          const selected = t.index === props.selectedIndex;
          return (
            <button
              key={t.index}
              ref={selected ? active : undefined}
              onClick={() => props.onPick(t.index)}
              className={cn("w-full rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-foreground/[0.06]", selected && "bg-foreground/[0.08]")}
            >
              <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
                <span>#{t.index + 1}</span>
                {t.index === props.liveIndex && (
                  <span className="flex items-center gap-1 text-sky-500 dark:text-sky-300">
                    <span className="size-1.5 animate-pulse rounded-full bg-current" /> live
                  </span>
                )}
                <span className="ml-auto">{ago(t.ts)}</span>
              </div>
              <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug">{mask(safeClip(t.text, 400))}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t.steps.length} steps{helpers ? ` · ${helpers} helper${helpers === 1 ? "" : "s"}` : ""}
              </p>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
