# Competitor research (2026-11-01)

Five local tools similar to cc-trace, analysed by reading their docs and source (nothing was run).
Each section lists what they offer that cc-trace did not have at the time. Ratings: ★ = worth matching, ⚠ = conflicts with
cc-trace's rules (zero tokens, no extra storage, local-only, read-only), — = weak/broken in the competitor.

## 1. drapermcp/claude-session-viewer (+ Lition13/claude-session-viewer, Electron)

drapermcp: Express + vanilla JS, 0 stars, single commit, abandoned. Writes to disk, deletes/moves real logs, binds all interfaces.
Lition13 (`npx claude-session-browser`): Electron + React + Shiki, 9 stars, local-only, the richer of the two.

- ★ Full conversation view with markdown rendering, per-message copy, timestamps, per-message tokens and model.
- ★ Per-tool renderers: Edit as red/green diff, Read with language badge, Write "CREATE", Bash stdout/stderr, Grep/Glob, WebFetch/Search, AskUserQuestion option cards, TodoWrite lists, Agent "view sub-agent", Agent Teams (TeamCreate, SendMessage routing, teammate-message cards), slash commands with ANSI colours, images with lightbox, syntax highlighting.
- ★ Thinking blocks (collapsed, character count) where present.
- ★ Files touched panel (read / written / edited, counts).
- ★ Cross-session full-text search (Ctrl+Shift+F) with jump-to-message; in-view search with match counter and next/prev (Cmd+F).
- ★ Session list grouped by date (Today/Yesterday/This week/month), project filter, session metadata (first prompt, messages, tools, size, git branch).
- ★ Replay controls: play/pause, 0.5–5× speed, seek, next/prev user message, keyboard (cc-trace already has most).
- ★ Session compare side by side.
- ★ Stats: tokens in/out/cache read/cache write incl. sub-agents (dedupe by message.id), tool ranking chart, output-tokens-per-turn chart (click to jump), models used.
- ★ Cost per model with built-in Opus/Sonnet/Haiku pricing and prefix matching.
- ★ Health score 0–100 and inefficiency detection: repeated_tool, fix_loop, empty_result, excessive_reads, large_write_then_edit; complexity metrics (depth, output/turn, thinking ratio, tool density, error rate).
- ★ Global dashboard: totals, 30-day daily trend, tool ranking, model usage, cost by model.
- ★ Export: self-contained offline HTML and Markdown (thinking in details).
- ★ Copy `claude --resume <id>`; "Open in Claude Code" (spawns terminal).
- ★ Keyboard: ↑/↓ or Alt+↑/↓ switch session, Ctrl+D dashboard, Ctrl+E export, ? help overlay.
- ★ Themes (dark/light/sepia), font and font size settings.
- ⚠ Bookmarks / tags / custom names (stored in localStorage; Lition13 writes custom-title INTO the JSONL).
- ⚠ AI "Analyze" completeness score and cross-session "Insights" (sends transcripts to xAI, costs tokens).
- ⚠ Archive / restore / delete sessions (moves or deletes real logs).
- ⚠ File viewer reading current on-disk project files (reads beyond logs).

## 2. anaypaul/claude-session-visualizer

Hono + React + React Flow + Recharts, 1 star, dormant since March 2026, dev-mode only. Reads JSONL + subagents + ~/.claude/sessions PID files; optional HTTP hooks.

