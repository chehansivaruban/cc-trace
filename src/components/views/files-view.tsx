"use client";

// Files (N2): "What changed in my project": every file Claude touched, each change in order as a before and after.
import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronLeft, FilePen, FilePlus, FileText, Search } from "lucide-react";
import { ToolRenderer } from "@/components/tools";
import { TermText } from "@/components/term-text";
import { MapButton, plural, useJump, useTechnical } from "@/components/view-kit";
import { useMask } from "@/hooks/use-mask";
import { filesTouched, isInside, pathKey, type FileTouched } from "@/lib/analytics/files";
import { cn } from "@/lib/utils";
import type { SessionViewProps } from "./registry";

const PAGE = 20;
const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** The path relative to the project folder when it's inside it, else the full path. */
function shownPath(p: string, cwds: string[]) {
  const dir = cwds.filter((c) => isInside(p, c)).sort((a, b) => b.length - a.length)[0];
  if (!dir) return p;
  const depth = pathKey(dir).split("/").filter(Boolean).length;
  return p.split(/[\\/]/).filter(Boolean).slice(depth).join("/") || base(p);
}

export function FilesView(props: SessionViewProps) {
  const { model, selected } = props;
  const mask = useMask(model);
  const [tech, techToggle] = useTechnical();
  const files = useMemo(() => filesTouched(model), [model]);
  const changed = useMemo(() => files.filter((f) => f.changes.length), [files]);
  const readOnly = useMemo(() => files.filter((f) => !f.changes.length), [files]);
  const [tab, setTab] = useState<"changed" | "read">("changed");
  const [query, setQuery] = useState("");
  // Start on the file of the selected step, if it changed one; otherwise the first changed file.
  const [picked, setPicked] = useState<string | null>(() => {
    const step = selected?.type === "step" ? selected.id : undefined;
    const hit = step && files.find((f) => f.changes.some((c) => c.step.id === step));
    return hit ? pathKey(hit.path) : changed[0] ? pathKey(changed[0].path) : null;
  });
  const [detailOpen, setDetailOpen] = useState(false); // small screens: the list or one file

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = tab === "changed" ? changed : readOnly;
    return q ? all.filter((f) => f.path.toLowerCase().includes(q)) : all;
  }, [tab, changed, readOnly, query]);
  const current = files.find((f) => pathKey(f.path) === picked);

  if (!files.length) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <FileText className="mx-auto mb-3 size-5 text-muted-foreground" />
          <p className="text-sm font-medium">No files yet</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Claude hasn&apos;t read or changed any files in this session so far.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn("border-b border-foreground/10 px-4 py-3", detailOpen && "hidden md:block")}>
        <p className="text-[13px] leading-relaxed">
          <span className="font-medium">What changed in your project.</span>{" "}
          <span className="text-muted-foreground">
            Every file Claude changed with its file tools in this session, with each change in order as a before and after. Changes made by running commands or scripts
            aren&apos;t listed here.
          </span>
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <p className="text-xs text-muted-foreground">
            {plural(changed.length, "file")} changed · {plural(readOnly.length, "file")} only read
          </p>
          {techToggle}
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className={cn("min-h-0 w-full flex-col border-foreground/10 md:flex md:w-72 md:shrink-0 md:border-r", detailOpen ? "hidden" : "flex")} aria-label="Files">
          <div className="space-y-2 px-3 pt-3 pb-2">
            <div className="flex rounded-lg border border-foreground/10 p-0.5 text-xs" role="tablist">
              {(["changed", "read"] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={cn("flex-1 rounded-md px-2 py-1.5 transition-colors", tab === t ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
                >
                  {t === "changed" ? `Changed (${changed.length})` : `Only read (${readOnly.length})`}
                </button>
              ))}
            </div>
            <label className="flex h-8 items-center gap-2 rounded-lg border border-foreground/10 px-2.5 text-xs focus-within:border-foreground/30">
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a file" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground" aria-label="Find a file" />
            </label>
          </div>
          <FileList
            files={list}
            picked={picked}
            cwds={model.meta.cwds}
            mask={mask}
            onPick={(f) => {
              setPicked(pathKey(f.path));
              setDetailOpen(true);
            }}
            empty={query ? "No file matches that name." : tab === "changed" ? "Claude hasn't changed any files yet." : "No files that were only read."}
          />
        </aside>
        <div className={cn("min-w-0 flex-1 overflow-y-auto md:block", detailOpen ? "block" : "hidden")}>
          {current ? (
            <FileDetail key={picked} {...props} entry={current} mask={mask} tech={tech} onBack={() => setDetailOpen(false)} />
          ) : (
            <p className="p-6 text-sm text-muted-foreground">Pick a file to see how it changed.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function FileList({ files, picked, cwds, mask, onPick, empty }: { files: FileTouched[]; picked: string | null; cwds: string[]; mask: (t: string) => string; onPick: (f: FileTouched) => void; empty: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: files.length, getScrollElement: () => scroller.current, estimateSize: () => 52, overscan: 10 });
  if (!files.length) return <p className="px-4 py-3 text-xs text-muted-foreground">{empty}</p>;
  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <ul style={{ height: v.getTotalSize(), position: "relative" }}>
        {v.getVirtualItems().map((row) => {
          const f = files[row.index];
          const rel = shownPath(f.path, cwds);
          const dir = rel.split(/[\\/]/).slice(0, -1).join("/");
          const active = pathKey(f.path) === picked;
          const n = f.changes.length;
          return (
            <li key={row.key} className="absolute inset-x-0" style={{ top: row.start, height: row.size }}>
              <button
                onClick={() => onPick(f)}
                className={cn("flex h-full w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors hover:bg-foreground/[0.05]", active && "bg-foreground/[0.07]")}
                aria-current={active || undefined}
                title={mask(f.path)}
              >
                {n ? f.writes ? <FilePlus className="size-3.5 shrink-0 text-violet-500" /> : <FilePen className="size-3.5 shrink-0 text-violet-500" /> : <FileText className="size-3.5 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{mask(base(f.path))}</span>
                  {dir && <span className="block truncate text-[11px] text-muted-foreground">{mask(dir)}</span>}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{n ? plural(n, "change") : `read ${f.reads}×`}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FileDetail({ entry: file, model, mask, tech, onBack, ...props }: { entry: FileTouched; mask: (t: string) => string; tech: boolean; onBack: () => void } & SessionViewProps) {
  const jump = useJump({ model, ...props });
  const [shown, setShown] = useState(PAGE);
  const requests = new Set(file.changes.map((c) => c.turn)).size;
  const changes = file.changes.slice(0, shown);
  return (
    <div className="mx-auto max-w-3xl px-4 pt-4 pb-16 sm:px-6">
      <button onClick={onBack} className="mb-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground md:hidden">
        <ChevronLeft className="size-3.5" /> All files
      </button>
      <h2 className="text-lg font-semibold tracking-tight break-all">{mask(base(file.path))}</h2>
      <p className="mt-0.5 text-xs break-all text-muted-foreground">{mask(tech ? file.path : shownPath(file.path, model.meta.cwds))}</p>
      <p className="mt-3 text-[13px] leading-relaxed">
        {file.changes.length ? (
          <>
            Changed {plural(file.changes.length, "time")}
            {requests > 1 ? ` across ${requests} requests` : ""}
            {file.reads ? `, and read ${plural(file.reads, "time")}` : ""}.{" "}
            <span className="text-muted-foreground">
              <TermText text="Each change below shows the [[diff:before and after]]. Click a change's heading to see where it happened." />
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">Claude only read this file ({plural(file.reads, "time")}); it didn&apos;t change it.</span>
        )}
      </p>
      {changes.length > 0 && (
        <ol className="relative mt-5 space-y-6 border-l border-foreground/10 pl-5">
          {changes.map(({ step, turn }, i) => {
            const who = model.actors[step.actor]?.name ?? "Claude";
            return (
              <li key={step.id} className="relative">
                <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full bg-violet-400 ring-4 ring-background" />
                <div className="flex items-start gap-2">
                  <button onClick={() => jump.select(turn, step.id)} className="min-w-0 flex-1 text-left">
                    <span className="block text-[13px] font-semibold hover:underline">
                      {i + 1}. {mask(step.title)}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Request {turn + 1} · {who} · {new Date(step.ts).toLocaleTimeString()}
                      {tech && step.tool && (
                        <>
                          {" "}· <code className="text-[11px]">{step.tool}</code>
                        </>
                      )}
                    </span>
                  </button>
                  <MapButton onClick={() => jump.toMap(turn, step.id)} />
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-foreground/85">
                  <TermText text={mask(step.what)} />
                </p>
                <div className="mt-2 min-w-0">
                  <ToolRenderer step={step} />
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {file.changes.length > shown && (
        <button onClick={() => setShown(shown + PAGE)} className="mt-6 h-8 rounded-lg border border-foreground/10 px-3 text-xs text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
          Show {Math.min(PAGE, file.changes.length - shown)} more of {file.changes.length - shown}
        </button>
      )}
    </div>
  );
}
