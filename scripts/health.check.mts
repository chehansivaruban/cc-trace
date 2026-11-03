// Self-check for the health checks, files changed, risky-action alerts, phases and hook runs.
//   node --no-warnings --experimental-strip-types scripts/health.check.mts
import assert from "node:assert/strict";
import { buildSession, isDenied, isFailed, type LogRecord, type SessionModel, type Step } from "../src/lib/session.ts";
import { FINDING_WEIGHT, healthReport, type Finding } from "../src/lib/analytics/health.ts";
import { filesTouched, isInside } from "../src/lib/analytics/files.ts";
import { normalizePath } from "../src/lib/paths.ts";
import { riskOf } from "../src/lib/analytics/risk.ts";
import { mergeNarrowPhases, phasesOf } from "../src/lib/analytics/phases.ts";
import { hookRuns } from "../src/lib/analytics/hooks.ts";

const t0 = Date.parse("2026-01-01T00:00:00.000Z");
const at = (s: number) => new Date(t0 + s * 1000).toISOString();
const now = t0 + 3_600_000;

type Call = { name: string; input: Record<string, unknown>; error?: boolean; output?: string };
const call = (name: string, input: Record<string, unknown>, opts: { error?: boolean; output?: string } = {}): Call => ({ name, input, ...opts });
const read = (file: string, o = {}) => call("Read", { file_path: file }, o);
const edit = (file: string, o = {}) => call("Edit", { file_path: file, old_string: "a", new_string: "b" }, o);
const write = (file: string, o = {}) => call("Write", { file_path: file, content: "x\ny" }, o);
const bash = (command: string, o = {}) => call("Bash", { command }, o);
const grep = (pattern: string, o = {}) => call("Grep", { pattern }, o);

/** One session: each inner list is one request (prompt, the calls in order, then a final answer). */
function session(requests: Call[][], cwd = "/work/app", extra: LogRecord[] = []): SessionModel {
  const recs: LogRecord[] = [];
  let s = 0;
  let id = 0;
  requests.forEach((calls, r) => {
    recs.push({ type: "user", cwd, timestamp: at(s++), message: { content: `request ${r + 1}` } });
    for (const c of calls) {
      const tid = `t${id++}`;
      recs.push({ type: "assistant", cwd, timestamp: at(s++), message: { id: `m${tid}`, stop_reason: "tool_use", content: [{ type: "tool_use", id: tid, name: c.name, input: c.input }] } });
      recs.push({ type: "user", cwd, timestamp: at(s++), message: { content: [{ type: "tool_result", tool_use_id: tid, is_error: !!c.error, content: c.output ?? (c.error ? "failed" : "ok") }] } });
    }
    recs.push({ type: "assistant", cwd, timestamp: at(s++), message: { id: `end${r}`, stop_reason: "end_turn", content: [{ type: "text", text: "Done." }] } });
  });
  return buildSession([...recs, ...extra], {}, now);
}

const kinds = (fs: Finding[]) => fs.map((f) => f.kind).sort();

// ── Clean session: score 100, no findings, no errors ──
const clean = session([[read("/work/app/a.ts"), edit("/work/app/a.ts"), bash("npm test"), read("/work/app/b.ts")]]);
let h = healthReport(clean);
assert.equal(h.score, 100);
assert.deepEqual(h.findings, []);
assert.equal(h.errors.total, 0);
assert.equal(h.errors.toolCalls, 4);
assert.equal(h.errors.mostFailing, undefined);

// ── Steps you said no to aren't Claude failing ──
{
  const NO = "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file).";
  const calls = [
    bash("rm -rf dist", { error: true, output: NO }),
    bash("rm -rf dist", { error: true, output: NO }),
    bash("rm -rf dist", { error: true, output: NO }),
    bash("git push", { error: true, output: NO }),
    ...["a", "b", "c", "d", "e", "f"].map((c) => bash(`echo ${c}`)),
  ];
  const m = session([calls]);
  const r = healthReport(m);
  assert.deepEqual(r.findings, [], "no struggling or fix-loop finding for declined steps");
  assert.equal(r.score, 100, "the score is unchanged");
  assert.equal(r.errors.total, 0, "declined steps aren't errors");
  assert.equal(r.errors.declined, 4);
  assert.deepEqual(r.errors.items.map((i) => i.next), ["declined", "declined", "declined", "declined"], "listed as “you said no”");
  assert.equal(r.errors.toolCalls, 10);
  const steps = m.turns[0].steps.filter((x) => x.tool === "Bash");
  assert.equal(steps.filter(isDenied).length, 4);
  assert.equal(steps.filter(isFailed).length, 0);
  assert.ok(!isDenied({ status: "success", output: NO } as Step), "only a failed step can be a no");
  assert.ok(isDenied({ status: "error", output: [{ type: "text", text: "Permission to use Bash has been denied." }] } as unknown as Step));
  // A real failure next to a no still counts.
  const mixed = healthReport(session([[bash("x", { error: true, output: NO }), bash("y", { error: true, output: "boom" })]]));
  assert.equal(mixed.errors.total, 1);
  assert.equal(mixed.errors.declined, 1);
}

