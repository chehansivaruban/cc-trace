"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useFolders } from "@/hooks/use-folders";
import { exportFileName, exportJson, sessionMasker } from "@/lib/export/common";
import { exportHtml } from "@/lib/export/html";
import { exportMarkdown } from "@/lib/export/markdown";
import { SESSION_START, type SessionModel, type Turn } from "@/lib/session";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

type Format = "html" | "md" | "json";
const TYPES: Record<Format, string> = { html: "text/html", md: "text/markdown", json: "application/json" };

/** Saves a file made in this browser; nothing goes through the server or onto its disk. */
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const item = "gap-2 rounded-lg px-2.5 py-2 text-[0.8125rem]";

/** "Export" menu (H1): this request or the whole session as an offline web page, Markdown or raw JSON. */
export function ExportMenu({ model, turn, className }: { model: SessionModel; turn?: Turn; className?: string }) {
  const [settings] = useSettings();
  const home = useFolders()?.home;
  // Starts from the "Hide sensitive text" setting; can be changed for one export.
  const [maskPick, setMask] = useState<boolean | null>(null);
  const mask = maskPick ?? settings.maskSensitive;

  const [error, setError] = useState<string | null>(null);

  const save = (format: Format, which?: number) => {
    setError(null);
    try {
      const opts = { mask, turn: which, home };
      const text = format === "html" ? exportHtml(model, opts) : format === "md" ? exportMarkdown(model, opts) : exportJson(model, opts);
      const first = model.turns.find((t) => t.text !== SESSION_START)?.text ?? "";
      const title = sessionMasker(model, opts)(model.meta.customTitle ?? model.meta.aiTitle ?? first);
      download(exportFileName(title, which, format), text, TYPES[format]);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "The export couldn't be made. Please try again.");
    }
  };

  return (
    <span className="relative inline-flex">
      {error && (
        <span role="alert" className="absolute top-full right-0 z-10 mt-1.5 w-[16.25rem] rounded-lg border border-red-500/30 bg-background px-2.5 py-1.5 text-xs leading-relaxed text-red-700 shadow-lg dark:text-red-300">
          {error}
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-foreground/15 px-2.5 text-xs font-medium transition-colors hover:bg-foreground/[0.06] data-popup-open:bg-foreground/[0.06]",
            className,
          )}
        >
          <Download className="size-3.5" />
          Export
        </DropdownMenuTrigger>
        <DropdownMenuContent className="glass-strong w-[16.875rem] rounded-xl p-1.5 shadow-2xl shadow-black/40 ring-0" align="end" sideOffset={8}>
          <p className="px-2.5 pt-1.5 pb-2 text-xs leading-relaxed text-muted-foreground">Save a copy you can open without cc-trace or share. It&apos;s made in your browser.</p>
          {turn && (
            <>
              <DropdownMenuGroup>
                <DropdownMenuLabel className="px-2.5">Request {turn.index + 1}</DropdownMenuLabel>
                <DropdownMenuItem className={item} onClick={() => save("html", turn.index)}>
                  Web page (.html)
                </DropdownMenuItem>
                <DropdownMenuItem className={item} onClick={() => save("md", turn.index)}>
                  Markdown (.md)
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-2.5">Whole session</DropdownMenuLabel>
            <DropdownMenuItem className={item} onClick={() => save("html")}>
              Web page (.html)
            </DropdownMenuItem>
            <DropdownMenuItem className={item} onClick={() => save("md")}>
              Markdown (.md)
            </DropdownMenuItem>
            <DropdownMenuItem className={item} onClick={() => save("json")}>
              Raw data (.json)
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem className={item} checked={mask} onCheckedChange={(v) => setMask(!!v)} closeOnClick={false}>
            Hide sensitive text
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
