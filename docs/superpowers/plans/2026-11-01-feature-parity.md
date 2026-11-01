# cc-trace 0.2.0: feature parity and new features — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give cc-trace every rule-compliant feature of the five closest competitors plus nine new ones, released as 0.2.0.

**Architecture:** A lead first lands shared foundations on `main` (richer session model, pricing, redaction, settings, URL router, view registry with stub views). Six agents then build in parallel, each in its own git worktree and owning disjoint files, filling in their stub views, analytics modules and API routes. The lead merges, integrates, reviews and releases.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind 4, framer-motion, lucide-react, chokidar 4. Node ≥ 20.9.

**Spec:** `docs/superpowers/specs/2026-11-01-feature-parity-design.md` (feature IDs A1…N9 refer to it). Research: `docs/research/competitors.md`.

## Global Constraints

- Zero tokens: no calls to Claude, any AI service, or any network host. All servers bind 127.0.0.1 (already true).
- No extra copies of history: never write log content to disk. In-memory caches keyed by path+mtime+size are fine. Browser `localStorage` only for settings and bookmarks (J1), every access wrapped in try/catch.
- Read-only: never modify, move or delete anything under the Claude folder; never install hooks.
- Every new API route resolves paths with `resolveSessionFile` (or an equivalent check that the path stays under `PROJECTS_ROOT` / the Claude folder) and is covered by the localhost-only middleware (`/api/:path*`).
- Plain English first: every new view opens with a one-sentence explanation; technical detail behind a "technical details" toggle; new jargon added to `GLOSSARY` in `src/lib/explain.ts` and marked `[[term:label]]`.
- Windows/macOS/Linux: compare paths with `pathKey` semantics (see `src/app/api/stream/route.ts`); never assume `/` separators.
- New runtime dependencies allowed (exact versions, each published ≥ 2 weeks ago): `react-markdown`, `remark-gfm`, `diff` (jsdiff), `@tanstack/react-virtual`. No other new runtime deps; charts are hand-written SVG.
- Dollar costs are always labelled "estimate". Unknown model → show "cost unknown", never guess.
- Commits: author is the repo's local identity; **no `Co-Authored-By` or any Claude/Anthropic attribution** in commits or PR text.
- Keep `pnpm lint`, `npx tsc --noEmit -p .`, `pnpm check`, `pnpm build`, `pnpm smoke`, `pnpm smoke --packed` green.

## Review Focus

1. Huge sessions (one-church: 6k+ records, 192 helpers; 100k-line logs): new views must stay responsive — virtualize lists > 200 rows; analytics O(n). Test: a generated 50k-step model builds stats/health in < 1 s (Tasks 3, 4).
2. Malformed or unknown records (half-written last line, unknown `type`, missing `message`, null fields): every analytics function and renderer must skip, not crash. Test: feed `{}`, `{type:"weird"}`, `{type:"assistant"}` records through `buildSession` and every analytics function (Task 0.1 and each analytics task).
3. Path safety in new API routes (`/api/search`, `/api/overview`, `/api/debug-log`, `/api/live`): `../`, absolute paths and other drives are refused with 400. Test: smoke test hits each with `../../etc/passwd`-style input (Tasks 1, 3, 5, 6).
4. Secrets in shared output: HTML/Markdown exports and the masked screen must never show API keys, tokens, passwords or the home folder path when "Hide sensitive text" is on. Test: `maskSecrets` cases + export of a fixture containing `sk-ant-...`, `ghp_...`, `password=...` (Tasks 0.1, 5).
5. Live updates while new views are open: a session still being written (partial line, new helper file, `/clear` truncation) must update Conversation/Stats/Health without a reload and without duplicate steps. Test: smoke test appends to a log and asserts the new step appears once in `buildSession` output after the stream event (Task 7).

---

## Phase 0 — Foundations (lead, sequential, on `main`)

### Task 0.1: Richer model, pricing and redaction

**Files:**
- Modify: `src/lib/session.ts`
- Create: `src/lib/pricing.ts`, `src/lib/redact.ts`
- Test: `scripts/session.check.mts`

