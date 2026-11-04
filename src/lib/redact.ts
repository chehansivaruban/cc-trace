// "Hide sensitive text": the one place that decides what is hidden before log text is shown or shared.
// Masks keys, tokens, passwords, emails, private keys, home folders and the user's own name. Best effort:
// it can't know every secret format. Pure, so the browser, the server and the check scripts share it.
export const MASK = "•••";

// \b keeps "disk-usage-monitoring-service" readable while still catching "KEY=sk-...".
const PATTERNS: RegExp[] = [
  /\bsk-ant-[\w-]{8,}/g,
  /\bsk-[\w-]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /\b[srp]k_(?:live|test)_[A-Za-z0-9]{8,}/g, // Stripe
  /\bglpat-[\w-]{20,}/g, // GitLab
  /\bAIza[\w-]{30,}/g, // Google
  /\bnpm_[A-Za-z0-9]{30,}/g,
  /\bhf_[A-Za-z0-9]{30,}/g, // Hugging Face
  /xox[abpr]-[\w-]+/g,
  /AKIA[0-9A-Z]{16}/g,
  /eyJ[\w-]+\.[\w-]+\.[\w-]+/g, // JWT-like
  /(\b[a-z][\w+.-]*:\/\/[^\s:/@]*:)[^\s@/]+(?=@)/gi, // the password in postgres://admin:pw@db, https://user:pw@host, redis://:pw@host
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, // emails
];

