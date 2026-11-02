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

// Text size scales the root font size, so every rem-based size (Tailwind text, spacing, popovers, tooltips,
// the tour) grows together while viewport units stay true. Reduce motion stills CSS animations and transitions.
const settingsCss =
  "html{font-size:calc(100% * var(--text-scale,1))}" +
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