**Interfaces — Produces:**
- `Usage` becomes `{ fresh: number; cached: number; written: number; input: number; cacheWrite5m: number; cacheWrite1h: number; cost: number | null }` (`fresh` = input + all cache writes; `cost` USD, `null` when the model is unknown).
- `Step` gains: `model?: string; durationMs?: number; thinking?: string; result?: unknown /* raw toolUseResult */; images?: { mediaType: string; data: string }[]; event?: "api_error" | "hook" | "interrupted" | "compact" | "recap"`.
- `SessionModel` gains `meta: SessionMeta` and `events: SessionEvent[]`:
  - `SessionMeta = { customTitle?: string; aiTitle?: string; permissionMode?: string; gitBranch?: string; cwds: string[]; version?: string; entrypoint?: string; models: string[]; firstTs: number; lastTs: number }`
  - `SessionEvent = { ts: number; actor: string; type: "system" | "hook"; subtype: string; data: Record<string, unknown> }` (system records and `hook_*` attachments, raw).
- `src/lib/pricing.ts`: `type Price = { input: number; output: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number }` (USD per million tokens); `priceFor(model?: string): Price | undefined` (longest-prefix match, ignores date suffixes); `costOf(u: Omit<Usage, "cost">, model?: string): number | null`; `contextWindow(model?: string): number` (tokens; default 200_000).
- `src/lib/redact.ts`: `maskSecrets(text: string, home?: string): string`.

- [ ] **Step 1: Write failing tests** in `scripts/session.check.mts`:
  - per-reply cost: fixture reply `model: "claude-sonnet-4-5"`, usage `{input_tokens:1000, output_tokens:1000, cache_read_input_tokens:1_000_000, cache_creation:{ephemeral_5m_input_tokens:0, ephemeral_1h_input_tokens:0}}` → `step.usage.cost` equals `priceFor("claude-sonnet-4-5")` arithmetic (assert with the table values).
  - unknown model `"mystery-1"` → `cost === null`.
  - `meta.customTitle === "cc-trace tool setup"` from a `{type:"custom-title", customTitle:"cc-trace tool setup"}` record; `meta.aiTitle` from `ai-title`; `meta.permissionMode` from `{type:"mode", mode:"plan"}`; `meta.gitBranch` and `meta.cwds` from record fields.
  - `durationMs` of a tool step = tool_result record ts − tool_use ts (fixture 2.5 s → 2500).
  - thinking text from a `thinking` block attaches to the first step of the same reply.
  - `{type:"system", subtype:"api_error", ...}` produces a step with `event:"api_error"` on the lead lane and a `SessionEvent`.
  - `hook_non_blocking_error` attachment → `SessionEvent{type:"hook", subtype:"hook_non_blocking_error", data.exitCode:1}`.
  - robustness: `buildSession([{}, {type:"weird"}, {type:"assistant"}, {type:"user", message:null}], {})` does not throw.
  - `maskSecrets("key sk-ant-api03-abc123def456 and ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 password=hunter2 me@x.com /Users/chehan/a", "/Users/chehan")` → contains none of the secrets, contains `/~/a` replaced as `~/a`.
- [ ] **Step 2: Run** `pnpm check` → FAIL on the new assertions.
- [ ] **Step 3: Implement.** Pricing values come from the `claude-api` skill's pricing reference (load it; do not use memory). Include current and previous Opus, Sonnet and Haiku generations and the models seen in local logs (`grep -ho '"model":"claude[^"]*"' ~/.claude/projects/*/*.jsonl | sort -u`); unknown → `undefined`. Redaction patterns: `sk-ant-[\w-]{8,}`, `sk-[\w-]{20,}`, `gh[pousr]_[A-Za-z0-9]{20,}`, `xox[abpr]-[\w-]+`, `AKIA[0-9A-Z]{16}`, `(?i)(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S+` (keep the key name, mask the value), emails, JWT-like `eyJ[\w-]+\.[\w-]+\.[\w-]+`, and the `home` prefix → `~`. Mask with `•••`.
- [ ] **Step 4: Run** `pnpm check && pnpm check -- --all` → PASS, and still 0 helpers without a brief.
- [ ] **Step 5: Commit** `feat: richer session model, offline pricing and secret masking`.

