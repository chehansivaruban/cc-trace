"use client";

// Images in your messages or tool results (screenshots, pasted pictures). They're in the log as base64
// and shown from data: URLs: nothing is ever fetched. With "Hide sensitive text" on they're hidden: a
// screenshot can show anything.
import { useState } from "react";
import { EyeOff } from "lucide-react";
import type { Step } from "@/lib/session";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

const SAFE = /^image\/(png|jpe?g|gif|webp)$/i;
const MAX_BASE64 = 12_000_000; // about 9 MB of image

export function ImageList({ images }: { images: NonNullable<Step["images"]> }) {
  const [settings] = useSettings();
  const [open, setOpen] = useState<number | null>(null);
  if (settings.maskSensitive)
    return (
      <span data-find-skip className="inline-flex items-center gap-1.5 rounded-lg bg-foreground/[0.06] px-2.5 py-1.5 text-xs text-muted-foreground">
        <EyeOff className="size-3.5" /> {images.length === 1 ? "Image hidden" : `${images.length} images hidden`} (Hide sensitive text is on)
      </span>
    );
  return (
    <div data-find-skip className="flex flex-wrap gap-2">
      {images.map((img, i) =>
        !SAFE.test(img.mediaType) || img.data.length > MAX_BASE64 ? (
          <span key={i} className="rounded-lg bg-foreground/[0.06] px-2.5 py-1.5 text-xs text-muted-foreground">
            An image ({img.mediaType}) that can&apos;t be shown here
          </span>
        ) : (
          <button
            key={i}
            onClick={() => setOpen(open === i ? null : i)}
            className={cn("overflow-hidden rounded-lg border border-foreground/10 bg-foreground/[0.03]", open === i ? "w-full" : "")}
            aria-label={open === i ? "Show smaller" : "Show bigger"}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a local data: URL, nothing to optimise */}
            <img
              src={`data:${img.mediaType};base64,${img.data}`}
              alt={`Image ${i + 1}`}
              className={cn("block object-contain", open === i ? "max-h-[70vh] w-full" : "max-h-40 max-w-[240px]")}
              loading="lazy"
            />
          </button>
        ),
      )}
    </div>
  );
}
