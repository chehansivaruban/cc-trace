"use client";

// The app's keyboard map (SHORTCUTS in use-shortcuts.ts lists the same keys for the overlay and help).
import { SESSION_VIEW_IDS, type AppPage, type SessionView } from "@/lib/route";
import { useShortcuts } from "./use-shortcuts";

export type SessionShortcuts = {
  openPage: (page: Exclude<AppPage, "session">) => void;
  /** A session is open with at least one request. */
  onSession: boolean;
  view: SessionView;
  turnIndex: number;
  lastTurn: number;
  /** Shows request i in the current view (the Whole session view stays put and moves its highlight). */
  showTurn: (i: number) => void;
  setView: (v: SessionView) => void;
  /** -1: the newer session above in the list, +1: the older one below. */
  stepSession: (d: 1 | -1) => void;
  bookmark: () => void;
};

/**
 * `/`, `g d`, `g l` everywhere; on a session `1`–`7`, `j`/`k`, `g g`, `G`, `[`/`]` and `b`. The arrows move
 * between requests only on the Map, where they don't scroll anything; everywhere else they scroll as usual.
 * Escape is handled by useEscape (top-most layer first); `?` by useShortcuts itself.
 */
export function useSessionShortcuts(o: SessionShortcuts) {
  const map: Record<string, () => void> = {
    "/": () => o.openPage("search"),
    "g d": () => o.openPage("dashboard"),
    "g l": () => o.openPage("live"),
  };
  if (o.onSession) {
    SESSION_VIEW_IDS.forEach((v, i) => (map[String(i + 1)] = () => o.setView(v)));
    const next = () => o.turnIndex < o.lastTurn && o.showTurn(o.turnIndex + 1);
    const prev = () => o.turnIndex > 0 && o.showTurn(o.turnIndex - 1);
    Object.assign(map, {
      j: next,
      k: prev,
      "g g": () => o.showTurn(0),
      G: () => o.showTurn(o.lastTurn),
      "[": () => o.stepSession(-1),
      "]": () => o.stepSession(1),
      b: o.bookmark,
    });
    if (o.view === "map") Object.assign(map, { ArrowDown: next, ArrowUp: prev });
  }
  useShortcuts(map);
}