// ── Each finding kind: its fixture triggers it exactly once, and nothing else ──
const pad = [read("/work/app/x.ts"), read("/work/app/y.ts"), grep("found", { output: "x.ts" })];
const fixtures: Record<Finding["kind"], Call[]> = {
  // The identical call three times with nothing changed in between.
  "repeated-tool": [...pad, grep("needle", { output: "a.ts" }), grep("needle", { output: "a.ts" }), grep("needle", { output: "a.ts" })],
  // The same command failing again and again with the same error, despite attempted fixes in between.
  "fix-loop": [...pad, bash("npm test", { error: true, output: "1 failed (ran in 2.1s)" }), edit("/work/app/a.ts"), bash("npm test", { error: true, output: "1 failed (ran in 1.9s)" }), edit("/work/app/a.ts"), bash("npm test", { error: true, output: "1 failed  (ran in 2.4s)" }), read("/work/app/z.ts")],
  // Five searches in a row that found nothing.
  "empty-result": [...pad, grep("one", { output: "No matches found" }), grep("two", { output: "" }), call("Glob", { pattern: "**/*.zz" }, { output: "No files found" }), grep("three", { output: "No matches found" }), grep("four", { output: "No matches found" })],
  // One file opened four times.
  "excessive-reads": [...pad, read("/work/app/big.ts"), edit("/work/app/other.ts"), read("/work/app/big.ts"), read("/work/app/big.ts"), edit("/work/app/other2.ts"), read("/work/app/big.ts")],
  // A new file, then patched over and over.
  "write-then-edit": [...pad, write("/work/app/new.ts"), ...["1", "2", "3"].map((n) => call("Edit", { file_path: "/work/app/new.ts", old_string: n, new_string: "b" }))],
  // Many different things that didn't work.
  "high-error-rate": [...pad, bash("a", { error: true }), bash("b", { error: true }), bash("c", { error: true }), bash("d", { error: true }), bash("e", { error: true }), read("/work/app/q.ts")],
};
const scores: number[] = [];
for (const [kind, calls] of Object.entries(fixtures)) {
  const m = session([calls]);
  const r = healthReport(m);
  assert.deepEqual(kinds(r.findings), [kind], `${kind}: got ${kinds(r.findings).join(", ")}`);
  const f = r.findings[0];
  assert.equal(f.turn, 0, kind);
  assert.ok(f.title && f.explain, kind);
  assert.ok(f.steps.length > 0, kind);
  const ids = new Set(m.turns[0].steps.map((s) => s.id));
  for (const id of f.steps) assert.ok(ids.has(id), `${kind}: unknown step ${id}`);
  // Write-then-edit is a neutral note: it never lowers the score.
  if (kind === "write-then-edit") assert.equal(r.score, 100, kind);
  else assert.ok(r.score < 100 && r.score > 0, `${kind}: score ${r.score}`);
  // The same report scoped to the request agrees.
  assert.deepEqual(kinds(healthReport(m, m.turns[0]).findings), [kind]);
  scores.push(r.score);
}
assert.equal(FINDING_WEIGHT["write-then-edit"], 0);
assert.doesNotMatch(healthReport(session([fixtures["write-then-edit"]])).findings[0].explain, /wasn't quite right|mistake|wrong/);
// A failing command whose error changes after each fix is progress, not a loop.
assert.deepEqual(kinds(healthReport(session([[bash("npm test", { error: true, output: "3 failed" }), edit("/work/app/a.ts"), bash("npm test", { error: true, output: "2 failed: auth" }), edit("/work/app/b.ts"), bash("npm test", { error: true, output: "1 failed: cart" })]])).findings), []);
// The same command failing with nothing changed in between is a loop, even when the error text varies.
assert.deepEqual(kinds(healthReport(session([[bash("curl -f localhost:3000", { error: true, output: "refused 1" }), read("/work/app/a.ts"), bash("curl -f localhost:3000", { error: true, output: "refused 2" }), grep("port"), bash("curl -f localhost:3000", { error: true, output: "timeout" })]])).findings), ["fix-loop"]);
// A success in between breaks the loop.
assert.deepEqual(kinds(healthReport(session([[bash("npm test", { error: true }), read("/work/app/a.ts"), bash("npm test", { error: true }), read("/work/app/b.ts"), bash("npm test"), read("/work/app/c.ts"), bash("npm test", { error: true })]])).findings), []);
// Four empty searches, or five that aren't in a row, aren't flagged.
const empty = (q: string) => grep(q, { output: "No matches found" });
assert.deepEqual(healthReport(session([[empty("a"), empty("b"), empty("c"), empty("d")]])).findings, []);
assert.deepEqual(healthReport(session([[empty("a"), empty("b"), empty("c"), grep("x", { output: "x.ts" }), empty("d"), empty("e")]])).findings, []);
// Re-running the tests after real edits, or reading a big file in parts, isn't flagged.
assert.deepEqual(healthReport(session([[bash("npm test"), edit("/work/app/a.ts"), bash("npm test"), edit("/work/app/a.ts"), bash("npm test")]])).findings, []);
assert.deepEqual(healthReport(session([[1, 2, 3, 4].map((n) => call("Read", { file_path: "/work/app/huge.ts", offset: n * 100, limit: 100 }))])).findings, []);

// ── Score: decreases monotonically as findings pile up ──
const all = Object.values(fixtures);
let prev = 100;
for (let n = 1; n <= all.length; n++) {
  const m = session(all.slice(0, n));
  const r = healthReport(m);
  assert.equal(r.findings.length, n, `${n} requests -> ${kinds(r.findings).join(", ")}`);
  const kind = Object.keys(fixtures)[n - 1] as Finding["kind"];
  if (FINDING_WEIGHT[kind] > 0) assert.ok(r.score < prev, `score ${r.score} should be below ${prev}`);
  else assert.equal(r.score, prev, `${kind} shouldn't change the score`);
  assert.ok(r.score >= 0 && Number.isInteger(r.score));
  prev = r.score;
  // Per-request scope only sees its own request's findings.
  assert.equal(healthReport(m, m.turns[n - 1]).findings.length, 1);
  assert.equal(healthReport(m, m.turns[n - 1]).findings[0].turn, n - 1);
}

// ── Errors and what Claude did next ──
const rec = session([[
  bash("npm run lint", { error: true }), bash("npm run lint"), // retried: the same command again
  read("/work/app/missing.ts", { error: true }), grep("missing"), // tried something else
  edit("/work/app/a.ts", { error: true }), // gave up: nothing after it
]]);
h = healthReport(rec);
assert.equal(h.errors.total, 3);
assert.equal(h.errors.toolCalls, 5);
assert.deepEqual(h.errors.items.map((e) => [e.step.tool, e.next]), [["Bash", "retried"], ["Read", "different"], ["Edit", "gave-up"]]);
// An edit retried on the same file with a different patch is still "tried again".
const reEdit = session([[call("Edit", { file_path: "/work/app/a.ts", old_string: "x", new_string: "y" }, { error: true }), call("Edit", { file_path: "/work/app/a.ts", old_string: "z", new_string: "y" })]]);
assert.equal(healthReport(reEdit).errors.items[0].next, "retried");
const most = session([[bash("a", { error: true }), bash("b", { error: true }), read("/work/app/n.ts", { error: true }), read("/work/app/n2.ts")]]);
assert.equal(healthReport(most).errors.mostFailing, "Bash");

// ── Risky actions ──
const step = (tool: string, input: Record<string, unknown>) => ({ id: "x", kind: "tool", actor: "lead", tool, input }) as unknown as Step;
const sh = (command: string) => riskOf(step("Bash", { command }))?.level;
const risky: [string, "caution" | "danger" | undefined][] = [
  ["rm -rf src", "danger"],
  ["cd /tmp && rm -r photos", "danger"],
  // Wrappers: the quoted command is still a command.
  ['powershell -Command "Remove-Item -Recurse -Force C:\\x"', "danger"],
  ["bash -c 'rm -rf ~'", "danger"],
  ["bash -lc 'rm -rf docs'", "danger"],
  ['ssh h "sudo rm -rf /"', "danger"],
  ['ssh -i key.pem me@host "rm -rf /srv/app"', "danger"],
  ['cmd /c "rmdir /s /q C:\\proj"', "danger"],
  ["eval 'git reset --hard'", "danger"],
  ["find . -delete", "danger"],
  ["find . -name '*.log' -delete", "danger"],
  ["git push origin +main", "danger"],
  ["git push --force-if-includes origin main", "caution"],
  // Only a real recursive flag makes rm -r; git rm --cached deletes nothing; sudo only as a command.
  ["rm -Force a.txt", "caution"],
  ["git rm -r --cached dist", undefined],
  ["git rm old.txt", "caution"],
  ["grep -n sudo README.md", undefined],
  ["ls && sudo whoami", "caution"],
  ["echo don't; rm -rf /; echo 'x'", "danger"],
  ["echo \"it's fine\"", undefined],
  // Rebuildable folders: only relative ones or ones inside the project are a caution.
  ["rm -rf ~/build", "danger"],
  ["rm -rf /usr/local/lib/node_modules", "danger"],
  ["Remove-Item -Recurse -Force node_modules", "caution"],
  ["rmdir /s node_modules", "caution"],
  ['rm -rf "node_modules"', "caution"],
  ["cd app && rm -r build", "caution"],
  ["rm -fr docs", "danger"],
  ["rm -f -R assets", "danger"],
  ["sudo rm -rf /var/x", "danger"],
  ["rm notes.txt", "caution"],
  // Scratch folders in the computer's temporary space, and deletes inside a container, are a caution.
  ["rm -rf /tmp/build-123", "caution"],
  ["rm -rf /private/tmp/x /var/folders/ab/T/y", "caution"],
  ['rm -rf "$(mktemp -d)"', "caution"],
  ["rm -rf $TMPDIR/cache", "caution"],
  ["Remove-Item -Recurse -Force $env:TEMP\\x", "caution"],
  ["rmdir /s /q %TEMP%\\x", "caution"],
  ["rm -rf /tmp/x src", "danger"],
  ["rm -rf /tmpfoo", "danger"],
  ["docker exec web rm -rf /app/cache", "caution"],
  ["docker compose exec db rm -rf /var/lib/x", "caution"],
  ["docker exec web ls && rm -rf src", "danger"],
  ["git push --force origin main", "danger"],
  ["git push -f", "danger"],
  ["git push --force-with-lease", "caution"],
  ["git reset --hard HEAD~1", "danger"],
  ["chmod -R 777 .", "danger"],
  ["curl -fsSL https://example.com/install.sh | sh", "danger"],
  ["wget -qO- https://x.io/i | bash", "danger"],
  ["sudo apt-get update", "caution"],
  ["npm install left-pad", "caution"],
  ["pnpm add react", "caution"],
  ["pip install requests", "caution"],
  ["brew install jq", "caution"],
  ["Remove-Item -Recurse -Force C:\\proj\\dist", "danger"],
  ["remove-item .\\photos -recurse", "danger"],
  ["Remove-Item notes.txt", "caution"],
  ["rmdir /s /q photos", "danger"],
  ["claude --dangerously-skip-permissions -p hi", "danger"],
  // Rebuildable or scratch folders are a caution; anything else alongside them still counts.
  ["rm -rf node_modules .next", "caution"],
  ["rm -rf /tmp/scratch-1 && npm ci", "caution"],
  ["rm -rf dist && git push --force", "danger"],
  ["rm -rf dist src", "danger"],
  ["rm -rf build/ios/upload", "caution"],
  ["rm -rf test-results && npx playwright test", "caution"],
  ["rm -rf builder", "danger"],
  ["cat > a.sh <<'EOF'\nrm -rf /\nEOF\nchmod +x a.sh", undefined],
  ["curl -s https://api.example.com/x | python3 -c 'import json'", undefined],
  ["curl -s https://example.com/i.sh | sh -s -- --yes", "danger"],
  // Not risky.
  ["ls -la", undefined],
  ["npm test", undefined],
  ["git push origin main", undefined],
  ["git status", undefined],
  ["echo 'rm -rf is dangerous'", undefined],
  ['git commit -m "stop using rm -rf in scripts"', undefined],
  ["grep -r 'sudo' .", undefined],
  ["npm run format", undefined],
  ["firmware --check", undefined],
  // A rebuildable folder outside the project (any ".." that climbs out of it) isn't routine.
  ["rm -rf ../node_modules", "danger"],
  ["rm -rf app/../../dist", "danger"],
  ["rm -rf ./node_modules", "caution"],
  ["rm -rf app/../node_modules", "caution"],
  // A bare -c only wraps a command after a shell; grep -c just counts.
  ['grep -c "rm -rf /" f', undefined],
  ["wc -c 'sudo rm -rf /'", undefined],
  ["/bin/bash -c 'rm -rf docs'", "danger"],
  ["fish -c 'rm -rf docs'", "danger"],
  ["pwsh -c 'Remove-Item -Recurse -Force C:\\x'", "danger"],
  ["cmd.exe /c \"del /s C:\\x\"", "danger"],
  ['tool /c "rm -rf /"', undefined],
  // Flags that take values before -c / -Command still wrap a command.
  ['powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item -Recurse -Force C:\\x"', "danger"],
  ["bash -o pipefail -c 'rm -rf docs'", "danger"],
  ["sh -e -u -c 'rm -rf docs'", "danger"],
  ['grep -c "rm -rf /" f && echo "rm -rf /"', undefined],
  ["bash run.sh && grep -c 'rm -rf /' f", undefined],
  // ".." after a rebuildable folder climbs back out of it.
  ["rm -rf node_modules/..", "danger"],
  ["rm -rf dist/../src", "danger"],
  // Force refspecs: "+src:dst" and "src:+dst".
  ["git push origin HEAD:+main", "danger"],
  ["git push origin feature:+refs/heads/main", "danger"],
  ["git push origin +HEAD:main", "danger"],
  ["git push origin HEAD:main", undefined],
];
for (const [cmd, level] of risky) assert.equal(sh(cmd), level, cmd);
assert.equal(riskOf(step("PowerShell", { command: "Remove-Item -Path C:\\x -Recurse -Force" }))?.level, "danger");
for (const [cmd] of risky.filter(([, l]) => l)) {
  const why = riskOf(step("Bash", { command: cmd }))!.why;
  assert.ok(why.length > 20 && /[.]$/.test(why), `plain explanation for ${cmd}`);
}
assert.match(riskOf(step("Bash", { command: "rm -rf x" }))!.why, /can't be undone/);
assert.match(riskOf(step("Bash", { command: "rm -rf node_modules" }))!.why, /rebuild/);
assert.match(riskOf(step("Bash", { command: "rm -rf /tmp/x" }))!.why, /temporary/);
assert.match(riskOf(step("Bash", { command: "docker exec web rm -rf /app" }))!.why, /inside a container/);
assert.match(riskOf(step("Bash", { command: "git push --force-with-lease origin main" }))!.why, /checks nobody else changed it/);
assert.equal(riskOf(step("Bash", { command: "git push --force-with-lease origin main" }))!.level, "caution");
// Writes outside the session folder, with Windows and POSIX spellings.
const posix = { cwds: ["/work/app"] };
assert.equal(riskOf(step("Write", { file_path: "/work/app/src/a.ts" }), posix), undefined);
assert.equal(riskOf(step("Edit", { file_path: "/work/other/a.ts" }), posix)?.level, "caution");
assert.equal(riskOf(step("Edit", { file_path: "/work/application/a.ts" }), posix)?.level, "caution", "a sibling folder with a shared prefix is outside");
assert.equal(riskOf(step("Write", { file_path: "/work/app/../secret/a.ts" }), posix)?.level, "caution");
assert.equal(riskOf(step("Write", { file_path: "src/relative.ts" }), posix), undefined, "relative paths are inside the project");
const win = { cwds: ["C:\\Users\\Me\\App"] };
assert.equal(riskOf(step("Write", { file_path: "c:/users/me/app/src/a.ts" }), win), undefined);
assert.equal(riskOf(step("Write", { file_path: "C:\\Users\\Me\\App\\src\\a.ts" }), win), undefined);
assert.equal(riskOf(step("Write", { file_path: "C:\\Users\\Me\\Other\\a.ts" }), win)?.level, "caution");
assert.equal(riskOf(step("Write", { file_path: "/tmp/scratch.txt" }), posix), undefined, "scratch files in the temp folder are fine");
// Rebuildable folders inside the project, by full path, are a caution too.
assert.equal(riskOf(step("Bash", { command: "rm -rf /work/app/node_modules" }), posix)?.level, "caution");
assert.equal(riskOf(step("Bash", { command: "rm -rf /work/other/node_modules" }), posix)?.level, "danger");
assert.equal(riskOf(step("Write", { file_path: "/Users/me/.claude/plans/p.md" }), posix), undefined, "Claude's own plan files are fine");
assert.equal(riskOf(step("Read", { file_path: "/etc/hosts" }), posix), undefined, "reading is never risky");
assert.equal(riskOf(step("Write", { file_path: "/etc/hosts" })), undefined, "no folder known: no outside check");
// Malformed input never throws.
for (const bad of [undefined, null, 5, "x", { command: 5 }, { file_path: null }]) {
  assert.equal(riskOf(step("Bash", bad as Record<string, unknown>)), undefined);
  assert.equal(riskOf(step("Write", bad as Record<string, unknown>), posix), undefined);
}

// ── Paths: one normalizePath for client and server ──
assert.equal(normalizePath("C:\\Users\\Me\\a.ts"), normalizePath("c:/users/me/a.ts"));
assert.equal(normalizePath("/c/Users/Me/a.ts"), normalizePath("C:\\Users\\Me\\a.ts"), "Git Bash spelling");
assert.equal(normalizePath("/mnt/c/Users/Me/a.ts"), normalizePath("C:\\Users\\Me\\a.ts"), "WSL spelling");
assert.equal(normalizePath("\\\\?\\C:\\Users\\Me\\a.ts"), normalizePath("C:/Users/Me/a.ts"), "long-path prefix");
assert.equal(normalizePath("\\\\?\\UNC\\srv\\share\\x"), normalizePath("\\\\srv\\share\\x"), "long UNC prefix");
assert.equal(normalizePath("C:\\a\\.\\b\\\\c\\..\\d"), "c:/a/b/d");
assert.equal(normalizePath("C:\\..\\a"), "c:/a", "never above the drive");
assert.notEqual(normalizePath("/Users/Me/a.ts"), normalizePath("/users/me/a.ts"), "POSIX paths keep their case");
assert.equal(normalizePath("/srv//b/./c/../d/"), "/srv/b/d");
assert.equal(normalizePath("/"), "/");
assert.equal(normalizePath("a/./b//c"), "a/b/c");
assert.equal(normalizePath("../x"), "../x");
assert.equal(normalizePath("/mnt/data/x"), "/mnt/data/x", "only /mnt/<one letter> is a drive");
assert.ok(isInside("C:\\Proj\\src\\x.ts", "c:/proj"));
assert.ok(!isInside("/proj2/x", "/proj"));

// ── Files changed: merges spellings, counts, ordered changes ──
const filesM = session([
  [read("C:\\Users\\Me\\App\\a.ts"), edit("c:/users/me/app/a.ts"), read("C:\\Users\\Me\\App\\b.ts")],
  [write("C:\\Users\\Me\\App\\a.ts"), call("MultiEdit", { file_path: "/c/Users/Me/App/a.ts", edits: [] }), call("NotebookEdit", { notebook_path: "C:\\Users\\Me\\App\\n.ipynb", new_source: "x" })],
], "C:\\Users\\Me\\App");
const files = filesTouched(filesM);
const a = files.find((f) => /a\.ts$/.test(f.path))!;
assert.equal(files.filter((f) => /a\.ts$/i.test(f.path)).length, 1, "one entry per file");
assert.deepEqual([a.reads, a.writes, a.edits], [1, 1, 2]);
assert.deepEqual(a.changes.map((c) => [c.step.tool, c.turn]), [["Edit", 0], ["Write", 1], ["MultiEdit", 1]]);
assert.ok(files.find((f) => /n\.ipynb$/.test(f.path))?.edits === 1);
const b = files.find((f) => /b\.ts$/.test(f.path))!;
assert.deepEqual([b.reads, b.writes, b.edits, b.changes.length], [1, 0, 0, 0]);
// Changed files come before files that were only read.
assert.ok(files.findIndex((f) => f === b) > files.findIndex((f) => f === a));
// A failed edit didn't change anything.
const failedEdit = filesTouched(session([[edit("/work/app/a.ts", { error: true })]]));
assert.deepEqual(failedEdit, []);
// New files: written first, never read or changed before. A file that was read first, or edited first, existed.
const made = filesTouched(session([[write("/work/app/new.ts"), edit("/work/app/new.ts"), read("/work/app/old.ts"), write("/work/app/old.ts"), edit("/work/app/x.ts")]]));
assert.deepEqual(made.map((f) => [f.path.split("/").pop(), f.created]), [["new.ts", true], ["old.ts", false], ["x.ts", false]]);
assert.equal(a.created, false);

// ── Phases: cover every step exactly once, in order ──
const phaseM = session([
  [read("/work/app/a.ts"), grep("x"), edit("/work/app/a.ts"), write("/work/app/b.ts"), bash("npm test"), bash("git diff"), read("/work/app/a.ts")],
  [],
]);
for (const t of [...phaseM.turns, ...session(Object.values(fixtures)).turns, ...rec.turns]) {
  const ph = phasesOf(t);
  if (!t.steps.length) {
    assert.deepEqual(ph, []);
    continue;
  }
  assert.equal(ph[0].from, 0);
  assert.equal(ph.at(-1)!.to, t.steps.length - 1);
  for (let i = 1; i < ph.length; i++) {
    assert.equal(ph[i].from, ph[i - 1].to + 1, "no gaps or overlaps");
    assert.notEqual(ph[i].kind, ph[i - 1].kind, "neighbours differ");
  }
  for (const p of ph) assert.ok(p.from <= p.to);
}
assert.deepEqual(phasesOf(phaseM.turns[0]).map((p) => p.kind), ["exploring", "changing", "testing", "reviewing", "answering"]);
// A long request that flips back and forth is folded into a readable number of phases, still covering every step.
const flippy = session([Array.from({ length: 300 }, (_, i) => (i % 2 ? read(`/work/app/r${i}.ts`) : bash(`npm test ${i}`)))]).turns[0];
const fp = phasesOf(flippy);
assert.ok(fp.length <= 40, `${fp.length} phases`);
assert.equal(fp[0].from, 0);
assert.equal(fp.at(-1)!.to, flippy.steps.length - 1);
for (let i = 1; i < fp.length; i++) assert.equal(fp[i].from, fp[i - 1].to + 1);
assert.deepEqual(phasesOf(phaseM.turns[1]).map((p) => p.kind), ["answering"]);
// For display, phases too narrow to read are merged into their neighbours; every step stays covered.
{
  const ph = [
    { kind: "exploring", from: 0, to: 9 },
    { kind: "changing", from: 10, to: 10 },
    { kind: "testing", from: 11, to: 11 },
    { kind: "reviewing", from: 12, to: 21 },
    { kind: "answering", from: 22, to: 22 },
  ] as const;
  const segs = mergeNarrowPhases([...ph], 4);
  assert.deepEqual(segs.map((x) => [x.kind, x.from, x.to, x.parts.length]), [["exploring", 0, 9, 1], ["reviewing", 10, 22, 4]]);
  for (const x of segs) assert.ok(x.to - x.from + 1 >= 4);
  assert.deepEqual(mergeNarrowPhases([...ph], 1).map((x) => x.parts.length), [1, 1, 1, 1, 1], "wide enough: nothing merged");
  assert.deepEqual(mergeNarrowPhases([{ kind: "testing", from: 0, to: 1 }], 4).map((x) => [x.kind, x.from, x.to]), [["testing", 0, 1]], "one short phase stays");
  assert.deepEqual(mergeNarrowPhases([], 4), []);
  const many = mergeNarrowPhases(fp, Math.ceil(flippy.steps.length / 10));
  assert.ok(many.length <= 10, `${many.length} segments`);
  assert.equal(many[0].from, 0);
  assert.equal(many.at(-1)!.to, flippy.steps.length - 1);
  for (let i = 1; i < many.length; i++) assert.equal(many[i].from, many[i - 1].to + 1);
}
assert.deepEqual(phasesOf({ index: 0, text: "", ts: 0, end: 0, steps: [], actors: [], usage: clean.usage, context: 0 }), []);

// ── Delegating: briefs and reports ──
const lead: LogRecord[] = [
  { type: "user", timestamp: at(0), message: { content: "go" } },
  { type: "assistant", timestamp: at(1), message: { id: "a1", stop_reason: "tool_use", content: [{ type: "tool_use", id: "ag", name: "Agent", input: { description: "Helper", prompt: "do it" } }] } },
  { type: "user", timestamp: at(5), message: { content: [{ type: "tool_result", tool_use_id: "ag", content: "all done" }] } },
  { type: "assistant", timestamp: at(6), message: { id: "a2", stop_reason: "end_turn", content: [{ type: "text", text: "Finished." }] } },
];
assert.deepEqual(phasesOf(buildSession(lead, {}, now).turns[0]).map((p) => p.kind), ["delegating", "answering"]);

// ── Hook runs ──
const hooks: LogRecord[] = [
  { type: "attachment", timestamp: at(100), attachment: { type: "hook_success", hookName: "SessionStart:startup", hookEvent: "SessionStart", command: "start.sh", exitCode: 0, stderr: "", durationMs: 50, toolUseID: "h1" } },
  { type: "attachment", timestamp: at(101), attachment: { type: "hook_success", hookName: "SessionStart:startup", hookEvent: "SessionStart", command: "start.sh", exitCode: 0, durationMs: 40, toolUseID: "h2" } },
  // Labelled a success, but the exit code says otherwise.
  { type: "attachment", timestamp: at(102), attachment: { type: "hook_success", hookName: "PostToolUse:Edit", hookEvent: "PostToolUse", command: "fmt.sh", exitCode: 2, stderr: "prettier not found", toolUseID: "h3" } },
  { type: "attachment", timestamp: at(103), attachment: { type: "hook_non_blocking_error", hookName: "Stop", hookEvent: "Stop", command: "notify.sh", exitCode: 1, stderr: "AudioQueueStart failed", toolUseID: "h4" } },
  // The same Stop run, summarised: counted once.
  { type: "system", subtype: "stop_hook_summary", timestamp: at(104), toolUseID: "h4", hookCount: 2, hookInfos: [{ command: "notify.sh", durationMs: 9 }, { command: "callback" }], hookErrors: ["AudioQueueStart failed"] },
  // A Stop hook only seen in a summary.
  { type: "system", subtype: "stop_hook_summary", timestamp: at(105), toolUseID: "h5", hookCount: 1, hookInfos: [{ command: "log.sh", durationMs: 3 }], hookErrors: [] },
  // Extra context from a run already counted isn't counted again; without a hook name it's skipped.
  { type: "attachment", timestamp: at(100), attachment: { type: "hook_additional_context", hookName: "SessionStart:startup", hookEvent: "SessionStart", toolUseID: "h1", content: ["x"] } },
  // A hook only seen through the context it added still ran.
  { type: "attachment", timestamp: at(106), attachment: { type: "hook_additional_context", hookName: "PostToolUse:Write", hookEvent: "PostToolUse", toolUseID: "h6", content: ["x"] } },
  { type: "attachment", timestamp: at(106), attachment: { type: "hook_additional_context", content: ["x"] } },
  { type: "attachment", timestamp: at(107), attachment: { type: "hook_success" } },
  { type: "system", subtype: "stop_hook_summary", timestamp: at(108), hookInfos: "nope" },
  {},
  { type: "attachment" },
];
const runs = hookRuns(session([[]], "/work/app", hooks));
const byName = Object.fromEntries(runs.map((r) => [r.name, r]));
assert.deepEqual(Object.keys(byName).sort(), ["PostToolUse:Write", "fmt.sh", "log.sh", "notify.sh", "start.sh"]);
assert.deepEqual([byName["PostToolUse:Write"].runs, byName["PostToolUse:Write"].event], [1, "PostToolUse"]);
assert.deepEqual([byName["start.sh"].runs, byName["start.sh"].failed, byName["start.sh"].event], [2, 0, "SessionStart"]);
assert.deepEqual([byName["fmt.sh"].runs, byName["fmt.sh"].failed], [1, 1]);
assert.equal(byName["fmt.sh"].samples[0].stderr, "prettier not found");
assert.equal(byName["fmt.sh"].samples[0].exitCode, 2);
assert.deepEqual([byName["notify.sh"].runs, byName["notify.sh"].failed, byName["notify.sh"].event], [1, 1, "Stop"]);
assert.deepEqual([byName["log.sh"].runs, byName["log.sh"].failed, byName["log.sh"].event], [1, 0, "Stop"]);
// Failing hooks come first.
assert.ok(runs.findIndex((r) => r.failed) < runs.findIndex((r) => !r.failed));
assert.deepEqual(hookRuns(clean), []);

// ── Malformed records never crash any analysis ──
const junk = buildSession([{}, { type: "assistant" }, { type: "user", message: null }, { type: "assistant", message: { content: [{ type: "tool_use", id: "j", name: "Bash", input: null }] } }, { type: "weird" }] as LogRecord[], {}, now);
healthReport(junk);
filesTouched(junk);
hookRuns(junk);
for (const t of junk.turns) phasesOf(t);
for (const t of junk.turns) for (const s of t.steps) riskOf(s, { cwds: [] });

// ── Big sessions: the health checks over 50k steps stay well under a second ──
{
  const calls: Call[] = [];
  for (let i = 0; i < 50_000; i++) {
    const k = i % 5;
    calls.push(k === 0 ? read(`/work/app/f${i % 300}.ts`) : k === 1 ? edit(`/work/app/f${i % 300}.ts`) : k === 2 ? bash(`npm test ${i % 7}`, { error: i % 3 === 0, output: "1 failed" }) : k === 3 ? grep(`x${i}`, { output: i % 2 ? "" : "a.ts" }) : write(`/work/app/n${i % 50}.ts`));
  }
  const requests: Call[][] = [];
  for (let i = 0; i < calls.length; i += 500) requests.push(calls.slice(i, i + 500));
  const big = session(requests);
  const t = performance.now();
  const r = healthReport(big);
  const ms = performance.now() - t;
  assert.ok(r.errors.toolCalls === 50_000, String(r.errors.toolCalls));
  assert.ok(ms < 1000, `health on 50k steps took ${Math.round(ms)} ms`);
  console.log(`✓ health on 50k steps in ${Math.round(ms)} ms`);
}

console.log("health checks passed");
