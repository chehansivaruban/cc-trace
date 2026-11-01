"use client";

// WebFetch / WebSearch: which page or search, and what Claude got back. Links open in a new tab.
import { outputText } from "@/lib/conversation";
import { useMask } from "@/lib/mask";
import type { Step } from "@/lib/session";
import { Markdown } from "../markdown";
import { Facts, Pill, TextBox, asText, fmt, plural, type Json } from "./shared";

function Link({ href, children }: { href: string; children: string }) {
  const mask = useMask();
  const safe = /^https?:\/\//i.test(href);
  return safe ? (
    <a href={href} target="_blank" rel="noreferrer noopener" className="font-medium break-all underline underline-offset-2">
      {mask(children)}
    </a>
  ) : (
    <span className="break-all">{mask(children)}</span>
  );
}

const MAX_RESULTS = 12;

export function WebView({ step }: { step: Step }) {
  const mask = useMask();
  const input = (step.input ?? {}) as Json;
  const r = step.result as Json;
  if (step.tool === "WebSearch") {
    const links: { title: string; url: string }[] = [];
    const notes: string[] = [];
    for (const item of Array.isArray(r?.results) ? r.results : []) {
      if (typeof item === "string") notes.push(item);
      else for (const c of Array.isArray(item?.content) ? item.content : []) if (typeof c?.url === "string") links.push({ title: asText(c.title) || c.url, url: c.url });
    }
    const summary = notes.join("\n\n") || (links.length ? "" : outputText(step.output));
    return (
      <div className="space-y-2.5">
        <p className="text-[13px]">
          Searched the web for <b>“{mask(asText(input.query))}”</b>
        </p>
        <Facts items={[links.length ? `${plural(links.length, "result")}` : null, typeof r?.durationSeconds === "number" ? `${r.durationSeconds.toFixed(1)} s` : null]} />
        {step.status === "error" && <Pill tone="bad">The search failed</Pill>}
        {links.length > 0 && (
          <ol className="space-y-1 text-[13px]">
            {links.slice(0, MAX_RESULTS).map((l, i) => (
              <li key={i} className="flex gap-2">
                <span className="w-4 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                <span className="min-w-0">
                  <Link href={l.url}>{l.title}</Link>
                  <span className="block truncate text-xs text-muted-foreground">{l.url.replace(/^https?:\/\//, "")}</span>
                </span>
              </li>
            ))}
            {links.length > MAX_RESULTS && <li className="pl-6 text-xs text-muted-foreground">…and {links.length - MAX_RESULTS} more</li>}
          </ol>
        )}
        {summary && <Body text={summary} />}
      </div>
    );
  }
  const url = asText(input.url);
  const text = asText(r?.result) || outputText(step.output);
  return (
    <div className="space-y-2.5">
      <p className="text-[13px]">Opened {url ? <Link href={url}>{url}</Link> : "a web page"}</p>
      <Facts
        items={[
          typeof r?.code === "number" ? (r.code >= 400 ? <Pill key="c" tone="bad">{`${r.code} ${asText(r.codeText)}`}</Pill> : `${r.code} ${asText(r.codeText)}`) : null,
          typeof r?.bytes === "number" ? `${fmt(Math.round(r.bytes / 1024))} KB` : null,
          typeof r?.durationMs === "number" ? `${(r.durationMs / 1000).toFixed(1)} s` : null,
        ]}
      />
      {asText(input.prompt) && <TextBox text={`What Claude wanted to know: ${input.prompt}`} />}
      {step.status === "error" && <Pill tone="bad">Couldn&apos;t open it</Pill>}
      {text && <Body text={text} />}
    </div>
  );
}

function Body({ text }: { text: string }) {
  return (
    <div className="max-h-80 overflow-auto rounded-xl border border-foreground/10 px-3 py-2.5">
      <Markdown text={text} />
    </div>
  );
}
