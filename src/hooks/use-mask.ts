"use client";

import { useCallback, useMemo } from "react";
import { homeOf, maskShortened } from "@/lib/export/common";
import type { SessionModel } from "@/lib/session";
import { useSettings } from "@/lib/settings";

/**
 * Runs log text through maskSecrets when "Hide sensitive text" is on; otherwise returns it unchanged.
 * Text that was already shortened (ends in "…") loses its possibly half-cut last word first.
 */
export function useMask(model?: SessionModel): (text: string) => string {
  const [settings] = useSettings();
  const home = useMemo(() => (model ? homeOf(model) : undefined), [model]);
  const on = settings.maskSensitive;
  return useCallback((text: string) => (on ? maskShortened(text, home) : text), [on, home]);
}
