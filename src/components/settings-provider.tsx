"use client";

// Makes Settings take effect app-wide: theme, text size and reduce motion on <html>, and framer-motion's
// reduced-motion mode. layout.tsx applies the same values before paint; this keeps them in sync afterwards.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { MotionConfig } from "framer-motion";
import { LEGACY_THEME_KEY, resolveTheme, useSettings } from "@/lib/settings";

const DARK_QUERY = "(prefers-color-scheme: dark)";
const MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function useMedia(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

function legacyTheme() {
  try {
    return window.localStorage.getItem(LEGACY_THEME_KEY);
  } catch {
    return null;
  }
}

/** True while the page shows the dark theme (follows the `dark` class on <html>). */
export function useDarkMode() {
  return useSyncExternalStore(
    (cb) => {
      const obs = new MutationObserver(cb);
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      return () => obs.disconnect();
    },
    () => document.documentElement.classList.contains("dark"),
    () => true,
  );
}

/** True when motion should be reduced: the Settings switch or the system's own setting. */
export function useReducedMotion() {
  const [settings] = useSettings();
  return useMedia(MOTION_QUERY) || settings.reduceMotion;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings] = useSettings();
  const systemDark = useMedia(DARK_QUERY);
  const reduce = useReducedMotion();
  // The first (hydration) render sees default settings; the pre-paint script already applied the real ones.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    if (settings.theme !== "system") {
      // A theme chosen in Settings replaces the 0.1 header toggle's.
      try {
        window.localStorage.removeItem(LEGACY_THEME_KEY);
      } catch {
        // storage blocked
      }
    }
    root.classList.toggle("dark", resolveTheme(settings.theme, legacyTheme(), systemDark) === "dark");
  }, [ready, settings.theme, systemDark]);

  useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    if (settings.textScale === 1) root.style.removeProperty("--text-scale");
    else root.style.setProperty("--text-scale", String(settings.textScale));
  }, [ready, settings.textScale]);

  useEffect(() => {
    if (ready) document.documentElement.toggleAttribute("data-reduce-motion", reduce);
  }, [ready, reduce]);

  return <MotionConfig reducedMotion={reduce ? "always" : "never"}>{children}</MotionConfig>;
}