### Task 0.2: Router, settings and view registry with stubs

**Files:**
- Create: `src/lib/route.ts`, `src/lib/settings.ts`, `src/components/views/registry.ts`, stub views (each exporting a component that renders "Coming soon"): `src/components/views/{conversation-view,stats-view,health-view,files-view,agents-view}.tsx`, stub app pages `src/components/pages/{dashboard-page,live-page,search-page,compare-page,settings-dialog,bookmarks-page}.tsx`, `src/lib/analytics/index.ts` (empty barrel), `scripts/route.check.mts`.
- Modify: `src/app/page.tsx` (tabs come from the registry; app pages from the route), `package.json` (`check` runs both check scripts).

**Interfaces — Produces:**
- `type SessionView = "map" | "conversation" | "stats" | "health" | "files" | "agents" | "flow"`; `type AppPage = "session" | "dashboard" | "live" | "search" | "compare" | "bookmarks"`.
- `type Route = { page: AppPage; project?: string; file?: string; turn?: number; view: SessionView; step?: string; q?: string; other?: string }`.
- `parseRoute(hash: string): Route`; `formatRoute(r: Route): string` (hash like `#/s/<encoded file>/<turn>/<view>?step=<id>`; `#/dashboard`, `#/live`, `#/search?q=`, `#/compare?a=<file>&b=<file>`, `#/bookmarks`); `useRoute(): [Route, (patch: Partial<Route>, replace?: boolean) => void]` (syncs `location.hash`, back/forward via `hashchange`).
- `SessionViewProps = { model: SessionModel; turn: Turn; file: string; selected: Selection; onSelect: (s: Selection) => void; onPickTurn: (i: number) => void; onShowSession: () => void }`.
- `SESSION_VIEWS: { id: SessionView; label: string; component: React.ComponentType<SessionViewProps> }[]` in order Map, Conversation, Agents, Stats, Health, Files, Whole session.
- `src/lib/settings.ts`: `type Settings = { theme: "system" | "light" | "dark"; textScale: 0.9 | 1 | 1.15 | 1.3; showTechnical: boolean; maskSensitive: boolean; notifications: boolean; reduceMotion: boolean }`, `DEFAULT_SETTINGS`, `useSettings(): [Settings, (patch: Partial<Settings>) => void]` (localStorage key `cc-trace:settings`, try/catch, cross-tab `storage` event).

- [ ] **Step 1: Write failing tests** `scripts/route.check.mts`: round-trip `formatRoute(parseRoute(x)) === x` for each hash form above; a file path containing spaces, `#`, `%` and Windows `C:\…\a.jsonl` round-trips; `parseRoute("")` → `{page:"session", view:"map"}`; garbage hash → same default.
- [ ] **Step 2: Run** `pnpm check` → FAIL.
- [ ] **Step 3: Implement** route, settings, registry and stubs; `page.tsx` renders the tab bar from `SESSION_VIEWS`, keeps the existing Map and Whole session views, derives project/session/turn/view from `useRoute`, and shows app pages for `page !== "session"`.
- [ ] **Step 4: Run** `pnpm lint && npx tsc --noEmit -p . && pnpm check && pnpm build && pnpm smoke` → PASS; open the app, click each tab (stubs say "Coming soon"), confirm back/forward restores the view.
- [ ] **Step 5: Commit** `feat: URL routing, settings store and view registry`.

---

## Phase 1 — Parallel work (six agents, one git worktree each, branched from Phase 0)

Every agent: owns only the files listed in its task; may add (not edit) entries in `src/lib/explain.ts` `GLOSSARY` only via a new file `src/lib/glossary/<area>.ts` that the lead merges; adds its unit tests in `scripts/<area>.check.mts` and registers the script in `package.json` `check` only in its final commit (lead resolves the one-line conflict). Run the full verification command list in Global Constraints before reporting.

