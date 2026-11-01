# cc-trace

See what [Claude Code](https://docs.claude.com/en/docs/claude-code) is actually doing, in plain English. Made for people who have never written code.

cc-trace turns a Claude Code session into an interactive map: one row for you, one for Claude, and one for every helper agent Claude brings in. Each step is a box that explains itself ("Reads a file", "Runs the tests", "Brief to Reviewer") and every message between agents is an arrow you can follow. Watch it live while Claude works, or press **Replay** to watch any request unfold step by step.

- **Costs nothing.** cc-trace never talks to Claude or any AI service. Running it uses zero tokens and has no effect on Claude Code.
- **Saves nothing.** It only reads the logs Claude Code already writes to `~/.claude/projects`, never writes to them, and keeps no copies. Close the tab and it's gone.
- **Local-only.** The server listens on `127.0.0.1` and refuses non-localhost requests. No telemetry, no network calls.
- **Live.** New steps appear as Claude works, including helpers that start later.

## Run it

### With Node.js (20.9+)

Works the same on macOS, Windows and Linux:

```bash
npx cc-trace
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

- **Project and session pickers:** every project Claude Code has run in, newest sessions first, with how many helpers each session used.
- **Your requests:** each message you sent is listed on the left; pick one to see everything it set off.
- **The map:** one row per agent, time running left to right. Boxes explain each step in plain words; ✓ worked, ✕ didn't (Claude usually tries another way).
- **Agents talking to each other:** briefs, follow-up messages and reports are dashed arrows between rows, and an envelope travels along them during replay. Tick **Only messages between agents** to see just the conversation.
- **Replay:** play, pause, step with ← and →, scrub, change speed, or jump back to **Live**.
- **Explanations:** click any box for what happened and why, with the technical details hidden behind a toggle. Click an agent's name for who it is, who created it, its brief and how much it did.
- **Request summary:** what happened in plain words: helpers used, messages passed, files read and changed, test runs, problems, time taken and Claude's answer.
- **Real token counts:** taken from the logs (not estimated), split into re-read (cached), new and written, per request and per agent.
- **How it works guide** and **hover-to-explain words** (helper, brief, tokens, tests…) for newcomers.
- **Light and dark mode,** and layouts for small screens.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Where to find `projects/` (same variable Claude Code uses). |
| `PORT` | `4747` | Port for `npx cc-trace`. |
| `CC_TRACE_POLL` | unset | Set to `1` to poll for file changes instead of using native events. |

## Develop

```bash
pnpm install
pnpm dev        # http://localhost:4747 with hot reload
pnpm check      # self-check for the log → story mapping (Node 22.6+); add `-- --all` to run it on your real sessions
pnpm build      # production build used by `npx cc-trace`
pnpm smoke      # starts the built server against a fake log and checks it end to end
```

CI runs the build and the smoke test on Windows, macOS and Linux, with Node 20 and 22, including a copy installed from the packed npm package.

Stack: Next.js 15 (App Router), React 19, Tailwind CSS 4, shadcn/ui, Framer Motion, chokidar.

| Path | What it does |
| --- | --- |
| `src/lib/claude-logs.ts` | Finds projects and sessions; validates requested paths. |
| `src/lib/session.ts` | Turns the main log and each sub-agent log into agents, steps, messages and requests. |
| `src/lib/explain.ts` | Plain-English explanations of each tool, and the glossary. |
| `src/app/api/stream/route.ts` | SSE endpoint that replays a session and its sub-agent logs, then tails them. |
| `src/components/` | Header, request list, map, explanation panel, help guide. |
| `bin/cc-trace.mjs` | The `npx` entry point. |
| `scripts/smoke.mjs` | Cross-platform end-to-end test of the real server. |

### Publishing

```bash
npm publish     # runs the check and a production build first
```

## Privacy note

Session logs contain everything you and Claude typed, including any secrets that appeared in prompts or tool output. cc-trace keeps them on your machine, but don't expose its port to a network or share screenshots without checking them.

## License

MIT. cc-trace is an independent project and is not affiliated with or endorsed by Anthropic.
