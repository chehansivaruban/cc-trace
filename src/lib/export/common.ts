// Shared by the HTML and Markdown exports (H1): one masked, clipped, plain-text outline of a session or a
// request, so masking happens in exactly one place. Exports are built in the browser; nothing is written
// by the server.
import { createMasker, homeFromCwds, userNamesFrom, type Masker } from "../redact.ts";
import { SESSION_START, totalTokens, type SessionModel, type Step, type Turn } from "../session.ts";
import { scopeToTurn } from "../analytics/compare.ts";
import { formatCount, sessionStory, storyOf } from "../analytics/story.ts";

export type ExportOptions = { turn?: number; mask: boolean; home?: string };

/** The home folder, guessed from the folders Claude worked in, so masking can turn it into "~". */
export const homeOf = (m: SessionModel): string | undefined => homeFromCwds(m.meta?.cwds);

export type { Masker };

/** The export's masker: secrets, home folders, and the user names in the session's folders (or the given home). */
export const makeMasker = (mask: boolean, home?: string, names: readonly string[] = userNamesFrom([home])): Masker =>
  mask ? createMasker({ home, names }) : (s) => s;

export function sessionMasker(m: SessionModel, opts: ExportOptions): Masker {
  const home = opts.home ?? homeOf(m);
  return makeMasker(opts.mask, home, userNamesFrom([home, ...(m.meta?.cwds ?? [])]));
}

const SECRET_KEY = /password|passwd|secret|token|api[_-]?key/i;
const HIDDEN = "•••";

/**
 * Masks every string inside a JSON value. Values under secret-looking keys are hidden whole, and images
 * are left out, because neither can be checked word by word.
 */
export function maskDeep(v: unknown, mask: Masker, depth = 0): unknown {
  if (typeof v === "string") return mask(v);
  if (!v || typeof v !== "object") return v;
  if (depth > 40) return "…";
  if (Array.isArray(v)) return v.map((x) => maskDeep(x, mask, depth + 1));
  const o = v as Record<string, unknown>;
  if (o.type === "image") return "[image left out]";
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) {
    // Images can't be checked for secrets.
    if (k === "images") continue;
    out[k] = typeof x === "string" && SECRET_KEY.test(k) ? HIDDEN : maskDeep(x, mask, depth + 1);
  }
  return out;
}

