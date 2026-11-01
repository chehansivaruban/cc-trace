"use client";

import { useCallback, useMemo } from "react";
import { homeOf } from "@/lib/export/common";
import { maskSecrets } from "@/lib/redact";
import type { SessionModel } from "@/lib/session";
import { useSettings } from "@/lib/settings";

/** Runs log text through maskSecrets when "Hide sensitive text" is on; otherwise returns it unchanged. */
export function useMask(model?: SessionModel): (text: string) => string {
  const [settings] = useSettings();
  const home = useMemo(() => (model ? homeOf(model) : undefined), [model]);
  const on = settings.maskSensitive;
  return useCallback((text: string) => (on ? maskSecrets(text, home) : text), [on, home]);
}
