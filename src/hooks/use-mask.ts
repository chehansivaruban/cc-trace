"use client";

// "Hide sensitive text" for everything the page shows. The rules live in lib/redact.ts; this hook picks
// the right masker for the current settings and session. User names are learned only from trusted places:
// the server's home folder (/api/folders) and the open session's working folders, never from log text.
import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import { useFolders } from "@/hooks/use-folders";
import { createMasker, homeFromCwds, userNamesFrom, type Masker } from "@/lib/redact";
import { useSettings } from "@/lib/settings";

type Scope = { home?: string; cwds: readonly string[] };
const MaskScopeContext = createContext<Scope>({ cwds: [] });
const same: Masker = (text) => text;

/**
 * Says which session is open, so every component below masks with that session's user names. Rendered
 * once around the page: when the session changes, the names change with it.
 */
export function MaskScope({ cwds, children }: { cwds: readonly string[]; children: ReactNode }) {
  const home = useFolders()?.home;
  const key = cwds.join("\n");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for the folders' contents
  const value = useMemo<Scope>(() => ({ home, cwds }), [home, key]);
  return createElement(MaskScopeContext.Provider, { value }, children);
}

/**
 * The function every log-derived string goes through before it's shown: masks when "Hide sensitive text"
 * is on, else returns the text unchanged. Pass `model` to mask with a session other than the open one
 * (e.g. the two sides of Compare).
 */
export function useMask(model?: { meta?: { cwds?: readonly string[] } }): Masker {
  const [settings] = useSettings();
  const scope = useContext(MaskScopeContext);
  const cwds = model ? (model.meta?.cwds ?? []) : scope.cwds;
  const home = scope.home;
  const key = cwds.join("\n");
  const mask = useMemo(
    () => createMasker({ home: home ?? homeFromCwds(cwds), names: userNamesFrom([home, ...cwds]) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for the folders' contents
    [home, key],
  );
  return settings.maskSensitive ? mask : same;
}
