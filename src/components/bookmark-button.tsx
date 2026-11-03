"use client";

import { Bookmark, BookmarkCheck } from "lucide-react";
import { useStoreMask } from "@/hooks/use-mask";
import { useBookmarks } from "@/lib/bookmarks";
import { isDroppedFile } from "@/lib/paths";
import { cn } from "@/lib/utils";

/** Bookmarks (or un-bookmarks) a session, or a step in it when `step` is given. */
export function BookmarkButton(props: { file: string; step?: string; turn?: number; label: string; className?: string; showLabel?: boolean }) {
  const { has, toggle } = useBookmarks();
  const storeMask = useStoreMask();
  const on = has(props.file, props.step);
  const what = props.step ? "step" : "session";
  // A dropped file isn't in the Claude folder, so a bookmark could never open it again.
  if (isDroppedFile(props.file))
    return (
      <button
        disabled
        aria-label={`Can't bookmark this ${what}: it's from a dropped file`}
        title="Dropped files can't be bookmarked: they aren't in your Claude folder"
        className={cn("flex h-8 cursor-not-allowed items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground/50", props.className)}
      >
        <Bookmark className="size-4" />
        {props.showLabel && <span>Bookmark</span>}
      </button>
    );
  return (
    <button
      onClick={() => toggle({ file: props.file, step: props.step, turn: props.turn, label: props.label }, storeMask)}
      aria-pressed={on}
      aria-label={on ? `Remove the bookmark on this ${what}` : `Bookmark this ${what}`}
      title={on ? "Bookmarked (b)" : "Bookmark (b)"}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs transition-[background-color,color,transform] duration-150 hover:bg-foreground/[0.07] active:scale-[0.97]",
        on ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground hover:text-foreground",
        props.className,
      )}
    >
      {on ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
      {props.showLabel && <span>{on ? "Bookmarked" : "Bookmark"}</span>}
    </button>
  );
}
