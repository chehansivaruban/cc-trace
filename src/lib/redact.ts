// "Hide sensitive text": masks keys, tokens, passwords, emails and the home folder
// before text is shown or shared. Best effort: it can't know every secret format.
const MASK = "•••";

// \b keeps "disk-usage-monitoring-service" readable while still catching "KEY=sk-...".
const PATTERNS: RegExp[] = [
  /\bsk-ant-[\w-]{8,}/g,
  /\bsk-[\w-]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /xox[abpr]-[\w-]+/g,
  /AKIA[0-9A-Z]{16}/g,
  /eyJ[\w-]+\.[\w-]+\.[\w-]+/g, // JWT-like
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, // emails
];
// "password=hunter2", "API_KEY: abc", {"password": "x"}: keep the name, hide the value.
const KEY_VALUE = /(password|passwd|secret|token|api[_-]?key)(["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|\S+)/gi;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function maskSecrets(text: string, home?: string): string {
  let out = text;
  // Trailing separators are trimmed so "/Users/me/" and "/Users/me" both work; "/Users/meg" is left alone.
  const h = home?.replace(/[\\/]+$/, "");
  if (h) out = out.replace(new RegExp(`${escape(h)}(?=[\\\\/]|$|[^\\w.-])`, "g"), "~");
  for (const re of PATTERNS) out = out.replace(re, MASK);
  return out.replace(KEY_VALUE, (_, key: string, sep: string) => key + sep + MASK);
}