- ★ Live vs closed sessions (from ~/.claude/sessions/*.json PID registry) with Live/Closed/All filter.
- ★ Session search by id / cwd / project; sidebar collapsible; auto-select live session.
- ★ Timeline with turn grouping, message bubbles, model badge, tool result/error bubbles, "Turn completed in Xs" (system turn_duration), per-message tokens, auto-scroll with "scroll to bottom".
- ★ Execution tree (React Flow): agent nodes with status, type, description, message/tool counts; nested agents via parentAgentId; collapse/expand tool chains; minimap; running animation; red error glow.
- ★ Costs tab: cumulative stacked token burn chart per turn (input/output/cache read/cache creation) with running USD cost and tooltip.
- ★ Cache efficiency %, top tools bar chart (dead code in theirs).
- ★ Timeline search across prompt, text, thinking, tool input and results; filter pills (User/Assistant/System/Sidechains/Errors only); agent dropdown; "showing X of Y".
- ★ Thinking explorer: stats (blocks, est. tokens, avg, longest), density sparkline, cards with trigger → thinking → what followed ("Then called: Bash, Read"); thinking search.
- ★ Errors tab: error density strip (click dot to jump), "X errors of Y tool calls (Z%)", most-failing tool, error cards, recovery detection (retried / different approach / gave up).
- ★ Export JSON and Markdown.
- — Task board (Kanban) fed only by hooks; broken.
- ⚠ HTTP hooks require editing ~/.claude/settings.json.
- Gaps they have that cc-trace already solves: tool results not attached in JSONL mode, sub-agent messages dropped, no replay, no cross-session analytics.

## 3. simple10/agents-observe

The most popular (712 stars, active, v0.9.12). Hook-based: installs 28 Claude Code hooks + an MCP server, runs a Docker server with SQLite, dashboard on :4981. Reads JSONL only for token stats. Fetches pricing from models.dev.

- ★ Sessions grouped by project; worktree-aware grouping (worktrees filed under parent project).
- ★ Human-readable session names from the transcript `slug` field; sort by recent activity / created.
- ★ Deep links: URL hash routing to project / session / view / event, back/forward works; "session not found" page.
- ★ Home dashboard of recent sessions; "Constellation" live star-map of all sessions with sub-agents orbiting, glowing by activity.
- ★ Live, virtualized event stream; tool call rows show pending → running → completed/failed; compaction rows; expand all / collapse all; auto-follow toggle.
- ★ Conversation thread for a turn; event-specific renderers (permission requests, tasks created/completed history, teammate idle, instructions loaded, config/cwd changes, worktree removed, elicitation).
- ★ Raw logs modal: searchable JSON with prev/next match, jump to event, copy all, download.
- ★ Per-tool detail: Bash command+output, Read content, Edit diff from structuredPatch, AskUserQuestion Q+options+answer, inline images, markdown auto-render.
- ★ Tool usage stats: counts, success rate, longest tool call (click to jump).
- ★ Agents combobox: multi-select filter by agent, parent shown, copy ID.
- ★ Activity timeline with one lane per agent, time ranges (1m…24h), click dot to jump; "rewind" mode to scrub a frozen snapshot.
- ★ Multiple concurrent sessions in one view (spot interference between parallel sessions).
- ★ Token usage: Requests, Total Input, Total Output, Cache Hit %, Est Cost; tables By Model, By Agent, By Prompt (sortable, click to jump); cache write 5m vs 1h; sub-agent cost attributed to originating prompt.
- ★ Category filter pills (Prompts, Tools, Agents, Tasks, MCP, Session, Permissions, Notifications, Stop, Compaction, Config, Errors) + auto pills per tool and per Bash binary (git, npm…).
- ★ Session overview cards: duration, events, tool calls, prompts, subagents, success rate, turns, git commits, files read, files edited.
- ★ "Needs your attention" bells when Claude waits for you (Notification hook), favicon alert, auto-clear on next prompt.
- ★ Copy commands: `claude --resume <id>`, `claude --fork-session --resume <id>`.
- ★ Keyboard: `/` search, `a` agents, `f` filters, `b` sidebar, `e` stream, Home/End/PageUp/PageDown; cheat sheet.
- ★ Settings: light/dark/system theme, icon/colour per event type.
- ★ Permission mode shown.
- ⚠ Hooks + MCP server + Docker + SQLite database (stores copies of every event; adds latency to Claude Code; SessionStart can block up to 30 s).
- ⚠ Regex custom filter editor stored in SQLite (could be done client-side instead).
- ⚠ Labels / pins / rename (localStorage), move sessions between projects, delete sessions (DB only).
- ⚠ Pricing fetched from models.dev (network).
- Weaknesses: only sees sessions after install, heavy setup, CPU issues, no cross-session charts over time, no HTML/MD export, no step replay, no OS notifications.

## 4. delexw/claude-code-trace

The strongest direct competitor (383 stars, weekly releases). Rust backend + Tauri desktop / web / Python TUI. Reads JSONL directly (no hooks), plus `~/.claude/debug/<id>.txt` and `~/.claude/sessions` registry; shells out to git. In-memory cache only. Optional paid "efficiency" scoring via a third-party service (Jev).

- ★ Session picker grouped by date (Today/Yesterday/This week/This month/Older).
- ★ Project tree: worktrees and `/fork` sessions nested under their parent repo; "ongoing" status propagated up the tree.
- ★ Rich session cards: `/rename` title (from the sessions registry / custom-title record) else first prompt; model (colour by family), turns, tokens, cost, duration, ACTIVE badge, list of working directories if the session moved, "possibly spliced" integrity warning.
- ★ End-of-session recap (`away_summary`) used as the card preview.
- ★ Picker header totals: tokens and cost across listed sessions.
- ★ Background indexing with a progress bar; newest first while scanning.
- ★ Copy resume command (`cd '<cwd>' && claude --resume <id>`) and fork command (`--fork-session`); focus the live session's terminal window (macOS Terminal.app only).
- ★ Virtualized, paged conversation list (stays fast on huge sessions).
- ★ Message cards: role icon, model badge, sub-agent badge, per-message stats bar (tokens, tools, thinking, duration, agents).
- ★ Special rows: compaction boundary separator, recap card, system error card.
- ★ Detail split view: a turn's items in order on the left, the selected item's body on the right (resizable); popout modal; expand/collapse all; top/bottom.
- ★ Markdown + syntax highlighting for assistant text; user text literal.
- ★ Thinking placeholders ("not recorded") when redacted.
- ★ Info bar: git branch (+dirty), permission mode pill (auto-edit / yolo / plan / auto / don't ask), context-window % gauge, tokens, cost, busy/idle liveness, splice warning.
- ★ Tool taxonomy with 12 icons; MCP tools shown as "MCP <server>"; Edit diff with word-level highlighting; diffs inside Bash output rendered; pretty JSON; per-tool duration (parallel overlap handled); status badges: orphan, pending, interrupted, denied.
- ★ Hook events shown as items.
- ★ Sub-agents: recursive drill-down up to 5 levels; agent card with prompt, content, errors, message count, aggregated stats.
- ★ Teams / task board view: team members with colours, tasks with status and owner.
- ★ Live tail incl. `/clear` truncation and in-place rewrites; SSE reconnect with backoff.
- ★ Cost per model with a pricing table; context-window gauge.
- ★ Picker search (name, first message, id, model).
- ★ Debug log viewer for `~/.claude/debug/<sessionId>.txt` with level filter (All / Warn+ / Error) and text filter.
- ★ Transcript integrity warning (two sessions spliced into one file); robust, null-tolerant parsing.
- ★ Settings: projects directory path, font scale 80–200%, recap toggle.
- ★ Vim-style keyboard everywhere (j/k, Enter, q/Esc, e/c expand/collapse, t teams, d debug, g/G top/bottom) with a clickable `?` hint bar.
- ★ Windows: WSL distro discovery.
- ★ Docker image, background service installer (launchd/systemd/Windows startup).
- ⚠ Efficiency score via Jev (network + paid key + data leaves machine); recommendation providers use LLM tokens.
- ⚠ Authenticated local REST API with JWT clients (stores keys).
- ⚠ Multi-source plugins (Google Antigravity) — out of scope.
- Weaknesses: no full-text search, no export at all, no replay/timeline, no cross-session analytics, no token breakdown UI, dark only, context gauge hard-coded to 1M.

## 5. harrylettering/claude-trace-replay

264 stars, solo dev-mode project (Vite :3000 + Node :4000), about half the code is dead. Reads JSONL + sub-agent files + `~/.claude/history.jsonl` (for `/rename` names) + Claude settings and plugin hook configs. Stores pasted images in IndexedDB. AI retrospective shells out to the `claude` CLI (costs tokens). Security issues: WebSocket reads any path; shell injection in the AI prompt.

- ★ Discovery home: cards with `/rename` name, project, id, time, size, "N AGENTS"; time window 24h/7d/15d/30d; copy session id; rescan.
- ★ Drag-and-drop a .jsonl file to view offline; watch a specific file path.
- ★ Animated canvas replay in four lanes (User, Main agent, Reasoning, Tooling), particles along edges, camera follows; speeds 0.25–2×, scrubber, pan/zoom; "Current step" narrative ("Bash npm run build → exit 0", "Grep x in src → 6 hits").
- ★ Trace table (one row per cycle: INPUT / THINK / TOOL / REPLY / EVENT) linked to the canvas playhead.
- ★ Three-track overview on real elapsed time (log-scaled durations, idle gaps over 30 s compressed), hover tooltips.
- ★ Toggles: show only user turns, hide tool calls, duration bars vs points.
- ★ Header stats: turns, calls, median tool duration, tokens (dedupe by message.id).
- ★ Detail tabs: Summary (status, model, effort, tokens, cache, hooks warning, agent cost), Payload (raw JSON), Result, Timing (start/end ms, duration, of which hooks).
- ★ Timeline view: summary/detail density; groups consecutive reads/searches/thoughts into stages; virtualized.
- ★ Typed action cards: terminal (command, exit code, stdout/stderr), side-by-side diff for Write/Edit, destructive action (delete), move, search, read (token estimate), screenshots / computer use, user images, task create/update/result.
- ★ Sub-agents view: totals (dispatched, tokens, tool calls, most expensive run), per-run status (completed / running / had errors / no transcript), async tag, prompt, transcript, result; inline expansion in the trace.
- ★ Hooks view: runs, time spent in hooks (+N ms per tool call), failures (non-zero exit even when marked success, grouped ×N with stderr), per-hook median / p90 / total, hook owner (plugin / settings file).
- ★ Session overview: messages (user vs assistant), tool calls, duration, tokens incl. cache read/write, models used.
- ★ Token charts: per-request line chart and cumulative area chart over time.
- ★ Advanced search: simple / exact / regex, case sensitive, message-type filter, tool multi-select, time range, token min/max, only errors / only tool activity / only sidechain, reset, "filtered of total".
- ★ Agent loop detected banner (same failing command 3× in last 8 actions); error log list; "lessons" (failed command → edit → same command passes) as suggested rules.
- ★ Session compare: A vs B metrics with ±delta and % change, better/worse colours, top-5 tools, models.
- ⚠ AI retrospective and AI comparison through the `claude` CLI (costs tokens).
- ⚠ Images stored in IndexedDB.
- Weaknesses: no dollar cost, single session at a time, no cross-session analytics or global search, no keyboard shortcuts, no themes or settings, limited export (Markdown retrospective only).
