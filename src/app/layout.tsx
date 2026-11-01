import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { SettingsProvider } from "@/components/settings-provider";
import { ShortcutsOverlay } from "@/components/shortcuts-overlay";
import { Tour } from "@/components/tour";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "cc-trace",
  description: "See what Claude Code and its helper agents are doing, in plain English",
};

// Runs before paint so nothing flashes: theme (Settings, then the 0.1 header toggle, then the system),
// text size, and reduce motion (the setting or the system's). SettingsProvider keeps them in sync afterwards.
const settingsScript = `try{var d=document.documentElement,s={},m=function(q){return matchMedia(q).matches};try{s=JSON.parse(localStorage.getItem("cc-trace:settings"))||{}}catch(e){}var t=s.theme,l=null;try{l=localStorage.getItem("theme")}catch(e){}d.classList.toggle("dark",t==="dark"||(t!=="light"&&(l==="dark"||(l!=="light"&&m("(prefers-color-scheme: dark)")))));if([0.9,1.15,1.3].indexOf(s.textScale)>=0)d.style.setProperty("--text-scale",String(s.textScale));if(s.reduceMotion===true||m("(prefers-reduced-motion: reduce)"))d.setAttribute("data-reduce-motion","")}catch(e){}`;

// Text size zooms the app (rem and px sizes alike). Only <main> is zoomed: popovers, tooltips and the tour live
// outside it and position themselves in plain screen pixels. Zoom also scales viewport units (vw, vh, dvh), so
// those used inside <main> are divided back; a new viewport-sized class inside <main> belongs in this list.
const VIEWPORT_CLASSES: [string, string, string][] = [
  ["h-dvh", "height", "100dvh"],
  ["w-screen", "width", "100vw"],
  ["h-\\[62dvh\\]", "height", "62dvh"],
  ["h-\\[70vh\\]", "height", "70vh"],
  ["h-\\[80dvh\\]", "height", "80dvh"],
  ["max-h-\\[50vh\\]", "max-height", "50vh"],
  ["max-h-\\[60vh\\]", "max-height", "60vh"],
  ["max-h-\\[70vh\\]", "max-height", "70vh"],
  ["max-h-\\[85vh\\]", "max-height", "85vh"],
  ["max-h-\\[88dvh\\]", "max-height", "88dvh"],
];
const settingsCss =
  "body>main{zoom:var(--text-scale,1)}" +
  VIEWPORT_CLASSES.map(([cls, prop, v]) => `body>main.${cls},body>main .${cls}{${prop}:calc(${v} / var(--text-scale,1))}`).join("") +
  // Reduce motion stills CSS animations and transitions everywhere.
  "html[data-reduce-motion] *,html[data-reduce-motion] *::before,html[data-reduce-motion] *::after{animation-duration:0.01ms!important;animation-iteration-count:1!important;transition-duration:0.01ms!important;scroll-behavior:auto!important}";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`dark ${inter.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: settingsScript }} />
        <style dangerouslySetInnerHTML={{ __html: settingsCss }} />
      </head>
      <body className="antialiased">
        <SettingsProvider>
          {children}
          <ShortcutsOverlay />
          <Tour />
        </SettingsProvider>
      </body>
    </html>
  );
}
