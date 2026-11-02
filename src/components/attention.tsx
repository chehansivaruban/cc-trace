"use client";

// "Claude needs you" (G1): tab title and favicon change, an optional desktop notification, and a badge.
import { useEffect, useMemo, useRef } from "react";
import { BellRing } from "lucide-react";
import { ATTENTION_TEXT, needsAttention } from "@/lib/attention";
import type { SessionModel } from "@/lib/session";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

const PREFIX = "● ";
const ALERT_ICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#171717"/><circle cx="16" cy="16" r="9" fill="#f59e0b"/></svg>`,
  );

function useAttention(model: SessionModel) {
  return useMemo(() => needsAttention(model), [model]);
}

/**
 * Watches the open session. While Claude waits on you the tab title starts with "● " and the favicon turns
 * amber. With Settings → Desktop notifications on (and allowed), a notification is shown once per wait,
 * only when cc-trace isn't the focused window. The notification never includes text from the log.
 */
export function AttentionWatcher({ model }: { model: SessionModel }) {
  const [settings] = useSettings();
  const attention = useAttention(model);
  const key = attention ? `${attention.reason}:${attention.step?.id ?? ""}` : "";
  const notified = useRef("");

  useEffect(() => {
    if (!key) return;
    const strip = () => document.title.replace(/^● /, "");
    document.title = PREFIX + strip();
    const icons = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')];
    const before = icons.map((l) => l.href);
    let added: HTMLLinkElement | undefined;
    if (icons.length) for (const l of icons) l.href = ALERT_ICON;
    else {
      added = Object.assign(document.createElement("link"), { rel: "icon", href: ALERT_ICON });
      document.head.appendChild(added);
    }
    return () => {
      document.title = strip();
      icons.forEach((l, i) => (l.href = before[i]));
      added?.remove();
    };
  }, [key]);

  useEffect(() => {
    if (!key || !attention || notified.current === key) return;
    notified.current = key;
    if (!settings.notifications || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if (document.hasFocus()) return;
    try {
      const n = new Notification("Claude needs you", { body: `${ATTENTION_TEXT[attention.reason]}. Open cc-trace to see it.`, tag: "cc-trace-attention" });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      // some browsers only allow notifications from a service worker
    }
  }, [key, attention, settings.notifications]);

  return null;
}

/** A small amber "needs you" pill for a session, or nothing. */
export function AttentionBadge({ model, className }: { model: SessionModel; className?: string }) {
  const attention = useAttention(model);
  if (!attention) return null;
  return (
    <span
      role="status"
      title={ATTENTION_TEXT[attention.reason]}
      className={cn("inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium whitespace-nowrap text-amber-700 dark:text-amber-300", className)}
    >
      <BellRing className="size-3.5" />
      {ATTENTION_TEXT[attention.reason]}
    </span>
  );
}
