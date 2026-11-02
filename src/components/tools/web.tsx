"use client";

// WebFetch / WebSearch: which page or search, and what Claude got back. Links open in a new tab.
import { CAPS, shortUrl, webFetchData, webSearchData } from "@/lib/conversation";
import { useMask } from "@/lib/mask";
import type { Step } from "@/lib/session";
import { Markdown } from "../markdown";
import { Facts, Pill, TextBox, asText, fmt, plural } from "./shared";

/** A link from the log. With "Hide sensitive text" on, both the text and the address are masked. */
function Link({ href, children }: { href: string; children: string }) {
  const mask = useMask();
  const url = mask(href);
  return /^https?:\/\//i.test(url) ? (
    <a href={url} target="_blank" rel="noreferrer noopener" className="font-medium break-all underline underline-offset-2">
      {mask(children)}
    </a>
  ) : (
    <span className="break-all">{mask(children)}</span>
  );
}

export function WebView({ step }: { step: Step }) {
  const mask = useMask();
  if (step.tool === "WebSearch") {
    const { query, links, summary, result: r } = webSearchData(step);
    return (
      <div className="space-y-2.5">
        <p className="text-[13px]">
          <span data-find-skip>Searched the web for </span>
          <b>{mask(query)}</b>
        </p>
        <Facts items={[links.length ? `${plural(links.length, "result")}` : null, typeof r.durationSeconds === "number" ? `${r.durationSeconds.toFixed(1)} s` : null]} />
        {step.status === "error" && <Pill tone="bad">The search failed</Pill>}
        {links.length > 0 && (
          <ol className="space-y-1 text-[13px]">
            {links.slice(0, CAPS.webResults).map((l, i) => (
              <li key={i} className="flex gap-2">
                <span data-find-skip className="w-4 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <Link href={l.url}>{l.title}</Link>
                  <span data-find-block className="block truncate text-xs text-muted-foreground">
                    {mask(shortUrl(l.url))}
                  </span>
                </span>
              </li>
            ))}
            {links.length > CAPS.webResults && (
              <li data-find-skip className="pl-6 text-xs text-muted-foreground">
                …and {links.length - CAPS.webResults} more
              </li>
            )}
          </ol>
        )}
        {summary && <Body text={summary} />}
      </div>
    );
  }
  const { url, prompt, text, result: r } = webFetchData(step);
  return (
    <div className="space-y-2.5">
      <p className="text-[13px]">
        <span data-find-skip>Opened </span>
        {url ? <Link href={url}>{url}</Link> : <span data-find-skip>a web page</span>}
      </p>
      <Facts
        items={[
          typeof r.code === "number" ? (r.code >= 400 ? <Pill key="c" tone="bad">{`${r.code} ${asText(r.codeText)}`}</Pill> : `${r.code} ${asText(r.codeText)}`) : null,
          typeof r.bytes === "number" ? `${fmt(Math.round(r.bytes / 1024))} KB` : null,
          typeof r.durationMs === "number" ? `${(r.durationMs / 1000).toFixed(1)} s` : null,
        ]}
      />
      {prompt && <TextBox text={`What Claude wanted to know: ${prompt}`} />}
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