### Task 1: Sessions and navigation (A1–A8, G2, I3)

**Files:** Modify `src/lib/claude-logs.ts`, `src/app/api/sessions/route.ts`, `src/components/header.tsx`. Create `src/app/api/live/route.ts`, `src/components/session-browser.tsx`, `src/components/pages/live-page.tsx` (replace stub), `src/components/session-info-bar.tsx`, `src/components/drop-file.tsx`, `scripts/sessions.check.mts`; extend `scripts/smoke.mjs` (sessions + live sections only).

**Interfaces — Produces:**
- `SessionInfo` gains `customTitle?`, `aiTitle?`, `model?`, `requests: number`, `tokens: number`, `cost: number | null`, `durationMs: number`, `gitBranch?`, `live: boolean`, `version?`, `entrypoint?`, `worktreeOf?: string` (main project dir when the cwd is a git worktree: path contains `/.claude/worktrees/` or `.git` is a file).
- `GET /api/live` → `{ sessionId: string; pid: number; cwd: string; startedAt: number; version?: string; entrypoint?: string; file?: string }[]` from `~/.claude/sessions/*.json` (alive = pid exists via `process.kill(pid, 0)` in try/catch).
- `<SessionBrowser projects onPick />`, `<SessionInfoBar model file />` (permission mode, branch, cwds, version, entrypoint, live badge), `<DropFile onLoad={(records: LogRecord[]) => void} />`.
- Copy actions: `cd '<cwd>' && claude --resume <id>`, same with `--fork-session`, and session id.

- [ ] Steps (TDD): tests for head/tail scan picking `customTitle` over `aiTitle` over first prompt; date grouping buckets (Today/Yesterday/This week/This month/Older) as a pure `groupByDate(sessions, now)`; worktree detection on POSIX and Windows paths; `/api/live` refuses nothing user-supplied (no params) and returns `[]` when the folder is missing; smoke asserts `/api/sessions` returns the fixture title and `/api/live` returns `[]`. Implement; tail scan reads only the last 64 KB. Picker header shows totals (A5). Session list search covers title, first prompt, id, model; filters project, live only; sort recent/started. Drag-and-drop view parses in the browser and shows a "viewing a file, not live" banner. Commit `feat: session browser, live sessions and session info`.

### Task 2: Conversation view and tool renderers (B1–B7, N4 on screen, N6)

**Files:** Replace stub `src/components/views/conversation-view.tsx`; create `src/components/tools/{index,edit,write,read,bash,search,web,question,todo,image,generic}.tsx`, `src/components/markdown.tsx`, `src/components/find-bar.tsx`, `src/lib/analytics/explanations.ts`, `scripts/conversation.check.mts`. Modify `src/components/details-panel.tsx` (StepCard uses `<ToolRenderer>`; shows `durationMs`, cost, thinking), `src/components/code-block.tsx` (applies `maskSecrets` when `settings.maskSensitive`).

**Interfaces — Produces:** `<ToolRenderer step={Step} />` (picks renderer by `step.tool`, falls back to generic JSON); `<Markdown text masked? />`; `nearestExplanation(turn: Turn, stepId: string): Step | undefined` (closest preceding `note` step by the same actor within the same turn); `<FindBar target={RefObject<HTMLElement>} />` (⌘/Ctrl+F, n of N, Enter/Shift+Enter, Esc).

- [ ] Steps (TDD): tests for `nearestExplanation`; word-level diff helper `diffWords(old, new)` returns marked segments; Edit renderer prefers `step.result.structuredPatch` when present. Conversation lists every step of the turn in chat form (your messages, Claude replies with markdown, tool rows collapsed to one line with the renderer on expand, helper messages indented with the helper colour, compaction / API error / interrupted rows), virtualized via `@tanstack/react-virtual` above 200 rows; per-message model badge, tokens, estimated cost, copy button; thinking collapsed with length or "not recorded". All text goes through `maskSecrets` when the setting is on. Commit `feat: conversation view and rich tool renderers`.

### Task 3: Stats, costs and dashboard (D1–D6, F4, N8)

