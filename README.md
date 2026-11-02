# cc-trace

See what [Claude Code](https://docs.claude.com/en/docs/claude-code) is actually doing, in plain English. Made for people who have never written code.

cc-trace turns a Claude Code session into an interactive map: one row for you, one for Claude, and one for every helper agent Claude brings in. Each step is a box that explains itself ("Reads a file", "Runs the tests", "Brief to Reviewer") and every message between agents is an arrow you can follow. Watch it live while Claude works, or press **Replay** to watch any request unfold step by step.

- **Costs nothing.** cc-trace never talks to Claude or any AI service. Running it uses zero tokens and has no effect on Claude Code.
- **Read-only.** It only reads the logs Claude Code already writes to `~/.claude`, never changes them and never saves your conversations anywhere else.
- **Local-only.** The server listens on `127.0.0.1` and refuses non-localhost requests. No telemetry, no network calls.
- **Live.** New steps appear as Claude works, including helpers that start later.

## Run it

### With Node.js (20.9+)

Works the same on macOS, Windows and Linux:

```bash
npx cc-trace-map
```

Opens `http://localhost:4747` (or the next free port). Options: `--port 5000`, `--no-open`.

### With Docker

macOS / Linux:

```bash
docker run --rm -p 127.0.0.1:4747:4747 -v ~/.claude:/claude:ro cc-trace
```

Windows (PowerShell):

```powershell
docker run --rm -p 127.0.0.1:4747:4747 -v "$env:USERPROFILE\.claude:/claude:ro" cc-trace
```

Build the image first with `docker build -t cc-trace .` from this repo. The `:ro` mount means the container can't modify your logs. Inside Docker the app polls the log file once a second, because Docker Desktop doesn't reliably forward file-change events.

On Linux, if you get permission errors reading the logs, add `--user "$(id -u):$(id -g)"`.

## Features

### Find a session

- **Session browser:** every session on your computer, newest first, grouped by day, with search (titles, first messages, ids, models), a project filter that keeps worktrees under their project, and "Running now".
- **Live now:** the sessions Claude Code has open on this computer right now; pick one to watch it as it happens.
- **Search everything:** find a word in every session at once and jump straight to the request or step.
- **Dashboard:** how much you used Claude Code over the last days and weeks, in tokens, sessions and requests.
- **Open a log file:** drag a `.jsonl` log onto the page (or use "Open a log file…") to read one someone sent you. It stays in your browser.

### Read it

- **The map:** one row per agent, time running left to right. Boxes explain each step in plain words; ✓ worked, ✕ didn't (Claude usually tries another way). Messages between agents are dashed arrows, with an envelope travelling along them during a replay.
- **Replay:** play, pause, step through, scrub, change speed, or jump back to **Live**.
- **Conversation:** the same request read like a chat, with Claude's replies formatted, each tool step one line that opens into a readable view (commands and their output, before-and-after changes, searches, web pages, to-do lists, questions Claude asked you). Find in a request with ⌘F / Ctrl+F.
- **Filter steps:** show only your messages, tools, helpers, errors, a tool, a command, an agent or some text, on the Map and the Conversation.
- **Explanations:** click any box for what happened and why, with the technical details behind a toggle. Hover a dotted word (helper, brief, tokens, tests…) for a one-line explanation.

### Understand it

- **Agents:** who created whom, the to-do lists they kept, the messages they sent each other, and a short written story of the session.
- **Stats:** tokens per request, per agent and per model, how much was re-read from cache, how full Claude's memory got, and how long things took.
- **Health:** a rough score with what stood out: repeated steps, loops, errors, hooks, and commands worth a second look ("Take care" and "Risky"). Risky steps also get a dot on the map, and a band above the map shows what Claude was mostly doing when.
- **Files:** every file Claude read, changed or created, with the changes.
- **Whole session:** how each request led to the next, and what Claude still remembered.
- **Compare:** two sessions, or two requests, side by side to see which took more effort: tokens, time, errors and the models used.
- **"Claude needs you":** when Claude is waiting on a question, a plan or (probably) your permission, the tab title and icon change, and you can turn on a desktop notification.
- **Debug log:** Claude Code's own diary for the session (only there when Claude Code ran with `--debug`), with filters.

### Share it

- **Export:** a request or the whole session as a web page that opens without cc-trace, as Markdown, or as raw data.
- **Copy commands:** copy the command that reopens a session in Claude Code, or starts a new one from a copy of it.
- **Links:** every session, request, view and step has its own address, so the back button works and links can be saved.

### Make it yours

- **Bookmarks:** bookmark a session or a single step, name sessions, tag them, and find them again in Bookmarks or the session browser.
- **Settings:** light or dark, text size (Smaller to Largest), reduce motion, technical details shown by default, "Hide sensitive text", and desktop notifications.
- **Keyboard shortcuts** and a short **tour** of the screen, plus a **How it works** guide for newcomers.
- Works on small screens too.

## Keyboard shortcuts

Press `?` in the app to see them.

| Keys | What they do |
| --- | --- |
| `?` | Show the shortcuts |
| `/` | Search all sessions |
| `g` then `d` | Go to the dashboard |
| `g` then `l` | Go to Live now |
| `1` to `7` | Switch view: Map, Conversation, Agents, Stats, Health, Files, Whole session |
| `j` or `↓` | Next request (`↓` on the map) |
| `k` or `↑` | Previous request (`↑` on the map) |
| `g` then `g` | First request |
| `G` | Newest request |
| `[` or `]` | Previous or next session |
| `b` | Bookmark the selected step, or the session |
| `Esc` | Close a panel or dialog |
| `←` or `→` | Step through the request on the map |
| `Space` | Play or pause the replay |
| `+` or `−` | Zoom the map in or out |
| `0` | Fit the map to the screen |

Shortcuts pause while you type in a box.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Where to find `projects/` (same variable Claude Code uses). |
| `PORT` | `4747` | Port for `npx cc-trace-map`. |
| `CC_TRACE_POLL` | unset | Set to `1` to poll for file changes instead of using native events. |

## Develop

```bash
pnpm install
pnpm dev        # http://localhost:4747 with hot reload
pnpm check      # self-checks (Node 22.6+); add `-- --all` to also run the model on your real sessions
pnpm build      # production build used by `npx cc-trace-map`
pnpm smoke      # starts the built server against a fake log and checks it end to end
```

CI runs the build and the smoke test on Windows, macOS and Linux, with Node 20 and 22, including a copy installed from the packed npm package.

Stack: Next.js 15 (App Router), React 19, Tailwind CSS 4, shadcn/ui, Framer Motion, chokidar.

| Path | What it does |
| --- | --- |
| `src/lib/claude-logs.ts` | Finds projects and sessions; validates requested paths. |
| `src/lib/session.ts` | Turns the main log and each sub-agent log into agents, steps, messages and requests. |
| `src/lib/explain.ts` | Plain-English explanations of each tool, and the glossary (`GLOSSARY`). |
| `src/lib/analytics/` | Stats, health, risks, phases, files, filters and stories, worked out from the model. |
| `src/lib/redact.ts` | "Hide sensitive text": masks secrets, home folders and user names. |
| `src/app/api/stream/route.ts` | SSE endpoint that replays a session and its sub-agent logs, then tails them. |
| `src/components/` | Header, request list, map, explanation panel, help guide; `views/` and `pages/` hold the tabs and app pages. |
| `bin/cc-trace.mjs` | The `npx cc-trace-map` entry point (installed as `cc-trace` and `cc-trace-map`). |
| `scripts/smoke.mjs` | Cross-platform end-to-end test of the real server. |

### Publishing

```bash
npm publish     # runs the check and a production build first
```

## Privacy

- **No tokens, no money, no network.** cc-trace never calls Claude, any AI service or any other host. Nothing you see costs anything, and token numbers are read from the logs, never estimated.
- **Read-only.** It never changes, moves or deletes anything in your Claude folder and never installs hooks. It doesn't copy your history: logs are read when you open them and held in memory only. The one exception is a bookmark: it keeps a short label (the step or session title, at most 160 characters, with secrets like passwords and keys hidden) in this browser, so the Bookmarks page can show it.
- **Stays in this browser.** Your settings, bookmarks, tags and session names are saved in this browser's storage, nowhere else. A log you drag onto the page is read in the browser and never sent to the server.
- **Hide sensitive text.** Session logs contain everything you and Claude typed, including any secrets that appeared in prompts or tool output. Turn on **Settings → Hide sensitive text** before taking screenshots or exporting: it hides passwords, API keys, tokens and private keys, your home folder (also in Claude Code's dash-spelled folder names) and your user name, on screen and in exports (each export can also switch it on or off). It works by recognising these patterns, so give a screenshot a last look before you share it.
- Don't expose cc-trace's port to a network.

## License

MIT. cc-trace is an independent project and is not affiliated with or endorsed by Anthropic.
