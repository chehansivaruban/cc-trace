"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowLeft, Loader2, Search } from "lucide-react";
import type { SearchDone, SearchHit } from "@/app/api/search/route";
import type { ProjectInfo } from "@/lib/claude-logs";
import { useMask } from "@/hooks/use-mask";
import type { AppPageProps } from "@/lib/route";
import { useSettings } from "@/lib/settings";

type State = { hits: SearchHit[]; done?: SearchDone; error?: string; busy: boolean };

/** Shows the snippet with every match of `q` highlighted (plain, case-insensitive). */
function Highlight({ text, q }: { text: string; q: string }) {
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  let at = 0;
  for (let i = lower.indexOf(needle); needle && i >= 0; i = lower.indexOf(needle, i + needle.length)) {
    parts.push(text.slice(at, i), <mark key={i} className="rounded-sm bg-amber-300/60 px-0.5 text-foreground dark:bg-amber-400/40">{text.slice(i, i + needle.length)}</mark>);
    at = i + needle.length;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

const projectOf = (file: string) => file.split(/[\\/]/)[0];
const noSubscribe = () => () => {};
/** False while the page is still being hydrated (settings may still be the defaults), true afterwards. */
const useHydrated = () => useSyncExternalStore(noSubscribe, () => true, () => false);

const shortPath = (p: string) => p.split(/[\\/]/).filter(Boolean).slice(-2).join("/") || p;

/** Search across every session (C1), streamed from the logs; nothing is stored. */
export function SearchPage({ route, navigate }: AppPageProps) {
  const [settings] = useSettings();
  const hydrated = useHydrated();
  const q = route.q ?? "";
  const [draft, setDraft] = useState(q);
  const mask = useMask();
  const [state, setState] = useState<State>({ hits: [], busy: false });
  // Project folders as Claude Code recorded them (the folder names alone are lossy).
  const [paths, setPaths] = useState<Record<string, string>>({});
  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((list: ProjectInfo[]) => setPaths(Object.fromEntries((Array.isArray(list) ? list : []).map((p) => [p.dir, p.path]))))
      .catch(() => {});
  }, []);

  // Typing updates the URL after a short pause, so back/forward and shared links keep the search.
  useEffect(() => {
    if (draft.trim() === q.trim()) return;
    const t = setTimeout(() => navigate({ q: draft || undefined }, true), 400);
    return () => clearTimeout(t);
  }, [draft, q, navigate]);

  useEffect(() => {
    // Wait until the saved settings are read, so a "Hide sensitive text" user never sends an unmasked search.
    if (!hydrated) return;
    const text = q.trim();
    if (text.length < 2) {
      setState({ hits: [], busy: false });
      return;
    }
    const ctl = new AbortController();
    setState({ hits: [], busy: true });
    (async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(text)}&limit=200${settings.maskSensitive ? "&mask=1" : ""}`, { signal: ctl.signal });
        if (!res.ok || !res.body) throw new Error(await res.text());
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          const rows = lines.filter(Boolean).map((l) => JSON.parse(l) as SearchHit | SearchDone);
          const hits = rows.filter((r): r is SearchHit => !("done" in r));
          const end = rows.find((r): r is SearchDone => "done" in r);
          setState((s) => ({ hits: hits.length ? s.hits.concat(hits) : s.hits, done: end ?? s.done, busy: !end }));
        }
        setState((s) => ({ ...s, busy: false }));
      } catch (err) {
        if (!ctl.signal.aborted) setState({ hits: [], busy: false, error: err instanceof Error && err.message ? err.message : "Search failed" });
      }
    })();
    return () => ctl.abort();
  }, [q, settings.maskSensitive, hydrated]);

  const groups = useMemo(() => {
    const by = new Map<string, SearchHit[]>();
    for (const h of state.hits) by.set(h.file, [...(by.get(h.file) ?? []), h]);
    return [...by.values()];
  }, [state.hits]);

  const tooShort = draft.trim().length > 0 && draft.trim().length < 2;
  return (
    <div className="mx-auto max-w-[860px] px-4 pt-4 pb-16 sm:px-6">
      <button onClick={() => navigate({ page: "session" })} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Back to the session
      </button>
      <h2 className="mt-3 text-lg font-semibold tracking-tight">Search all sessions</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
        Find a word or phrase anywhere in your Claude Code history: your messages, Claude&apos;s replies, and what its tools read and wrote. cc-trace reads the logs each time and keeps no copy.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          navigate({ q: draft || undefined }, true);
        }}
        className="mt-4"
      >
        <label className="flex h-10 items-center gap-2 rounded-xl border border-foreground/15 px-3 focus-within:border-foreground/40">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search for a word or phrase…"
            aria-label="Search all sessions"
            maxLength={200}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {state.busy && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
        </label>
      </form>
      <p className="mt-2 min-h-4 text-xs text-muted-foreground" aria-live="polite">
        {tooShort
          ? "Type at least 2 characters."
          : state.error
            ? state.error
            : state.busy
              ? `Searching… ${state.hits.length} match${state.hits.length === 1 ? "" : "es"} so far`
              : state.done
                ? `${state.done.matches} match${state.done.matches === 1 ? "" : "es"} in ${groups.length} session${groups.length === 1 ? "" : "s"} (searched ${state.done.scanned}).${state.done.limited ? " Showing the first 200: try more words to narrow it down." : ""}${state.done.timedOut ? " Stopped after 20 seconds: older sessions weren't searched." : ""}`
                : ""}
      </p>

      <div className="mt-4 space-y-4">
        {groups.map((hits) => {
          const first = hits[0];
          return (
            <section key={first.file} className="min-w-0 rounded-xl border border-foreground/10">
              <button
                onClick={() => navigate({ page: "session", file: first.file, turn: undefined, view: "map", step: undefined, q: undefined })}
                className="block w-full rounded-t-xl px-4 pt-3 pb-2 text-left hover:bg-foreground/[0.04]"
              >
                <span className="line-clamp-1 text-[13px] font-semibold">{mask(first.title)}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {mask(shortPath(paths[projectOf(first.file)] ?? projectOf(first.file)))} · {hits.length} match{hits.length === 1 ? "" : "es"}
                </span>
              </button>
              <ul className="border-t border-foreground/10">
                {hits.map((h, i) => (
                  <li key={`${h.step ?? ""}${i}`}>
                    <button
                      onClick={() => navigate({ page: "session", file: h.file, turn: h.turn, view: "map", step: h.step, q: undefined })}
                      className="block w-full px-4 py-2 text-left hover:bg-foreground/[0.04]"
                    >
                      <span className="text-[11px] text-muted-foreground">
                        Request {h.turn + 1}
                        {h.ts ? ` · ${new Date(h.ts).toLocaleString()}` : ""}
                        {h.step ? " · a tool step" : ""}
                      </span>
                      <span className="mt-0.5 block text-[13px] leading-relaxed break-words">
                        <Highlight text={h.snippet} q={q.trim()} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