**Files:** Replace stubs `src/components/views/stats-view.tsx`, `src/components/pages/dashboard-page.tsx`; create `src/lib/analytics/stats.ts`, `src/lib/analytics/tips.ts`, `src/components/charts/{line,bars,donut}.tsx` (SVG), `src/app/api/overview/route.ts`, `scripts/stats.check.mts`; extend `scripts/smoke.mjs` (overview section).

**Interfaces — Produces:**
- `sessionStats(m: SessionModel): { totals: Usage; cacheHitPct: number; byModel: Row[]; byAgent: Row[]; byRequest: Row[]; tools: { tool: string; count: number; failed: number; longest?: Step }[] }` where `Row = { key: string; label: string; usage: Usage; steps: number; durationMs: number; jumpTo?: { turn: number; step?: string } }`.
- `burnSeries(m: SessionModel, turn?: number): { ts: number; tokens: number; cost: number | null }[]` (cumulative).
- `contextGauge(turn: Turn, m: SessionModel): { used: number; window: number; pct: number }`.
- `tipsFor(turn: Turn, m: SessionModel): { id: string; text: string; severity: "info" | "warn" }[]` (N8: memory > 70 % of window → suggest /compact or /clear; same file read ≥ 3 times; helper briefs > 20 k chars; cache hit < 50 % on long requests).
- `GET /api/overview?days=30` → `{ days: { date: string; tokens: number; cost: number | null; sessions: number }[]; byModel: Row[]; byProject: Row[]; tools: …; totals: Usage }`, built with `buildSession` per log (helpers included), cached in memory by path+mtime+size, time-boxed to 20 s with a `partial: true` flag.

- [ ] Steps (TDD): stats on a two-model fixture match hand-computed rows; cost `null` propagation (any unknown model → row cost null, totals show "partly unknown"); 50k-step generated model computes in < 1 s; tips fire on threshold fixtures and not below. Stats view: cards (requests, tokens, est. cost, cache hit %), sortable tables with click-to-jump, burn chart, output-per-reply bars (click to jump), tool ranking with success rate, per-helper table with "most expensive helper", context gauge per request, tips panel. Dashboard: totals, 30-day chart, cost by model donut, by project table, top tools, link into sessions. Every cost labelled "estimate — not your bill". Commit `feat: stats, cost estimates and dashboard`.

### Task 4: Health, files, risks and phases (E1–E3, N2, N3, N5)

**Files:** Replace stubs `src/components/views/health-view.tsx`, `src/components/views/files-view.tsx`; create `src/lib/analytics/{health,files,risk,phases,hooks}.ts`, `src/components/phase-band.tsx`, `scripts/health.check.mts`. Modify `src/components/story-map.tsx` only to render `<PhaseBand turn />` above the lanes and a red risk dot on risky steps (two small insertions).

**Interfaces — Produces:**
- `healthReport(m: SessionModel, turn?: Turn): { score: number; findings: Finding[]; errors: { total: number; toolCalls: number; mostFailing?: string; items: { step: Step; next: "retried" | "different" | "gave-up" }[] } }`, `Finding = { kind: "repeated-tool" | "fix-loop" | "empty-result" | "excessive-reads" | "write-then-edit" | "high-error-rate"; title: string; explain: string; steps: string[]; turn: number }`.
- `filesTouched(m: SessionModel): { path: string; reads: number; writes: number; edits: number; changes: { step: Step; turn: number }[] }[]`.
- `riskOf(step: Step): { level: "caution" | "danger"; why: string } | undefined` (rm -rf / rm -r, git push --force/-f, git reset --hard, chmod -R 777, curl|sh, sudo, package installs, writes outside the session cwd, deleting files, bypass-permissions mode).
- `phasesOf(turn: Turn): { kind: "exploring" | "changing" | "testing" | "reviewing" | "answering" | "delegating"; from: number; to: number }[]` (index ranges into `turn.steps`).
- `hookRuns(m: SessionModel): { name: string; event: string; runs: number; failed: number; samples: { stderr?: string; exitCode?: number; ts: number }[] }[]` (from `m.events`; non-zero exit counts as failed even when labelled success).

