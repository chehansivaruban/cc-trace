// "Hide sensitive text" for everything the UI shows: secrets via maskSecrets, plus any home folder
// (/Users/<name>, /home/<name>, C:\Users\<name>) shortened to "~", since the browser can't know the real one.
import { maskSecrets } from "./redact.ts";
import { useSettings } from "./settings.ts";

// One or two backslashes: JSON-encoded Windows paths double them. "Shared" and "Public" are not people.
const HOME = /(?:\/Users|\/home|\b[A-Za-z]:(?:\\{1,2}|\/)Users)(?:\\{1,2}|\/)(?!(?:Shared|Public)\b)[^\\/\s"'`:;,()<>[\]{}]+/g;

// Claude Code's folder names spell the path with dashes: "-Users-alice-app", "C--Users-alice-app", "-home-alice-app".
const ENCODED_HOME = /(^|[^\w-])((?:[A-Za-z]-)?-(?:Users|home)-)(?!(?:Shared|Public)-)[^-\\/\s"'`]+/g;

export const maskText = (text: string): string => maskSecrets(text.replace(HOME, "~").replace(ENCODED_HOME, "$1$2~"));
const same = (text: string) => text;

/** Returns the function every log-derived string goes through before it's shown. */
export function useMask(): (text: string) => string {
  const [settings] = useSettings();
  return settings.maskSensitive ? maskText : same;
}
