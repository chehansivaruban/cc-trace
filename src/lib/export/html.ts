// One self-contained, offline HTML file for a session or a request (H1): inline CSS, no scripts, no fonts,
// stylesheets or images from anywhere else (images are inlined as data: URLs, or left out when masked).
// Every piece of log text is escaped.
import type { SessionModel } from "../session.ts";
import { outline, type ExportOptions, type OutlineStep } from "./common.ts";

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

const CSS = `
:root{--bg:#fbfaf8;--fg:#1c1b1a;--muted:#6b6763;--line:rgba(0,0,0,.09);--card:rgba(0,0,0,.035);--err:#c0392b;--errbg:rgba(220,38,38,.08)}
@media (prefers-color-scheme:dark){:root{--bg:#161514;--fg:#ecebe9;--muted:#a19d98;--line:rgba(255,255,255,.1);--card:rgba(255,255,255,.05);--err:#f19a8f;--errbg:rgba(248,113,113,.12)}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:860px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:26px;line-height:1.2;margin:4px 0 8px;letter-spacing:-.01em}
h2{font-size:19px;margin:0 0 4px}
.kicker{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.lede{color:var(--muted);margin:0 0 16px}
dl.facts{display:flex;flex-wrap:wrap;gap:6px 18px;margin:0 0 20px;font-size:13px}
dl.facts div{display:flex;gap:6px;min-width:0}dl.facts dt{color:var(--muted)}dl.facts dd{margin:0;overflow-wrap:anywhere}
.story{background:var(--card);border-radius:14px;padding:12px 14px;margin:0 0 20px}
section.turn{border-top:1px solid var(--line);padding-top:24px;margin-top:28px}
.when{color:var(--muted);font-size:13px;margin:0 0 12px}
blockquote{margin:8px 0;padding:10px 12px;border-radius:12px;background:var(--card);white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}
ol.steps{list-style:none;margin:16px 0 0;padding:0}
li.step{border-left:3px solid var(--line);padding:4px 0 10px 12px;margin:0 0 6px}
li.step.error{border-left-color:var(--err)}
.head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px}
.dot{display:inline-block;width:9px;height:9px;border-radius:3px;background:oklch(.68 .15 var(--h));align-self:center}
.who{font-weight:600}.title{font-weight:500}.sub,.time{color:var(--muted);font-size:13px;overflow-wrap:anywhere}.time{margin-left:auto}
.what{margin:2px 0 0;font-size:14px}
.err{color:var(--err);background:var(--errbg);border-radius:8px;padding:2px 8px;font-size:12px}
details{margin-top:6px;font-size:13px}summary{cursor:pointer;color:var(--muted)}
pre{margin:6px 0;padding:10px 12px;border-radius:10px;background:var(--card);white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;max-height:420px;overflow:auto}
.label{font-size:11px;color:var(--muted);margin-top:8px}
img{max-width:100%;border-radius:10px;margin-top:6px;border:1px solid var(--line)}
footer{margin-top:48px;color:var(--muted);font-size:12px;text-align:center}
`;

function stepHtml(s: OutlineStep): string {
  const e = escapeHtml;
  const who = s.to ? `${e(s.who)} → ${e(s.to)}` : e(s.who);
  const tech = s.tech
    ? `<details><summary>Technical details</summary>${[
        s.tech.tool ? `<div class="label">Tool: ${e(s.tech.tool)}</div>` : "",
        s.tech.model ? `<div class="label">Model: ${e(s.tech.model)}</div>` : "",
        s.tech.tokens ? `<div class="label">Reply tokens: ${e(s.tech.tokens.toLocaleString("en-US"))}</div>` : "",
        s.tech.thinking ? `<div class="label">Thinking</div><pre>${e(s.tech.thinking)}</pre>` : "",
        s.tech.input ? `<div class="label">What Claude sent</div><pre>${e(s.tech.input)}</pre>` : "",
        s.tech.output ? `<div class="label">What came back</div><pre>${e(s.tech.output)}</pre>` : "",
      ].join("")}</details>`
    : "";
  return `<li class="step${s.error ? " error" : ""}" id="step-${e(s.id)}">
<div class="head"><span class="dot" style="--h:${Number(s.hue) || 0}"></span><span class="who">${who}</span><span class="title">${e(s.title)}</span>${s.subtitle ? `<span class="sub">${e(s.subtitle)}</span>` : ""}${s.error ? `<span class="err">didn't work</span>` : ""}<span class="time">${s.ts ? e(new Date(s.ts).toLocaleTimeString()) : ""}</span></div>
${s.what ? `<p class="what">${e(s.what)}</p>` : ""}${s.quote ? `<blockquote>${e(s.quote)}</blockquote>` : ""}${s.images.map((i) => `<img alt="Image from the log" src="${e(i.src)}">`).join("")}${tech}
</li>`;
}

export function exportHtml(m: SessionModel, opts: ExportOptions): string {
  const o = outline(m, opts);
  const e = escapeHtml;
  const turns = o.turns
    .map(
      (t) => `<section class="turn" id="request-${t.index + 1}">
<div class="kicker">Request ${t.index + 1}</div>
<h2>${e(t.heading)}</h2>
<p class="when">${e(t.when)}</p>
${t.ask ? `<div class="label">You asked</div><blockquote>${e(t.ask)}</blockquote>` : ""}
<p class="story">${e(t.story)}</p>
<ol class="steps">
${t.steps.map(stepHtml).join("\n")}
</ol>
</section>`,
    )
    .join("\n");
  const events = o.events.length
    ? `<section class="turn"><details><summary>System events and hooks (${o.events.length}, technical)</summary>${o.events
        .map((ev) => `<div class="label">${e(ev.when)} · ${e(ev.who)} · ${e(ev.kind)}</div><pre>${e(ev.data)}</pre>`)
        .join("")}</details></section>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(o.title)} · cc-trace</title>
<style>${CSS}</style>
</head>
<body>
<main>
<div class="kicker">cc-trace export · ${e(o.scope)}${o.masked ? " · sensitive text hidden" : ""}</div>
<h1>${e(o.title)}</h1>
<p class="lede">What happened in this Claude Code ${o.scope === "Whole session" ? "session" : "request"}, step by step, in plain English. This file works offline and needs nothing else.</p>
<dl class="facts">${o.facts.map(([k, v]) => `<div><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`).join("")}</dl>
${o.story ? `<p class="story">${e(o.story)}</p>` : ""}
${turns}
${events}
<footer>Made with cc-trace, which reads Claude Code's own logs on your computer and sends nothing anywhere.</footer>
</main>
</body>
</html>
`;
}
