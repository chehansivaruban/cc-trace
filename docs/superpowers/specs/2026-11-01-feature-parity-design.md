# cc-trace: feature parity and beyond

Date: 2026-11-01 · Status: draft for approval

## Why

Many tools now show what Claude Code is doing. cc-trace's edge is that it's for people who have never written code: plain
English, the multi-agent story, and Claude's memory across requests. To stop it being "just another tool", it should also
have every useful feature the five closest competitors have, and then features none of them have.

Competitors analysed (details and evidence in `docs/research/competitors.md`):
delexw/claude-code-trace (383★), simple10/agents-observe (712★), harrylettering/claude-trace-replay (264★),
anaypaul/claude-session-visualizer, drapermcp/claude-session-viewer (+ Lition13's Electron viewer).

## Rules that don't change (from the owner)

1. **Zero tokens.** cc-trace never calls Claude or any AI service.
2. **No extra copies of history.** Nothing from the logs is written to disk. Small per-browser preferences (theme, zoom) are OK.
3. **Read-only and local-only.** Never modifies, moves or deletes Claude Code files; never sends data off the machine; never installs hooks.
4. **Plain English first.** Every new screen must make sense to a non-coder; technical detail stays one click away.
5. **Windows, macOS and Linux.** CI must stay green on all three.

Competitor features that break a rule are listed under "Not doing" with the reason, and a rule-compliant alternative where one exists.

## What cc-trace already has

Project and session pickers; request list; interactive map (one row per agent, messages as arrows, replay with speed and
scrub, live follow, messages-only filter, zoom/pan/fit); plain-English step explanations with technical details;
who's-who agent cards; request summary; real token counts (re-read / new / written); helper (sub-agent) logs incl. late
starters; "Remembers earlier" memory steps; whole-session flow with memory stream and compaction; memory chart; How-it-works
guide; glossary hovers; welcome card; light/dark; legend; keyboard (← → space + − 0).

## Gap list: features to add

Grouped into work areas. "Source" names which competitors have it.

### A. Finding sessions (picker and navigation)
- A1. Session browser: sessions grouped by date (Today / Yesterday / This week / This month / Older), search by title,
  first prompt, id and model, project filter, sort by activity or start. Source: all five.
- A2. Rich session cards: title from `/rename` (`custom-title`) or Claude's auto title (`ai-title`), else first prompt;
  model; requests; tokens; estimated cost; duration; helper count; git branch; **Live** badge. Source: claude-code-trace, Lition13, agents-observe.
- A3. Live sessions: read Claude Code's running-session registry (`~/.claude/sessions/*.json`) to show which sessions are
  running now, plus Claude Code version and app. Source: claude-session-visualizer, claude-code-trace.
- A4. Worktree and fork grouping: sessions run in a git worktree shown under their main project. Source: claude-code-trace, agents-observe.
- A5. Totals across listed sessions (tokens, cost). Source: claude-code-trace.
- A6. Deep links: the URL records project, session, request, view and step; back/forward work; a clear "not found" page. Source: agents-observe.
- A7. Copy resume command, copy fork command, copy session id. Source: agents-observe, claude-code-trace, drapermcp.
- A8. Open a .jsonl file by drag and drop (view a log someone sent you, read in the browser only). Source: claude-trace-replay.

### B. Reading a request in full (new "Conversation" view)
- B1. Chat-style transcript: your messages, Claude's replies with markdown and code highlighting, timestamps, model badge,
  per-message tokens and cost, copy button. Source: all.
- B2. Special rows: compaction separator, API errors, interrupted / denied / orphan tool calls, recaps. Source: claude-code-trace.
- B3. Thinking blocks when recorded (collapsed, length); a plain note when hidden. Source: claude-session-visualizer, Lition13.
- B4. Rich tool renderers (shared by Conversation and step details): Edit as a red/green diff with word highlights
  (from `structuredPatch` when present), Write as "new file", Read with language, Bash command / output / exit code,
  Grep/Glob results, web fetch/search, AskUserQuestion questions + options + answer, to-do lists, images inline, MCP
  connector naming. Source: Lition13, agents-observe, claude-trace-replay, claude-code-trace.
- B5. Per-tool duration (parallel calls not double-counted). Source: claude-code-trace.
- B6. Find in this request (⌘/Ctrl+F) with match count and next/previous. Source: drapermcp, Lition13.
- B7. Large-session performance: only render what's on screen (virtualized lists). Source: claude-code-trace, agents-observe.

### C. Searching and filtering
- C1. Search across all sessions (prompts, replies, tool input and output), results grouped by session, click to jump to the step. Streamed from the log files on demand; no index stored. Source: Lition13.
- C2. Map and conversation filters: category pills (Your messages, Tools, Helpers, Errors, Permissions, Memory/compaction,
  Connectors), auto pills per tool and per command (git, npm…), agent filter, text filter, "showing X of Y". Source: agents-observe, claude-session-visualizer, claude-trace-replay.

### D. Understanding cost and effort (new "Stats" view)
- D1. Built-in, offline pricing table per model (Opus, Sonnet, Haiku generations, prefix matching), incl. cache read and
  cache write (5 min / 1 h). Estimated cost shown everywhere tokens are. Clearly labelled "estimate; not your bill; plans differ". Source: claude-code-trace, Lition13, agents-observe.
- D2. Session stats: totals, cache hit %, tables by model, by agent and by request (sortable, click to jump). Source: agents-observe.
- D3. Charts: cumulative tokens and cost over the session; output per reply (click a bar to jump); tool ranking with
  success rate and longest call. Source: claude-session-visualizer, Lition13, claude-trace-replay, agents-observe.
- D4. Files touched: lists of files read, created and changed, with counts; click to see each change. Source: drapermcp, agents-observe.
- D5. Context gauge: how full Claude's memory was at each request, relative to the model's window. Source: claude-code-trace (improved: per-model window).
- D6. Overview across all sessions (new "Dashboard"): totals, last-30-days daily trend, cost by model, by project, top
  tools. Computed by scanning on demand. Source: Lition13.

### E. Problems and health (new "Health" view)
- E1. Errors: error strip over the request (click to jump), "X of Y tool calls failed", most-failing tool, error list,
  what Claude did next (retried / tried something else / gave up). Source: claude-session-visualizer.
- E2. Efficiency checks, local heuristics only: repeated identical tool calls, fix loops (same failing command again and
  again), empty results, excessive reads of the same file, write-then-edit churn, high error rate. A health score 0–100
  with findings that jump to steps. Source: Lition13, claude-trace-replay (replaces the competitors' AI-based scoring).
- E3. Hooks: hook runs, failures (incl. non-zero exit marked as success), time, stderr. Source: claude-trace-replay.

### F. Agents and teams
- F1. Agent tree: who created whom, nested, with collapse/expand and status (in who's-who and whole-session view). Source: claude-session-visualizer, claude-code-trace.
- F2. Task board: tasks and to-dos created by Claude/helpers, with status and owner. Source: claude-code-trace, Lition13.
- F3. Teams: team members, colours, messages between teammates. Source: claude-code-trace, Lition13.
- F4. Per-helper totals: tokens, cost, tool calls, duration; most expensive helper. Source: claude-trace-replay, agents-observe.

### G. Live and attention
- G1. "Needs you" alert when Claude is waiting (a question, a plan to approve, a permission request): badge on the
  session, tab title and favicon change, optional desktop notification (browser Notification API, local). Source: agents-observe (cc-trace adds the desktop notification they lack).
- G2. "Live now" list: every running session across projects, at a glance. Source: agents-observe, claude-session-visualizer.

### H. Sharing and comparing
- H1. Export a request or session as a single offline HTML file (same plain-English view) and as Markdown; JSON download. Source: Lition13, drapermcp, claude-session-visualizer.
- H2. Compare two sessions or requests: metrics with differences, top tools, models. Source: claude-trace-replay, Lition13.

### I. Settings and keyboard
- I1. Settings panel: theme (light / dark / system), text size, density, show/hide technical details by default, where the logs are read from (read-only display). Source: agents-observe, claude-code-trace, Lition13.
- I2. Full keyboard map with a `?` overlay: ↑/↓ or j/k between sessions and steps, `/` search, `g`/`G` start/end, view
  switching keys, Esc. Source: claude-code-trace, agents-observe.
- I3. Session info bar: permission mode, git branch, working folder(s), Claude Code version and app. Source: claude-code-trace.
- I4. Debug log viewer when Claude Code debug logs exist (`~/.claude/debug/<id>.txt`), with level filter. Source: claude-code-trace.

## Not doing (break a rule)

| Competitor feature | Rule broken | cc-trace alternative |
| --- | --- | --- |
| AI "analyze" / retrospective / AI comparison (xAI, claude CLI, Jev) | Zero tokens, data leaves machine | E2 local health checks and N1 story summary |
| Hooks + Docker + SQLite event database | Installs into Claude Code, stores copies, adds latency | Read the logs Claude already writes |
| Delete / archive / move / rename sessions on disk | Read-only | Copy resume/fork commands |
| Pricing fetched from the internet | Local-only | Built-in pricing table |
| Images stored in IndexedDB | No extra copies | Render images straight from the log |
| Reading arbitrary project files ("file viewer") | Reads beyond Claude's logs | Show file contents/diffs as recorded in the log |
| Authenticated REST API for scripts, background service | Scope; security surface | Not needed |
| Bookmarks / tags / pins / custom names | Needs storage | **Owner decision** (see below) |

## New features nobody has

- N1. **Story summary**: a plain-English paragraph for every request and session, built from the data (no AI): what you
  asked, what Claude did, who helped, what changed, how it ended.
- N2. **What changed in my project**: every file touched in a session, grouped per file, with each change as a diff in
  order: a "before / after" for non-coders.
- N3. **Risky-action alerts**: flag and explain risky steps (deleting files, `rm -rf`, force push, installing software,
  writing outside the project folder, bypass-permissions mode).
- N4. **Hide sensitive text**: one switch that masks keys, tokens, passwords, emails and home paths everywhere on screen
  and in exports, for screenshots and sharing.
- N5. **Phases**: each request split into phases (exploring, changing files, testing, reviewing, answering), shown as a
  band above the map.
- N6. **Why Claude did it**: each tool step links to Claude's nearest explanation ("Let me check the tests…").
- N7. **Agent chat view**: the conversation between agents as a group chat (briefs, follow-ups, reports), readable top to bottom.
- N8. **Token-saving tips**: per request, plain advice from the numbers (memory very full → consider /compact or /clear;
  big file read repeatedly; helper re-reading the same files).
- N9. **Guided tour**: a short interactive walkthrough highlighting each part of the screen for first-time users.

## Architecture

- **Server (Next.js API routes), all read-only:**
  - `/api/sessions` gains titles, model, live state, git branch, worktree parent; computed from the head and tail of each log.
  - New `/api/search?q=` streams matches across logs; new `/api/overview` scans all logs for the dashboard; new
    `/api/live` reads the running-session registry; new `/api/debug-log` reads the debug log for a session.
  - Each stays bounded (time/size limits) and refuses paths outside the Claude folder.
- **Model (`src/lib/session.ts`)** gains: costs (via new `src/lib/pricing.ts`), per-tool duration, permission mode, git
  branch, compaction and API-error rows, thinking, images, task and team records, hook records, risk flags, phases.
- **Analytics (`src/lib/analytics/*`)**: pure functions over the model: stats tables, files touched, health checks,
  errors and recovery, story summary, tips. Each is tested in the self-check.
- **Views**: a view switcher per session: Map (today's), Conversation, Stats, Health, Files, Agents (tree, tasks, teams,
  chat), plus Whole session; app-level Dashboard, Live now, Search, Compare and Settings.
- **Renderers (`src/components/tools/*`)**: one renderer per tool family, shared by Conversation and step details.
- **URL state (`src/lib/route.ts`)**: one place that reads/writes the hash for deep links.
- **Tests**: unit checks for every analytics function (`scripts/session.check.mts`), smoke test extended for new API
  routes, CI on Windows/macOS/Linux.

## How the work is split (multiple agents)

Phase 0 (lead, sequential): shared foundations so agents don't collide: the view switcher and router, the extended
model types, pricing, the analytics folder layout, the tool-renderer registry, and test scaffolding.

Phase 1 (parallel agents, each in its own git worktree, each owning separate files):
1. Sessions & navigation: A1–A8, G2, I3 (server `/api/sessions`, `/api/live`; picker and home components).
2. Conversation & renderers: B1–B7, N4, N6 (conversation view, tool renderers, find-in-request).
3. Stats & costs: D1–D6, F4, N8 (stats view, dashboard, `/api/overview`, charts).
4. Health & files: E1–E3, N2, N3, N5 (health view, files view, analytics heuristics).
5. Agents & sharing: F1–F3, N7, H1, H2, C1, C2, N1 (agents view, export, compare, search).
6. Settings, keyboard, attention, onboarding, bookmarks: I1, I2, I4, G1, N9, J1.

The lead merges each branch, resolves the few shared touchpoints (view registry, page), runs the full test suite and
the browser checks, then a fresh reviewer agent reviews the whole change against this spec before release.

## Owner decisions (2026-11-01)

1. Bookmarks, tags and custom names: **yes, stored in this browser only** (localStorage; tiny; never sent anywhere;
   wrapped in try/catch so cc-trace still works when storage is blocked). Added as J1 below; owned by workstream 6.
2. Desktop notifications when Claude needs you: **yes, off until switched on in Settings**; the browser asks once.
3. Release: **one 0.2.0 release** after everything is built and tested.

### J. Personal organisation (decision 1)
- J1. Bookmark a session or a step, add tags, give a session your own name; filter the session browser by tag or
  bookmark; a Bookmarks list. Browser storage only. Source: drapermcp, agents-observe, Lition13.
