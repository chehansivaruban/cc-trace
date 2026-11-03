"use client";

// "Hide sensitive text" for everything the page shows. The rules live in lib/redact.ts; this hook picks
// the right masker for the current settings and session. User names are learned only from trusted places:
// the server's home folder (/api/folders) and the open session's working folders, never from log text.
import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import { useFolders } from "@/hooks/use-folders";
import { createMasker, homeFromCwds, userNamesFrom, type Masker } from "@/lib/redact";
import { useSettings } from "@/lib/settings";

type Scope = { home?: string; key: string; mask: Masker };
const keyOf = (cwds: readonly string[]) => cwds.join("\n");
/** The full masker for a session: the home folder (the server's, else guessed) and the user names it shows. */
export const sessionMasker = (home: string | undefined, cwds: readonly string[]) =>
  createMasker({ home: home ?? homeFromCwds(cwds), names: userNamesFrom([home, ...cwds]) });

// Outside a MaskScope (nothing open yet): secrets and home folders by their shape, no user names.
const MaskScopeContext = createContext<Scope>({ key: "", mask: sessionMasker(undefined, []) });
const same: Masker = (text) => text;

/**
 * Says which session is open and builds its masker once, so every component below shares it. Rendered once
 * around the page: when the session's folders change, the names change with them.
 */
export function MaskScope({ cwds, children }: { cwds: readonly string[]; children: ReactNode }) {
  const home = useFolders()?.home;
  const key = keyOf(cwds);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for the folders' contents
  const value = useMemo<Scope>(() => ({ home, key, mask: sessionMasker(home, cwds) }), [home, key]);
  return createElement(MaskScopeContext.Provider, { value }, children);
}

/**
 * The function every log-derived string goes through before it's shown: masks when "Hide sensitive text"
 * is on, else returns the text unchanged. Pass `model` to mask with a session other than the open one
 * (e.g. the two sides of Compare); the open session's shared masker is reused when it's the same one.
 */
export function useMask(model?: { meta?: { cwds?: readonly string[] } }): Masker {
  const [settings] = useSettings();
  const scope = useContext(MaskScopeContext);
  const cwds = model?.meta?.cwds;
  const key = cwds ? keyOf(cwds) : scope.key;
  const own = useMemo(
    () => (key === scope.key ? scope.mask : sessionMasker(scope.home, cwds ?? [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for the folders' contents
    [key, scope],
  );
  return settings.maskSensitive ? own : same;
}

/**
 * The open session's full masker, whatever "Hide sensitive text" says: for text that is stored (bookmark
 * labels), which must never keep secrets, home folders or user names.
 */
export function useStoreMask(): Masker {
  return useContext(MaskScopeContext).mask;
}
