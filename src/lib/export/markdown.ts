// A Markdown version of a session or request (H1), for notes, issues and chat. HTML in log text is escaped
// so a Markdown viewer never runs it; code and tool data go in fenced blocks.
import type { SessionModel } from "../session.ts";
import { outline, type ExportOptions } from "./common.ts";

/**
 * Text outside code: no raw HTML, no links or images ([…](…)), and no headings from the log. Brackets,
 * parentheses and a "#" that starts a line are backslash-escaped.
 */
const md = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([[\]()\\])/g, "\\$1")
    .replace(/^(\s*)#/gm, "$1\\#");
const oneLine = (s: string) => md(s.replace(/\s+/g, " ").trim()).replace(/([*_`])/g, "\\$1");
const quote = (s: string, indent = "") => md(s).split("\n").map((l) => `${indent}> ${l}`).join("\n");
function fence(s: string, indent = "") {
  const longest = Math.max(2, ...[...s.matchAll(/`+/g)].map((x) => x[0].length));
  const f = "`".repeat(longest + 1);
  return [`${indent}${f}`, ...s.split("\n").map((l) => indent + l), `${indent}${f}`].join("\n");
}

export function exportMarkdown(m: SessionModel, opts: ExportOptions): string {
  const o = outline(m, opts);
  const out: string[] = [];
  out.push(`# ${oneLine(o.title)}`, "");
  out.push(`_cc-trace export · ${o.scope}${o.masked ? " · sensitive text hidden" : ""}_`, "");
  out.push(o.facts.map(([k, v]) => `**${k}:** ${oneLine(v)}`).join("  \n"), "");
  if (o.story) out.push(md(o.story), "");
  for (const t of o.turns) {
    out.push(`## Request ${t.index + 1}: ${oneLine(t.heading)}`, "");
    if (t.when) out.push(`_${oneLine(t.when)}_`, "");
    if (t.ask) out.push("**You asked:**", "", quote(t.ask), "");
    out.push(md(t.story), "");
    t.steps.forEach((s, i) => {
      const who = s.to ? `${oneLine(s.who)} → ${oneLine(s.to)}` : oneLine(s.who);
      out.push(`${i + 1}. **${who}**: ${oneLine(s.title)}${s.subtitle ? ` · ${oneLine(s.subtitle)}` : ""}${s.error ? " (didn't work)" : ""}`);
      if (s.what) out.push(`   ${oneLine(s.what)}`);
      if (s.quote) out.push("", quote(s.quote, "   "));
      if (s.tech?.input) out.push("", `   What Claude sent${s.tech.tool ? ` (${oneLine(s.tech.tool)})` : ""}:`, "", fence(s.tech.input, "   "));
      if (s.tech?.output) out.push("", "   What came back:", "", fence(s.tech.output, "   "));
      out.push("");
    });
  }
  if (o.events.length) {
    out.push("## System events and hooks (technical)", "");
    for (const ev of o.events) out.push(`- ${oneLine(ev.when)} · ${oneLine(ev.who)} · ${oneLine(ev.kind)}`, "", fence(ev.data, "  "), "");
  }
  out.push("---", "_Made with cc-trace, which reads Claude Code's own logs on your computer and sends nothing anywhere._", "");
  return out.join("\n");
}
