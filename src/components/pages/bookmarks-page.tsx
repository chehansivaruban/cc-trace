"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, Bookmark, BookmarkCheck, Pencil, Search, Tag, X } from "lucide-react";
import { useBookmarks, type Bookmark as Saved } from "@/lib/bookmarks";
import type { ProjectInfo } from "@/lib/claude-logs";
import { useMask } from "@/hooks/use-mask";
import type { AppPageProps } from "@/lib/route";
import { cn } from "@/lib/utils";

type Listed = { title: string; project: string };
type Group = { file: string; session?: Saved; steps: Saved[]; tags: string[]; name?: string; latest: number };

const chip = "inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs transition-colors";
const idOf = (file: string) => (file.split(/[\\/]/).pop() ?? file).replace(/\.jsonl$/, "");

export function BookmarksPage({ navigate }: AppPageProps) {
  const { data, toggle, setTags, rename } = useBookmarks();
  const [listed, setListed] = useState<Map<string, Listed> | null>(null);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);

  // Session titles and folders, for bookmarks that only know their file.
  useEffect(() => {
    let live = true;
    fetch("/api/sessions")
      .then((r) => (r.ok ? (r.json() as Promise<ProjectInfo[]>) : []))
      .then((projects) => {
        if (!live) return;
        const m = new Map<string, Listed>();
        for (const p of projects) for (const s of p.sessions) m.set(s.file, { title: s.title, project: p.path });
        setListed(m);
      })
      .catch(() => live && setListed(new Map()));
    return () => {
      live = false;
    };
  }, []);

  const mask = useMask();

  const groups = useMemo(() => {
    const by = new Map<string, Group>();
    const group = (file: string) => {
      let g = by.get(file);
      if (!g) by.set(file, (g = { file, steps: [], tags: data.tags[file] ?? [], name: data.names[file], latest: 0 }));
      return g;
    };
    for (const b of data.items) {
      const g = group(b.file);
      if (b.step) g.steps.push(b);
      else g.session = b;
      g.latest = Math.max(g.latest, b.createdAt);
    }
    for (const f of Object.keys(data.tags)) group(f);
    for (const f of Object.keys(data.names)) group(f);
    for (const g of by.values()) g.steps.sort((a, b) => (a.turn ?? 0) - (b.turn ?? 0) || a.createdAt - b.createdAt);
    return [...by.values()].sort((a, b) => b.latest - a.latest);
  }, [data]);

  const allTags = useMemo(() => [...new Set(Object.values(data.tags).flat())].sort(), [data.tags]);
  const titleOf = (g: Group) => g.name ?? listed?.get(g.file)?.title ?? g.session?.label ?? `Session ${idOf(g.file).slice(0, 8)}`;

  const q = query.trim().toLowerCase();
  const shown = groups.filter((g) => {
    if (tag && !g.tags.includes(tag)) return false;
    if (!q) return true;
    const hay = [titleOf(g), g.session?.label, listed?.get(g.file)?.project, ...g.tags, ...g.steps.map((s) => s.label)].join("\n").toLowerCase();
    return hay.includes(q);
  });

  const open = (file: string, b?: Saved) => navigate({ page: "session", file, turn: b?.turn, view: "map", step: b?.step });

  return (
    <div className="mx-auto w-full max-w-[55rem] px-4 pt-4 pb-16 sm:px-6">
      <button onClick={() => navigate({ page: "session" })} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Back to the session
      </button>
      <h1 className="mt-3 text-xl font-semibold tracking-tight">Bookmarks</h1>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Sessions and steps you saved, with your own names and tags. They are kept in this browser only and never sent anywhere.
      </p>

      {groups.length > 0 && (
        <div className="mt-5 flex flex-col gap-3">
          <label className="flex h-9 items-center gap-2 rounded-xl border border-foreground/10 px-3 focus-within:border-foreground/25">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name, tag or step"
              aria-label="Filter bookmarks"
              className="min-w-0 flex-1 bg-transparent text-[0.8125rem] outline-none placeholder:text-muted-foreground"
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label="Clear the filter" className="rounded-full p-0.5 text-muted-foreground hover:text-foreground">
                <X className="size-3.5" />
              </button>
            )}
          </label>
          {allTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by tag">
              <Tag className="mr-0.5 size-3.5 text-muted-foreground" />
              {[null, ...allTags].map((t) => (
                <button
                  key={t ?? "all"}
                  aria-pressed={tag === t}
                  onClick={() => setTag(t)}
                  className={cn(chip, tag === t ? "bg-foreground text-background" : "bg-foreground/[0.06] text-muted-foreground hover:text-foreground")}
                >
                  {t ?? "All"}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {groups.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-foreground/15 p-8 text-center">
          <Bookmark className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">No bookmarks yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
            Select a step and press <kbd className="rounded border border-foreground/15 px-1">b</kbd>, or use a bookmark button, to save it here.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">Nothing matches that filter.</p>
      ) : (
        <ul className="mt-5 space-y-3">
          {shown.map((g) => (
            <SessionCard
              key={g.file}
              group={g}
              title={mask(titleOf(g))}
              subtitle={mask(g.name ? (listed?.get(g.file)?.title ?? g.session?.label ?? "") : (listed?.get(g.file)?.project ?? ""))}
              missing={listed !== null && !listed.has(g.file)}
              mask={mask}
              onOpen={(b) => open(g.file, b)}
              onToggleSession={() => toggle({ file: g.file, label: titleOf(g) })}
              onRemove={(b) => toggle({ file: b.file, step: b.step, label: b.label })}
              onRename={(n) => rename(g.file, n)}
              onTags={(t) => setTags(g.file, t)}
              onTag={setTag}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SessionCard(props: {
  group: Group;
  title: string;
  subtitle: string;
  missing: boolean;
  mask: (t: string) => string;
  onOpen: (b?: Saved) => void;
  onToggleSession: () => void;
  onRemove: (b: Saved) => void;
  onRename: (name?: string) => void;
  onTags: (tags: string[]) => void;
  onTag: (tag: string) => void;
}) {
  const { group: g } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [newTag, setNewTag] = useState("");

  // Escape cancels; the blur that follows when the field disappears must not save.
  const skipSave = useRef(false);
  const saveName = () => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    props.onRename(draft);
    setEditing(false);
  };
  const cancelName = () => {
    skipSave.current = true;
    setEditing(false);
  };
  const addTag = () => {
    if (newTag.trim()) props.onTags([...g.tags, ...newTag.split(",")]);
    setNewTag("");
  };
  const onTagKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag();
    } else if (e.key === "Backspace" && !newTag && g.tags.length) props.onTags(g.tags.slice(0, -1));
  };

  return (
    <li className="rounded-2xl border border-foreground/10 bg-foreground/[0.02] p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                else if (e.key === "Escape") {
                  e.stopPropagation();
                  cancelName();
                }
              }}
              onBlur={saveName}
              placeholder="Your name for this session"
              aria-label="Your name for this session"
              className="h-8 w-full rounded-lg border border-foreground/20 bg-transparent px-2 text-[0.875rem] font-medium outline-none focus:border-foreground/40"
            />
          ) : (
            <button onClick={() => props.onOpen()} className="block max-w-full truncate text-left text-[0.875rem] font-semibold hover:underline">
              {props.title}
            </button>
          )}
          {(props.subtitle || props.missing) && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{props.missing ? "This session's log is no longer on this computer" : props.subtitle}</p>
          )}
        </div>
        <button
          onClick={() => {
            skipSave.current = false;
            setDraft(g.name ?? "");
            setEditing(true);
          }}
          title="Give this session your own name"
          aria-label="Rename this session"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground"
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          onClick={props.onToggleSession}
          aria-pressed={!!g.session}
          title={g.session ? "Remove the session bookmark" : "Bookmark this session"}
          aria-label={g.session ? "Remove the session bookmark" : "Bookmark this session"}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-foreground/[0.07]",
            g.session ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {g.session ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {g.tags.map((t) => (
          <span key={t} className={cn(chip, "bg-foreground/[0.06] pr-1")}>
            <button onClick={() => props.onTag(t)} className="hover:underline" title={`Show only “${t}”`}>
              {t}
            </button>
            <button onClick={() => props.onTags(g.tags.filter((x) => x !== t))} aria-label={`Remove the tag ${t}`} className="rounded-full p-0.5 text-muted-foreground hover:text-foreground">
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={onTagKey}
          onBlur={addTag}
          placeholder="+ add tag"
          aria-label="Add a tag"
          className="h-7 w-24 rounded-full bg-transparent px-2.5 text-xs outline-none placeholder:text-muted-foreground focus:bg-foreground/[0.06]"
        />
      </div>

      {g.steps.length > 0 && (
        <ul className="mt-3 divide-y divide-foreground/[0.06] border-t border-foreground/[0.06]">
          {g.steps.map((b) => (
            <li key={b.step} className="dense-row flex items-center gap-2 py-1.5">
              <button onClick={() => props.onOpen(b)} className="flex min-w-0 flex-1 items-baseline gap-2 rounded-lg px-1 py-1 text-left hover:bg-foreground/[0.04]">
                <span className="shrink-0 text-[0.6875rem] text-muted-foreground tabular-nums">{b.turn !== undefined ? `Request ${b.turn + 1}` : "Step"}</span>
                <span className="truncate text-[0.8125rem]">{props.mask(b.label) || "A step"}</span>
              </button>
              <button
                onClick={() => props.onRemove(b)}
                aria-label="Remove this bookmark"
                title="Remove this bookmark"
                className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
