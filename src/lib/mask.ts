// "Hide sensitive text" for everything the UI shows: secrets via maskSecrets, private-key blocks, plus any home
// folder (/Users/<name>, /home/<name>, C:\Users\<name>) shortened to "~", since the browser can't know the real one.
import { maskSecrets } from "./redact.ts";
import { useSettings } from "./settings.ts";

// Only at a path boundary (start, whitespace, quote, =, (, :, comma, brackets), so "https://x.com/home/page" stays.
// One or two backslashes: JSON-encoded Windows paths double them. "Shared" and "Public" are not people.
const HOME =
  /(?<=^|[\s"'`=(:,[{<>])(?:\/Users|\/home|[A-Za-z]:(?:\\{1,2}|\/)Users)(?:\\{1,2}|\/)(?!(?:Shared|Public)\b)[^\\/\s"'`:;,()<>[\]{}]+/g;

// Claude Code's folder names spell the path with dashes: "-Users-alice-app", "C--Users-alice-app", "-home-alice-app".
const ENCODED_HOME = /(^|[^\w-])((?:[A-Za-z]-)?-(?:Users|home)-)(?!(?:Shared|Public)-)[^-\\/\s"'`]+/g;

// A private key block, possibly cut off before its END line. Each line of the body becomes ••• so line counts
// (and the diff rows built on them) don't change.
const PEM = /(-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----)([\s\S]*?)(-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g;

// User names seen in home folders (this page's session folders, or any path masked so far). They also turn up
// on their own: file owners in "ls -l", shell prompts, git authors. Names under 4 letters would hide ordinary words.
const names = new Set<string>();
let namesRe: RegExp | undefined;
const NAME_IN_HOME = /(?<=^|[\s"'`=(:,[{<>])(?:\/Users|\/home|[A-Za-z]:(?:\\{1,2}|\/)Users)(?:\\{1,2}|\/)([^\\/\s"'`:;,()<>[\]{}]+)/g;
function learn(text: string) {
  let added = false;
  for (const m of text.matchAll(NAME_IN_HOME)) {
    const name = m[1];
    if (name.length >= 4 && !/^(Shared|Public)$/.test(name) && !names.has(name)) {
      names.add(name);
      added = true;
    }
  }
  if (added) namesRe = new RegExp(`(?<![\\w.-])(?:${[...names].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\w-])`, "g");
}

/** Remember the user names in these paths (e.g. the session's working folders) so they're masked anywhere. */
export function rememberHomes(paths: string[]) {
  for (const p of paths) if (typeof p === "string") learn(p);
}

export const maskText = (text: string): string => {
  learn(text);
  const out = text
    .replace(PEM, (_, begin: string, body: string, end: string) => begin + body.replace(/[^\n]+/g, (l) => (l.trim() ? "•••" : l)) + end)
    .replace(HOME, "~")
    .replace(ENCODED_HOME, "$1$2~");
  return maskSecrets(namesRe ? out.replace(namesRe, "•••") : out);
};
const same = (text: string) => text;

/** Returns the function every log-derived string goes through before it's shown. */
export function useMask(): (text: string) => string {
  const [settings] = useSettings();
  return settings.maskSensitive ? maskText : same;
}