/** Masks first, then clips: clipping first could cut a secret short enough to slip past the patterns. */
export function clipText(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n… (${formatCount(s.length - max)} more characters)` : s;
}

/** Any recorded value as masked text: strings as they are, everything else as indented JSON. */
export function valueText(v: unknown, mask: Masker, masking: boolean, max = 4000): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return clipText(mask(v), max);
  let json: string;
  try {
    json = JSON.stringify(masking ? maskDeep(v, mask) : v, null, 2) ?? "";
  } catch {
    json = String(v);
  }
  return clipText(mask(json), max);
}

const shorten = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
/** Subtitles hold whole text in the model; the export shortens them after masking, keeping “quotes” closed. */
const shortSubtitle = (s: string) => (s.startsWith("“") && s.endsWith("”") && s.length > 80 ? `“${shorten(s.slice(1, -1), 78)}”` : shorten(s, 80));

export const stripTerms = (s: string) => s.replace(/\[\[(\w+):([^\]]+)\]\]/g, "$2");

export type OutlineStep = {
  id: string;
  who: string;
  to?: string;
  hue: number;
  title: string;
  subtitle: string;
  what: string;
  quote?: string;
  error: boolean;
  ts: number;
  images: { src: string }[];
  tech?: { tool?: string; model?: string; tokens?: number; input?: string; output?: string; thinking?: string };
};
export type OutlineTurn = { index: number; heading: string; ask?: string; when: string; story: string; steps: OutlineStep[] };
export type Outline = {
  title: string;
  masked: boolean;
  scope: string;
  facts: [string, string][];
  story: string;
  turns: OutlineTurn[];
  events: { when: string; who: string; kind: string; data: string }[];
};

const IMAGE_TYPES = /^image\/(png|jpeg|gif|webp)$/;
const BASE64 = /^[A-Za-z0-9+/=\s]+$/;
const when = (ts: number) => (ts ? new Date(ts).toLocaleString() : "");
function duration(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 90 ? `${m} min` : `${(m / 60).toFixed(1)} h`;
}

function outlineStep(s: Step, m: SessionModel, mask: Masker, masking: boolean): OutlineStep {
  const doer = m.actors[s.from ?? s.actor];
  const to = s.from ? m.actors[s.actor] : undefined;
  const hasTech = s.tool || s.input !== undefined || s.output !== undefined || s.thinking;
  return {
    id: s.id,
    who: mask(doer?.name ?? "Someone"),
    to: to ? mask(to.name) : undefined,
    hue: Number(doer?.hue) || 0,
    title: mask(s.title ?? ""),
    subtitle: shortSubtitle(mask(s.subtitle ?? "")),
    what: mask(stripTerms(s.what ?? "")),
    quote: typeof s.quote === "string" && s.quote ? clipText(mask(s.quote), 20_000) : undefined,
    error: s.status === "error",
    ts: s.ts,
    // Images can't be checked for secrets, so a masked export leaves them out.
    images: masking
      ? []
      : (s.images ?? []).filter((i) => IMAGE_TYPES.test(i.mediaType) && BASE64.test(i.data)).map((i) => ({ src: `data:${i.mediaType};base64,${i.data.replace(/\s+/g, "")}` })),
    tech: hasTech
      ? {
          tool: s.tool ? mask(s.tool) : undefined,
          model: s.model,
          tokens: s.usage ? totalTokens(s.usage) : undefined,
          input: s.input !== undefined ? valueText(s.input, mask, masking) : undefined,
          output: s.output !== undefined ? valueText(s.output, mask, masking) : undefined,
          thinking: s.thinking ? clipText(mask(s.thinking), 4000) : undefined,
        }
      : undefined,
  };
}

function outlineTurn(t: Turn, m: SessionModel, mask: Masker, masking: boolean): OutlineTurn {
  const ask = t.text === SESSION_START ? undefined : clipText(mask(t.text), 20_000);
  const tokens = totalTokens(t.usage);
  return {
    index: t.index,
    heading: t.text === SESSION_START ? SESSION_START : mask(t.text).replace(/\s+/g, " ").trim().slice(0, 90),
    ask,
    when: [when(t.ts), t.end > t.ts ? duration(t.end - t.ts) : "", tokens ? `${formatCount(tokens)} tokens` : ""].filter(Boolean).join(" · "),
    story: stripTerms(storyOf(t, m, mask)),
    steps: t.steps.map((s) => outlineStep(s, m, mask, masking)),
  };
}

/** Everything an export shows, already masked and clipped. */
export function outline(m: SessionModel, opts: ExportOptions): Outline {
  const mask = sessionMasker(m, opts);
  const one = opts.turn !== undefined;
  const turns = one ? m.turns.filter((t) => t.index === opts.turn) : m.turns;
  const first = m.turns.find((t) => t.text !== SESSION_START)?.text ?? "";
  const title = mask(m.meta?.customTitle ?? m.meta?.aiTitle ?? first).replace(/\s+/g, " ").trim().slice(0, 90) || "Claude Code session";
  const helpers = Object.values(m.actors).filter((a) => a.kind === "helper").length;
  const scoped = one ? scopeToTurn(m, m.turns.findIndex((t) => t.index === opts.turn)) : m;
  const facts: [string, string][] = [
    ["Started", when(m.meta?.firstTs || m.turns[0]?.ts || 0)],
    ["Requests", formatCount(m.turns.filter((t) => t.text !== SESSION_START).length)],
    ["Helpers", formatCount(helpers)],
    ["Tokens", formatCount(totalTokens(scoped.usage ?? m.usage))],
    ["Models", (m.meta?.models ?? []).join(", ")],
    ["Git branch", mask(m.meta?.gitBranch ?? "")],
    ["Folder", mask(m.meta?.cwds?.[0] ?? "")],
  ];
  const lo = one ? (turns[0]?.ts ?? Infinity) : -Infinity;
  const next = one ? m.turns.find((t) => t.index === (opts.turn ?? 0) + 1)?.ts : undefined;
  const hi = one ? (next ?? Infinity) : Infinity;
  return {
    title,
    masked: opts.mask,
    scope: one ? (turns[0] ? `Request ${(opts.turn ?? 0) + 1}` : "A request that no longer exists") : "Whole session",
    facts: facts.filter(([, v]) => v),
    story: stripTerms(one ? (turns[0] ? storyOf(turns[0], m, mask) : "") : sessionStory(m, mask)),
    turns: turns.map((t) => outlineTurn(t, m, mask, opts.mask)),
    events: (m.events ?? [])
      .filter((e) => e.ts >= lo && e.ts < hi)
      .slice(0, 2000)
      .map((e) => ({ when: when(e.ts), who: mask(m.actors[e.actor]?.name ?? e.actor), kind: mask(`${e.type} · ${e.subtype}`), data: valueText(e.data, mask, opts.mask, 2000) })),
  };
}

/** The session model as JSON (masked when asked), for people who want the raw data. */
export function exportJson(m: SessionModel, opts: ExportOptions): string {
  const mask = sessionMasker(m, opts);
  const scoped = opts.turn !== undefined ? scopeToTurn(m, m.turns.findIndex((t) => t.index === opts.turn)) : m;
  const body = { exportedBy: "cc-trace", masked: opts.mask, scope: opts.turn !== undefined ? `request ${opts.turn + 1}` : "session", session: scoped };
  try {
    return JSON.stringify(opts.mask ? maskDeep(body, mask) : body, null, 2);
  } catch {
    // Circular or enormous data: say so in plain words instead of a JavaScript error.
    throw new Error("This session couldn't be saved as raw data. Try the web page or Markdown export instead.");
  }
}

/** A safe download name: "cc-trace-<title>-request-3.html". */
export function exportFileName(title: string, turn: number | undefined, ext: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "session";
  return `cc-trace-${slug}${turn !== undefined ? `-request-${turn + 1}` : ""}.${ext}`;
}