// "Authorization: <scheme> <token>" (a header, a JSON field, a curl -H): whatever the token looks like, it's
// hidden; the scheme word (Bearer, Basic, …) stays.
const AUTH_HEADER = /\b(authorization\\?["']?\s*[:=]\s*\\?["']?)(?!(?:Bearer|Basic|Token|Digest|Negotiate)\s+•••)(?:(Bearer|Basic|Token|Digest|Negotiate)\s+)?(?!•••)[^\s"'\\,;]+/gi;
// "Bearer <token>" anywhere: hidden whatever its characters. "Basic <base64>" outside a header only when it
// looks like a token (a digit, +, / or =, or a lower-to-upper case change), so "basic authentication" stays.
const AUTH_SCHEME = [
  /\b(Bearer)\s+(?!•••)[\w.~+/-]{12,}=*/gi,
  /\b(Basic|basic|BASIC)\s+(?=[\w.~+/-]*(?:\d|[+/=]|[a-z][A-Z]))[\w.~+/-]{12,}=*/g,
];

// "password=hunter2", "API_KEY: abc", {"password": "x"}, {\"password\":\"x\"} (JSON inside JSON): keep the
// name, hide the value. Quoted values may hold escaped quotes; a quote that never closes hides the rest of
// its line only.
const KEY_VALUE = new RegExp(
  String.raw`(password|passwd|secret(?:[_-]?key)?|token|api[_-]?key|authorization|credentials?|access[_-]?key|private[_-]?key|client[_-]?secret|(?:signing|encryption|master)[_-]?key)((?:\\?["'])?\s*[:=]\s*)` +
    // A value already hidden by AUTH_SCHEME ("Authorization: Bearer •••") keeps its scheme word.
    String.raw`(?!\\?["']?(?:Bearer|Basic|Token|Digest|Negotiate) •••)` +
    "(?:" +
    [
      String.raw`\\"(?:\\\\\\"|\\\\|\\[^"\n]|[^\\\n])*?(?:\\"|(?=\n)|$)`, // \"value\" (escaped JSON)
      String.raw`"(?:\\.|[^"\\\n])*(?:"|(?=\n)|$)`,
      String.raw`'(?:\\.|[^'\\\n])*(?:'|(?=\n)|$)`,
      String.raw`\S+`,
    ].join("|") +
    ")",
  "gi",
);

// A private key block, possibly cut off before its END line. Each line of the body becomes ••• so line counts
// (and the diff rows built on them) don't change.
const PEM = /(-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----)([\s\S]*?)(-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g;

// Any home folder (/Users/<name>, /home/<name>, C:\Users\<name> in any case, Git Bash /c/Users/<name>, WSL
// /mnt/c/Users/<name>) becomes "~". Only at a path boundary (start, whitespace, quote, =, (, :, comma, brackets,
// | and ;), so "https://x.com/home/page" stays. One or two backslashes: JSON-encoded Windows paths double them.
// A Windows name may hold spaces ("C:\Users\John Smith\proj"): it runs to the next separator when one follows.
// "Shared" and "Public" are not people.
const SEP = String.raw`(?:\\{1,2}|\/)`;
const NAME_PART = String.raw`[^\\/\s"'\`:;,()<>[\]{}|]+`;
const NOT_PERSON = String.raw`(?!(?:Shared|Public)\b)`;
const POSIX_HOME = String.raw`(?:(?:\/mnt)?\/[A-Za-z](?=\/Users\/))?(?:\/Users|\/home)\/${NOT_PERSON}${NAME_PART}`;
const WINDOWS_HOME = String.raw`[A-Za-z]:${SEP}(?:Users|users|USERS)${SEP}${NOT_PERSON}(?:${NAME_PART}(?: +${NAME_PART})+(?=${SEP})|${NAME_PART})`;
const HOME = new RegExp(String.raw`(?<=^|[\s"'\`=(:,[{<>|;])(?:${WINDOWS_HOME}|${POSIX_HOME})`, "g");

// Claude Code's folder names spell the path with dashes: "-Users-alice-app", "C--Users-alice-app", "-home-alice-app".
const ENCODED_HOME = /(^|[^\w-])((?:[A-Za-z]-)?-(?:Users|home)-)(?!(?:Shared|Public)-)[^-\\/\s"'`]+/g;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Secrets, private keys and (when given) the exact home folder. Narrower than createMasker: it leaves other
 * people's home folders and user names alone. Used where only the secrets matter.
 */
export function maskSecrets(text: string, home?: string): string {
  let out = maskPem(text);
  // Trailing separators are trimmed so "/Users/me/" and "/Users/me" both work; "/Users/meg" is left alone.
  const h = home?.replace(/[\\/]+$/, "");
  if (h) out = out.replace(new RegExp(`${escapeRe(h)}(?=[\\\\/]|$|[^\\w.-])`, "g"), "~");
  for (const re of PATTERNS) out = out.replace(re, (whole: string, keep?: unknown) => (typeof keep === "string" ? keep + MASK : MASK));
  out = out.replace(AUTH_HEADER, (_, pre: string, scheme?: string) => `${pre}${scheme ? `${scheme} ` : ""}${MASK}`);
  for (const re of AUTH_SCHEME) out = out.replace(re, `$1 ${MASK}`);
  return out.replace(KEY_VALUE, (_, key: string, sep: string) => key + sep + MASK);
}

function maskPem(text: string) {
  return text.includes("PRIVATE KEY-----")
    ? text.replace(PEM, (_, begin: string, body: string, end: string) => begin + body.replace(/[^\n]+/g, (l) => (l.trim() ? MASK : l)) + end)
    : text;
}

// The home folder at the start of a recorded path (a working folder, the server's home).
const HOME_AT_START = /^(?:(?:\/mnt)?\/[A-Za-z](?=\/Users\/))?(?:\/Users\/[^\\/]+|\/home\/[^\\/]+|\/root(?=\/|$)|[A-Za-z]:\\Users\\[^\\]+|[A-Za-z]:\/Users\/[^/]+)/;

/** The home folder a path starts with ("/Users/me/app" -> "/Users/me"), if any. */
export function homeOfPath(p?: string | null): string | undefined {
  return typeof p === "string" ? HOME_AT_START.exec(p)?.[0] : undefined;
}

/** The home folder, guessed from the folders Claude worked in. */
export function homeFromCwds(cwds?: readonly (string | undefined | null)[]): string | undefined {
  for (const c of cwds ?? []) {
    const h = homeOfPath(c);
    if (h) return h;
  }
  return undefined;
}

// Home folders named like this are machines or shared accounts, not a person's name, and masking the word
// everywhere would hide ordinary text ("run the test", "the main branch").
const NOT_NAMES = new Set(
  "user users home page test main node runner root admin app dev code src build work data ubuntu vscode shared public".split(" "),
);
const NAME_IN_PATH = /^(?:(?:\/mnt)?\/[A-Za-z](?=\/Users\/))?(?:\/Users|\/home|[A-Za-z]:(?:\\{1,2}|\/)(?:Users|users|USERS))(?:\\{1,2}|\/)([^\\/]+)/;

/**
 * User names from trusted paths only: the server's home folder and the open session's working folders.
 * Never from arbitrary log text. Names under 3 letters and common words are skipped.
 */
export function userNamesFrom(paths: readonly (string | undefined | null)[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    const name = typeof p === "string" ? NAME_IN_PATH.exec(p)?.[1] : undefined;
    if (!name || name.length < 3 || NOT_NAMES.has(name.toLowerCase())) continue;
    if (!out.some((n) => n.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out;
}

/**
 * `names` are matched as whole words and case-insensitively, on purpose: a user named "Mark" also hides the
 * word "mark" in ordinary text. That's the price of catching "mark", "MARK" and "Mark" in shell output.
 */
export type MaskOptions = { home?: string; names?: readonly string[] };
export type Masker = (text: string) => string;

/**
 * Everything "Hide sensitive text" hides: secrets, private keys, the exact home folder, any home folder by
 * its shape, Claude Code's dash-spelled folder names, and the given user names as whole words (any case).
 */
export function createMasker(opts: MaskOptions = {}): Masker {
  const names = (opts.names ?? []).filter((n) => n.length >= 3 && !NOT_NAMES.has(n.toLowerCase()));
  // Each name as written, plus how it's spelled in Claude Code's folder names ("John Smith" -> "John-Smith")
  // and in URLs ("%2Falice", "%5Calice").
  const dashed = [...new Set(names.map(encodeName).filter((d) => d.length >= 3))];
  const namesRe = names.length ? new RegExp(`(?<![\\w.-])(?:${names.map(escapeRe).join("|")})(?![\\w-])`, "gi") : undefined;
  const encodedRe = names.length ? new RegExp(`(%2F|%5C)(?:${names.map((n) => escapeRe(encodeURIComponent(n))).join("|")})(?![\\w-])`, "gi") : undefined;
  const dashedRe = dashed.length
    ? new RegExp(`(^|[^\\w-])((?:[A-Za-z]-)?-(?:Users|home)-)(?:${dashed.map(escapeRe).join("|")})(?=-|$|[^\\w-])`, "gi")
    : undefined;
  return (text: string) => {
    if (typeof text !== "string" || !text) return text;
    let out = maskSecrets(text, opts.home).replace(HOME, "~");
    if (dashedRe) out = out.replace(dashedRe, "$1$2~");
    out = out.replace(ENCODED_HOME, "$1$2~");
    if (namesRe) out = out.replace(namesRe, MASK);
    if (encodedRe) out = out.replace(encodedRe, `$1${MASK}`);
    return out;
  };
}

// Claude Code's folder names replace every character but letters and digits with "-".
const encodeName = (name: string) => name.replace(/[^A-Za-z0-9]/g, "-");

/** One-off masking; prefer createMasker when masking many strings with the same options. */
export const maskText = (text: string, opts?: MaskOptions): string => createMasker(opts)(text);

// How far past a cut masking still looks, so a secret that straddles the cut is recognised and hidden whole.
const CLIP_MARGIN = 2000;

/**
 * Masks, then cuts at `max` characters, for render caps ("Show all"). Masking a margin past the cut means a
 * secret straddling it is hidden whole instead of showing its first half.
 */
export function maskThenClip(text: string, max: number, mask: Masker): string {
  return text.length <= max ? mask(text) : mask(text.slice(0, max + CLIP_MARGIN)).slice(0, max);
}

/**
 * Masks, then cuts at `max` characters and adds "…" when something was cut: for short previews on screen.
 */
export function maskClip(text: string, max: number, mask: Masker): string {
  const out = maskThenClip(text, max, mask);
  return text.length > max && out.length >= max ? `${out}…` : out;
}

/**
 * Shortens text that is stored or sent before anything can mask it (titles, subtitles, helper names). It
 * never cuts inside a word: the word that crosses `max` is kept whole, then "…", so masking afterwards still
 * sees every secret whole, and one long word isn't lost. A word longer than CLIP_MARGIN is cut at that hard
 * limit (masking still recognises the start of most keys). The page shortens the result further on screen.
 */
export function safeClip(text: string, max: number): string {
  if (text.length <= max) return text;
  const space = text.slice(max).search(/\s/);
  if (space < 0) return text.length <= max + CLIP_MARGIN ? text : `${text.slice(0, max + CLIP_MARGIN)}…`;
  if (space > CLIP_MARGIN) return `${text.slice(0, max + CLIP_MARGIN)}…`;
  const head = text.slice(0, max + space).trimEnd();
  return head.length < text.trimEnd().length ? `${head}…` : head;
}