- [ ] Steps (TDD): fixtures for each finding kind trigger exactly once; score 100 for a clean session and decreases monotonically with findings; recovery classification for retried/different/gave-up; risk table cases incl. Windows `Remove-Item -Recurse -Force`; phases cover every step exactly once; files merge Windows and POSIX spellings of the same path. Health view: score ring with plain explanation, findings (click to jump), error strip, hook table. Files view (N2): per-file timeline of changes with diffs via `<ToolRenderer>` from Task 2 (import only). Commit `feat: health checks, files changed, risks and phases`.

### Task 5: Agents, search, export, compare and story (F1–F3, N7, C1, C2, H1, H2, N1)

**Files:** Replace stubs `src/components/views/agents-view.tsx`, `src/components/pages/search-page.tsx`, `src/components/pages/compare-page.tsx`; create `src/lib/analytics/{agents,story,compare,filters}.ts`, `src/lib/export/{html,markdown}.ts`, `src/app/api/search/route.ts`, `src/components/filter-bar.tsx`, `src/components/export-menu.tsx`, `scripts/agents.check.mts`; extend `scripts/smoke.mjs` (search section).

**Interfaces — Produces:**
- `agentTree(m: SessionModel): { actor: Actor; children: …[]; stats: { steps: number; usage: Usage; durationMs: number } }` (root = lead).
- `tasksOf(m: SessionModel): { id: string; title: string; status: "pending" | "in_progress" | "completed"; owner: string; ts: number }[]` (from TodoWrite, TaskCreate/TaskUpdate, update_plan inputs; latest status wins).
- `teamsOf(m: SessionModel): { name: string; members: { name: string; colour?: string }[] }[]`.
- `agentChat(m: SessionModel, turn?: Turn): Step[]` (brief, message, report, reply steps between agents, in order).
- `storyOf(turn: Turn, m: SessionModel): string` and `sessionStory(m: SessionModel): string` (N1, plain English, deterministic, uses `[[term:…]]` markers).
- `compare(a: SessionModel, b: SessionModel): { metric: string; a: number; b: number; delta: number; better: "a" | "b" | "same" }[]` + top tools + models.
- `type StepFilter = { categories: Set<"you" | "tools" | "helpers" | "errors" | "permissions" | "memory" | "connectors">; tools: Set<string>; commands: Set<string>; agents: Set<string>; text: string }`; `filterSteps(steps: Step[], f: StepFilter): Step[]`; `<FilterBar steps value onChange />` (used by Map and Conversation through the lead's integration).
- `GET /api/search?q=&limit=200` → NDJSON stream of `{ file: string; title: string; turn: number; step?: string; snippet: string; ts: number }`; streams files newest first; refuses `q` shorter than 2 chars; 20 s budget; never returns content outside the projects folder.
- `exportHtml(m: SessionModel, opts: { turn?: number; mask: boolean }): string` (one self-contained file, inline CSS, no scripts from the network), `exportMarkdown(m, opts): string`.

- [ ] Steps (TDD): tree nests a helper started by a helper; tasks status updates; story text for the multi-agent fixture mentions helper names and outcome; compare deltas; filters combine with AND across groups and OR within; export with `mask:true` contains none of the Review Focus 4 secrets and loads offline; search smoke test finds a fixture phrase and rejects `q=a`. Agents view: tree (collapse/expand, status), task board, teams, agent chat (N7). Search page with jump-to-step deep links. Compare page from two session pickers. Commit `feat: agents view, search, export, compare and story`.

### Task 6: Settings, keyboard, attention, debug log, tour and bookmarks (I1, I2, I4, G1, N9, J1)

**Files:** Replace stubs `src/components/pages/settings-dialog.tsx`, `src/components/pages/bookmarks-page.tsx`; create `src/lib/bookmarks.ts`, `src/lib/attention.ts`, `src/hooks/use-shortcuts.ts`, `src/components/shortcuts-overlay.tsx`, `src/components/tour.tsx`, `src/components/debug-log.tsx`, `src/app/api/debug-log/route.ts`, `scripts/ux.check.mts`; extend `scripts/smoke.mjs` (debug-log section). Modify `src/app/layout.tsx` (theme + text scale from settings before paint) and `src/components/welcome.tsx` (offer the tour).

**Interfaces — Produces:**
- `useBookmarks(): { items: Bookmark[]; toggle(b: Omit<Bookmark, "createdAt">): void; has(file: string, step?: string): boolean; tags(file): string[]; setTags(file, tags: string[]): void; rename(file, name?: string): void; nameOf(file): string | undefined }`, `Bookmark = { file: string; step?: string; turn?: number; label: string; createdAt: number }` (localStorage `cc-trace:bookmarks`, try/catch).
- `needsAttention(m: SessionModel): { reason: "question" | "plan" | "permission"; step?: Step } | undefined` (last running AskUserQuestion / ExitPlanMode / permission request with no result and the session not stale).
- `<AttentionWatcher model />`: tab title prefix "● ", favicon swap, and `new Notification(...)` only when `settings.notifications` and permission granted.
- `useShortcuts(map: Record<string, () => void>)`: `?` overlay, `/` search page, `g d` dashboard, `g l` live, `1`–`7` session views, `j`/`k` and ↑/↓ next/prev request, `[`/`]` prev/next session, `b` bookmark current step, Esc closes overlays; ignores keys in inputs and with modifiers.
- `GET /api/debug-log?file=` → text of `~/.claude/debug/<sessionId>.txt` (404 when missing; path built only from the validated session id), `<DebugLog file />` with All / Warn+ / Error and a text filter.
- `<Tour steps />` (N9): 6 stops (pickers, requests, tabs, map, explanations, zoom), keyboard and Esc, offered from the welcome card and Settings.

- [ ] Steps (TDD): bookmarks survive a thrown `localStorage` (no crash, in-memory fallback); attention detection on fixtures (question running → "question"; answered → undefined; stale → undefined); shortcut handler ignores typing in inputs; debug-log route refuses `file=../x.jsonl` and returns 404 for a missing log. Settings dialog: theme, text size, show technical details by default, hide sensitive text, reduce motion, desktop notifications (requests permission on enable), logs folder (read-only display), replay tour. Commit `feat: settings, shortcuts, attention alerts, debug log, tour and bookmarks`.

---

## Phase 2 — Integration and release (lead)

### Task 7: Merge and integrate

**Files:** `src/app/page.tsx`, `src/components/header.tsx`, `src/components/story-map.tsx`, `src/lib/explain.ts`, `package.json`, `README.md`, `scripts/smoke.mjs`.

- [ ] Merge branches in order 1 → 6, resolving: `package.json` `check` script list, glossary files merged into `GLOSSARY`, `smoke.mjs` sections, page wiring (FilterBar on Map and Conversation, AttentionWatcher, SessionInfoBar, ExportMenu and bookmark star in the header, shortcut map, app-page links: Dashboard, Live, Search, Compare, Bookmarks, Settings).
- [ ] Add the Review Focus 5 smoke test: append a tool_use + tool_result to a live log and assert `buildSession` on the streamed records yields the new step exactly once.
- [ ] Run the full verification list; open every view on the one-church, elionholidays and cc-trace sessions at 1440×900 and 375×812, light and dark; fix layout breaks.
- [ ] README: feature list, screenshots-free description, keyboard map, privacy section updated (bookmarks/settings stay in the browser).
- [ ] Commit `feat: integrate 0.2.0 features`.

### Task 8: Review, CI and release

- [ ] Dispatch a fresh reviewer agent with the spec, this plan and the diff `v0.1.0..HEAD` (no conclusions from the lead); fix every confirmed issue.
- [ ] `npm version minor` (0.2.0), push, wait for CI green on Windows/macOS/Linux × Node 20/22.
- [ ] Owner runs `npm publish --access public` with 2FA approval; verify `npx cc-trace-map@0.2.0` from a clean cache serves the app and `/api/overview`.
