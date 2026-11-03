"use client";

import { useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { appear } from "@/lib/motion";
import { useReducedMotion } from "@/components/settings-provider";
import { FolderOpen, Keyboard, Map as MapIcon, X } from "lucide-react";
import { toggleShortcuts } from "@/hooks/use-shortcuts";
import { useEscape } from "@/hooks/use-escape";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useFolders } from "@/hooks/use-folders";
import { useMask } from "@/hooks/use-mask";
import { LEGACY_THEME_KEY, useSettings, type Settings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { startTour } from "../tour";

const THEMES: { value: Settings["theme"]; label: string }[] = [
  { value: "system", label: "Same as my computer" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];
const SIZES: { value: Settings["textScale"]; label: string }[] = [
  { value: 0.9, label: "Smaller" },
  { value: 1, label: "Normal" },
  { value: 1.15, label: "Larger" },
  { value: 1.3, label: "Largest" },
];
const DENSITIES: { value: Settings["density"]; label: string }[] = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
];
const button =
  "flex h-8 items-center gap-1.5 rounded-lg border border-foreground/15 px-3 text-xs font-medium transition-[background-color,transform] duration-150 hover:bg-foreground/[0.06] active:scale-[0.97]";

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const reduce = useReducedMotion();
  const [settings, update] = useSettings();
  const folders = useFolders();
  const [notice, setNotice] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(open, panel);

  useEscape(open, onClose);

  const setTheme = (theme: Settings["theme"]) => {
    try {
      window.localStorage.removeItem(LEGACY_THEME_KEY); // the 0.1 header toggle's choice no longer applies
    } catch {
      // storage blocked
    }
    update({ theme });
  };

  // The browser asks for permission only now, when you switch notifications on.
  const setNotifications = async (on: boolean) => {
    setNotice(null);
    if (!on) return update({ notifications: false });
    if (typeof Notification === "undefined") return setNotice("This browser can't show desktop notifications.");
    let permission = Notification.permission;
    if (permission === "default") {
      try {
        permission = await Notification.requestPermission();
      } catch {
        permission = "denied";
      }
    }
    if (permission === "granted") update({ notifications: true });
    else if (permission === "denied") setNotice("Notifications are blocked for this page. Allow them in your browser's site settings, then switch this on again.");
    else setNotice("Notifications stay off until you allow them when your browser asks.");
  };

  const close = () => {
    setNotice(null);
    onClose();
  };
  const mask = useMask();

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={close}
        >
          <motion.div
            ref={panel}
            tabIndex={-1}
            role="dialog"
            aria-modal
            aria-labelledby="settings-title"
            {...appear(reduce, { scale: 0.98 })}
            onClick={(e) => e.stopPropagation()}
            className="glass-strong max-h-[88dvh] w-full outline-none max-w-[35rem] overflow-y-auto rounded-2xl p-5 shadow-2xl sm:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="settings-title" className="text-xl font-semibold tracking-tight">
                  Settings
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">Choose how cc-trace looks and behaves. Your choices stay in this browser.</p>
              </div>
              <button onClick={close} className="rounded-full p-1.5 text-muted-foreground hover:bg-foreground/10" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>

            <Section title="Look">
              <Field label="Theme">
                <Segmented options={THEMES} value={settings.theme} onChange={setTheme} label="Theme" />
              </Field>
              <Field label="Text size">
                <Segmented options={SIZES} value={settings.textScale} onChange={(textScale) => update({ textScale })} label="Text size" />
              </Field>
              <Field label="Spacing">
                <Segmented options={DENSITIES} value={settings.density} onChange={(density) => update({ density })} label="Spacing" />
              </Field>
              <Toggle
                label="Reduce motion"
                text="Turns off sliding and animated effects. If your computer is set to reduce motion, cc-trace always follows it."
                checked={settings.reduceMotion}
                onChange={(reduceMotion) => update({ reduceMotion })}
              />
            </Section>

            <Section title="Reading">
              <Toggle
                label="Show technical details by default"
                text="Opens the exact commands, inputs and outputs straight away, instead of behind a “technical details” button."
                checked={settings.showTechnical}
                onChange={(showTechnical) => update({ showTechnical })}
              />
              <Toggle
                label="Hide sensitive text"
                text="Masks keys, passwords, emails and your home folder everywhere on screen, so screenshots are safe to share."
                checked={settings.maskSensitive}
                onChange={(maskSensitive) => update({ maskSensitive })}
              />
            </Section>

            <Section title="Alerts">
              <Toggle
                label="Desktop notifications"
                text="A notification when Claude needs you (a question, a plan to approve, or a permission) while cc-trace is in the background. Your browser asks once."
                checked={settings.notifications}
                onChange={(on) => void setNotifications(on)}
              />
              {notice && (
                <p role="status" className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                  {notice}
                </p>
              )}
            </Section>

            <Section title="Where your logs are read from">
              <div className="flex items-start gap-2.5 rounded-xl border border-foreground/10 px-3 py-2.5">
                <FolderOpen className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <code className="block font-mono text-[0.75rem] break-all">{folders ? mask(folders.projects) : "…"}</code>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    cc-trace only reads this folder. It never changes it and never sends anything over the internet.
                  </p>
                </div>
              </div>
            </Section>

            <Section title="Help">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    close();
                    startTour();
                  }}
                  className={button}
                >
                  <MapIcon className="size-3.5" />
                  Take the tour again
                </button>
                <button
                  onClick={() => {
                    close();
                    toggleShortcuts();
                  }}
                  className={button}
                >
                  <Keyboard className="size-3.5" />
                  Keyboard shortcuts
                </button>
              </div>
            </Section>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5 border-t border-foreground/[0.08] pt-4">
      <h3 className="text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      <div className="mt-3 space-y-3.5">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      <span className="text-[0.8125rem] font-medium">{label}</span>
      {children}
    </div>
  );
}

function Segmented<T extends string | number>(props: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={props.label} className="flex max-w-full flex-wrap gap-0.5 rounded-xl bg-foreground/[0.06] p-0.5">
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          aria-pressed={o.value === props.value}
          onClick={() => props.onChange(o.value)}
          className={cn(
            "h-7 rounded-[10px] px-2.5 text-xs whitespace-nowrap transition-colors",
            o.value === props.value ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ label, text, checked, onChange }: { label: string; text: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-[0.8125rem] font-medium">{label}</div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{text}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn("relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors", checked ? "bg-emerald-500" : "bg-foreground/20")}
      >
        <span className={cn("absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform", checked && "translate-x-4")} />
      </button>
    </div>
  );
}
