// The viewer's preferences, kept in this browser's localStorage under `cc-trace:settings`.
// One shared store: every `useSettings()` caller sees a change at once, other tabs via the `storage` event.
// Storage can be missing or throw (private window, blocked site data): the app then runs on defaults.
import { useCallback, useSyncExternalStore } from "react";

export type Settings = {
  theme: "system" | "light" | "dark";
  textScale: 0.9 | 1 | 1.15 | 1.3;
  showTechnical: boolean;
  maskSensitive: boolean;
  notifications: boolean;
  reduceMotion: boolean;
};

export const SETTINGS_KEY = "cc-trace:settings";

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  textScale: 1,
  showTechnical: false,
  maskSensitive: false,
  notifications: false,
  reduceMotion: false,
};

const THEMES: Settings["theme"][] = ["system", "light", "dark"];
const SCALES: Settings["textScale"][] = [0.9, 1, 1.15, 1.3];
const FLAGS = ["showTechnical", "maskSensitive", "notifications", "reduceMotion"] as const;

/** Turns stored JSON into valid settings: unknown or bad values fall back to the defaults. */
export function parseSettings(raw: string | null | undefined): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (!raw) return out;
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!v || typeof v !== "object") return out;
  if (THEMES.includes(v.theme as Settings["theme"])) out.theme = v.theme as Settings["theme"];
  if (SCALES.includes(v.textScale as Settings["textScale"])) out.textScale = v.textScale as Settings["textScale"];
  for (const k of FLAGS) if (typeof v[k] === "boolean") out[k] = v[k] as boolean;
  return out;
}

let current: Settings | null = null;
const listeners = new Set<() => void>();

function read(): Settings {
  if (current) return current;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(SETTINGS_KEY);
  } catch {
    // storage blocked: defaults
  }
  current = parseSettings(raw);
  return current;
}

function emit() {
  for (const l of listeners) l();
}

function onStorage(e: StorageEvent) {
  if (e.key !== null && e.key !== SETTINGS_KEY) return;
  current = null; // another tab changed it (or cleared storage): re-read
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

const getServerSettings = () => DEFAULT_SETTINGS;

export function updateSettings(patch: Partial<Settings>) {
  current = parseSettings(JSON.stringify({ ...read(), ...patch }));
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
  } catch {
    // storage blocked: the change lasts until the page is closed
  }
  emit();
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const settings = useSyncExternalStore(subscribe, read, getServerSettings);
  const update = useCallback((patch: Partial<Settings>) => updateSettings(patch), []);
  return [settings, update];
}
