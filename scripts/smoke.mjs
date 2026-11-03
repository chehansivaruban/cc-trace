// End-to-end check on the real server, on any OS. Run after `pnpm build`:
//   node scripts/smoke.mjs            tests this checkout
//   node scripts/smoke.mjs --packed   packs the npm package, installs it in a temp folder, tests that copy
import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-trace-smoke-"));
const PORT = Number(process.env.SMOKE_PORT) || 4870;
const t = new Date().toISOString();

let bin = path.join(root, "bin", "cc-trace.mjs");
if (process.argv.includes("--packed")) {
  const [{ filename }] = JSON.parse(execSync(`npm pack --json --pack-destination "${tmp}"`, { cwd: root }).toString());
  const app = path.join(tmp, "app");
  fs.mkdirSync(app);
  execSync("npm init -y", { cwd: app, stdio: "ignore" });
  execSync(`npm install --no-audit --no-fund "${path.join(tmp, path.basename(filename))}"`, { cwd: app, stdio: "inherit" });
  const { name } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  bin = path.join(app, "node_modules", name, "bin", "cc-trace.mjs");
}

// A fake ~/.claude with one session, named the way Claude Code names Windows projects.
const config = path.join(tmp, "claude");
const projectDir = path.join(config, "projects", "C--Users-demo-app");
fs.mkdirSync(projectDir, { recursive: true });
const log = path.join(projectDir, "s1.jsonl");
const line = (rec) => fs.appendFileSync(log, JSON.stringify(rec) + "\n");
line({ type: "user", cwd: "C:\\Users\\demo\\app", timestamp: t, message: { content: "hello from smoke test" } });
line({ type: "assistant", timestamp: t, message: { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } });

function get(urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port: PORT, path: urlPath, headers }, (res) => {
        let body = "";
        res.on("data", (d) => (body += d)).on("end", () => resolve({ status: res.statusCode, body }));
      })
      .on("error", reject);
  });
}

// The newest stream output, shown if a test times out.
let lastStream = "";

/** Opens the SSE stream; resolves once `match` shows up after the replay. */
function streamUntil(urlPath, onReady, match) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port: PORT, path: urlPath }, (res) => {
      let body = "";
      let ready = false;
      res.on("data", (d) => {
        body += d;
        lastStream = (lastStream + d).slice(-600);
        if (!ready && body.includes("event: ready")) {
          ready = true;
          body = "";
          onReady();
        }
        if (ready && body.includes(match)) {
          req.destroy();
          resolve();
        }
      });
    });
    req.on("error", (err) => err.code !== "ECONNRESET" && reject(err));
  });
}

const server = spawn(process.execPath, [bin, "--no-open", "--port", String(PORT)], {
  env: { ...process.env, CLAUDE_CONFIG_DIR: config },
  stdio: ["ignore", "pipe", "inherit"],
});
const timeout = setTimeout(() => fail(new Error("timed out after 60s")), 60_000);

function finish(code) {
  clearTimeout(timeout);
  // Windows keeps the folder locked until the server has fully exited.
  const done = () => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      // a leftover temp folder is harmless
    }
    process.exit(code);
  };
  if (server.exitCode !== null || server.signalCode !== null) return done();
  server.once("exit", done);
  server.kill();
}
function fail(err) {
  console.error("smoke test FAILED:", err);
  if (lastStream) console.error("last stream output:\n" + lastStream);
  finish(1);
}

try {
  await new Promise((resolve, reject) => {
    server.stdout.on("data", (d) => String(d).includes("running at") && resolve());
    server.once("exit", (code) => reject(new Error(`server exited early (code ${code})`)));
  });

  const page = await get("/");
  assert.equal(page.status, 200, "dashboard page");

  const sessions = await get("/api/sessions");
  const [project] = JSON.parse(sessions.body);
  assert.equal(project.path, "C:\\Users\\demo\\app");
  assert.equal(project.sessions[0].title, "hello from smoke test");
  console.log("✓ lists projects and sessions");

  // ── sessions ──
  {
    const s = project.sessions[0];
    assert.equal(s.title, "hello from smoke test");
    assert.equal(s.firstPrompt, "hello from smoke test");
    assert.equal(s.cwd, "C:\\Users\\demo\\app");
    assert.equal(s.requests, 1);
    assert.equal(s.tokens, 0);
    assert.equal(s.live, false);
    assert.equal(typeof s.started, "number");
    console.log("✓ session list has titles, counts and live state");
  }
  // ── live ──
  {
    const live = await get("/api/live");
    assert.equal(live.status, 200);
    assert.deepEqual(JSON.parse(live.body), [], "no ~/.claude/sessions folder: nothing running");
    assert.equal((await get("/api/live", { Host: "evil.example" })).status, 403);
    console.log("✓ live sessions: empty without a registry, localhost only");
  }
  // ── end sessions + live ──

  assert.equal((await get("/api/sessions", { Host: "evil.example" })).status, 403);
  console.log("✓ refuses non-localhost hosts");

  assert.equal((await get("/api/stream?file=" + encodeURIComponent("../../secret.jsonl"))).status, 400);
  console.log("✓ refuses paths outside the logs folder");

  // The live part: a line appended after connecting must arrive without a reload.
  const file = encodeURIComponent(project.sessions[0].file);
  await streamUntil(
    `/api/stream?file=${file}`,
    () => setTimeout(() => line({ type: "user", timestamp: t, message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "live-line-ok" }] } }), 500),
    "live-line-ok",
  );
  console.log("✓ streams new log lines live");

  // A helper (sub-agent) that starts after the page is open: its folder and logs don't exist yet.
  await streamUntil(
    `/api/stream?file=${file}`,
    () =>
      setTimeout(() => {
        const sub = path.join(projectDir, "s1", "subagents");
        fs.mkdirSync(sub, { recursive: true });
        fs.writeFileSync(path.join(sub, "agent-h1.meta.json"), JSON.stringify({ description: "Smoke helper", toolUseId: "t9" }));
        fs.appendFileSync(path.join(sub, "agent-h1.jsonl"), JSON.stringify({ type: "user", timestamp: t, message: { content: "helper-line-ok" } }) + "\n");
      }, 500),
    "helper-line-ok",
  );
  console.log("✓ picks up helper agents that start later");

  // ── overview ──
  {
    // A second project with token usage, so the totals have something to add up.
    const dir = path.join(config, "projects", "-Users-demo-overview");
    fs.mkdirSync(dir, { recursive: true });
    const usage = { input_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 40 };
    fs.writeFileSync(
      path.join(dir, "o1.jsonl"),
      [
        { type: "user", cwd: "/Users/demo/overview", timestamp: t, message: { content: "count my tokens" } },
        { type: "assistant", timestamp: t, message: { id: "o-m1", model: "claude-opus-5-5", usage, stop_reason: "end_turn", content: [{ type: "text", text: "Done." }] } },
        {},
      ]
        .map((r) => JSON.stringify(r))
        .join("\n") + "\n",
    );
    const res = await get("/api/overview?days=7");
    assert.equal(res.status, 200, "overview");
    const ov = JSON.parse(res.body);
    assert.equal(ov.partial, false);
    assert.equal(ov.days.length, 7);
    assert.equal(ov.totals.cached, 900);
    assert.equal(ov.days.at(-1).tokens, 1045);
    assert.deepEqual(ov.byModel.map((r) => r.label), ["Opus 5.5"]);
    assert.ok(ov.byProject.some((p) => p.key === "-Users-demo-overview" && p.label === "/Users/demo/overview"));
    assert.ok(ov.tools.some((x) => x.tool === "Bash"), "tools from the first session");
    assert.ok(!/\$|price|cost/i.test(res.body), "no money in the overview");
    assert.equal(JSON.parse((await get("/api/overview")).body).days.length, 30, "30 days by default");
    for (const bad of ["0", "366", "abc", "1.5", "-3", ""]) assert.equal((await get(`/api/overview?days=${encodeURIComponent(bad)}`)).status, 400, `days=${bad}`);
    assert.equal((await get("/api/overview", { Host: "evil.example" })).status, 403);
    // Overlapping requests for one period share a single scan (same generatedAt).
    const [a, b] = await Promise.all([get("/api/overview?days=5"), get("/api/overview?days=5")]);
    assert.equal(JSON.parse(a.body).generatedAt, JSON.parse(b.body).generatedAt, "overlapping requests share one scan");
    console.log("✓ overview adds up token use across sessions");
  }
  // ── end overview ──
  // ── debug log ──
  {
    const debugDir = path.join(config, "debug");
    fs.mkdirSync(debugDir, { recursive: true });
    const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
    fs.writeFileSync(path.join(debugDir, `${id}.txt`), `${t} [DEBUG] debug-log-ok\n${t} [ERROR] boom\n`);
    const ok = await get("/api/debug-log?file=" + encodeURIComponent(`C--Users-demo-app/${id}.jsonl`));
    assert.equal(ok.status, 200);
    assert.ok(ok.body.includes("debug-log-ok"));
    const has = await get("/api/debug-log?check=1&file=" + encodeURIComponent(`C--Users-demo-app/${id}.jsonl`));
    assert.deepEqual([has.status, JSON.parse(has.body)], [200, { missing: false }], "check=1 says a log is there, without sending it");
    console.log("✓ reads a session's debug log");

    // Bigger than 2 MB: only the tail is sent, starting on a whole line.
    const big = "1e0b8c1f-2c33-4b7e-9d2a-3f4a5b6c7d8e";
    fs.writeFileSync(path.join(debugDir, `${big}.txt`), `${t} [DEBUG] first-line\n` + `${t} [DEBUG] ${"x".repeat(200)}\n`.repeat(12_000) + `${t} [WARN] last-line\n`);
    const tail = await get("/api/debug-log?file=" + encodeURIComponent(`C--Users-demo-app/${big}.jsonl`));
    assert.equal(tail.status, 200);
    assert.ok(Buffer.byteLength(tail.body) <= 2 * 1024 * 1024 && !tail.body.includes("first-line") && tail.body.endsWith("last-line\n"));
    assert.ok(tail.body.startsWith(t), "starts on a whole line");
    console.log("✓ sends only the last 2 MB of a big debug log");

    for (const bad of ["../x.jsonl", "../../debug/" + id + ".jsonl", "C--Users-demo-app/a.txt", ""]) {
      assert.equal((await get("/api/debug-log?file=" + encodeURIComponent(bad))).status, 400, bad);
    }
    // No debug log is a normal answer, not a failed request (the browser would log an error for a 404).
    for (const [name, why] of [["C--Users-demo-app/s1.jsonl", "not a session id"], ["C--Users-demo-app/9b2f6a4e-0000-4000-8000-000000000000.jsonl", "no log"]]) {
      for (const extra of ["", "check=1&"]) {
        const res = await get(`/api/debug-log?${extra}file=` + encodeURIComponent(name));
        assert.deepEqual([res.status, JSON.parse(res.body)], [200, { missing: true }], `${why} ${extra}`);
      }
    }
    console.log("✓ refuses bad paths and says plainly when there is no debug log");

    const folders = JSON.parse((await get("/api/folders")).body);
    assert.equal(folders.projects, path.join(config, "projects"));
    assert.equal(folders.debug, debugDir);
    console.log("✓ reports the folders it reads from");
  }
  // ── end debug log ──
  // ── search ──
  const search = async (q, extra = "") => {
    const res = await get(`/api/search?q=${encodeURIComponent(q)}${extra}`);
    assert.equal(res.status, 200, `search ${q}`);
    const rows = res.body.trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(rows.at(-1).done, true, "search ends with a summary line");
    return rows.filter((r) => !r.done);
  };
  const prompt = await search("HELLO from smoke");
  assert.ok(prompt.some((h) => h.file === project.sessions[0].file && h.turn === 0 && h.snippet.includes("hello from smoke test") && !h.step), JSON.stringify(prompt));
  const masked = await search("hello from smoke", "&mask=1");
  assert.ok(masked.some((h) => h.snippet.includes("hello from smoke test")), "masked search still finds plain text");
  const toolHit = await search("live-line-ok");
  assert.equal(toolHit[0]?.step, "t1", "a match in a tool result points at its step");
  assert.ok((await search("helper-line-ok")).length === 1, "helper logs are searched");
  assert.deepEqual(await search("../../etc/passwd"), []);
  {
    // Logs written by someone else (copied in, or read in Docker): their user name is hidden too.
    const dir = path.join(config, "projects", "-Users-alicesmoke-proj");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "a1.jsonl"), JSON.stringify({ type: "user", cwd: "/Users/alicesmoke/proj", timestamp: t, message: { content: "alicesmoke asked for the zebra-plan" } }) + "\n");
    const plain = await search("zebra-plan");
    assert.ok(plain.length === 1 && plain[0].snippet.includes("alicesmoke"), JSON.stringify(plain));
    const hidden = await search("zebra-plan", "&mask=1");
    assert.equal(hidden.length, 1);
    assert.ok(!/alicesmoke/.test(hidden[0].snippet + hidden[0].title), JSON.stringify(hidden)); // the file is an id, not shown
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal((await get("/api/search?q=a")).status, 400);
  assert.equal((await get("/api/search?q=%20%20")).status, 400);
  assert.equal((await get("/api/search?q=hello", { Host: "evil.example" })).status, 403);
  console.log("✓ searches across sessions and refuses one-letter searches");
  // ── end search ──
  // ── live updates (Review Focus 5) ──
  {
    // A session still being written: a step appended while the page is open shows up exactly once, and a
    // /clear-style rewrite (the file shrinks) starts the page over cleanly. The records are kept the way
    // useSessionStream keeps them, then built into the model the page shows.
    const liveDir = path.join(config, "projects", "C--Users-demo-live");
    fs.mkdirSync(liveDir, { recursive: true });
    const liveLog = path.join(liveDir, "live.jsonl");
    const add = (rec) => fs.appendFileSync(liveLog, JSON.stringify(rec) + "\n");
    add({ type: "user", cwd: "C:\\Users\\demo\\live", timestamp: t, message: { content: "watch me live" } });
    add({ type: "assistant", timestamp: t, message: { content: [{ type: "text", text: "On it." }] } });
    const liveFile = encodeURIComponent(path.join("C--Users-demo-live", "live.jsonl"));

    /** Opens the stream and keeps {main, agents} like the page does; `script(state, waitFor)` drives the test. */
    const follow = (script) =>
      new Promise((resolve, reject) => {
        const state = { main: [], agents: {}, resets: 0, events: [] };
        const waiters = [];
        const check = () => {
          for (const w of [...waiters]) {
            if (!w.test(state)) continue;
            waiters.splice(waiters.indexOf(w), 1);
            w.done();
          }
        };
        const waitFor = (test, what) =>
          new Promise((done, bad) => {
            const timer = setTimeout(() => bad(new Error(`live stream: timed out waiting for ${what}`)), 15_000);
            waiters.push({ test, done: () => (clearTimeout(timer), done()) });
            check();
          });
        let buf = "";
        let ready = false;
        const req = http.get({ host: "127.0.0.1", port: PORT, path: `/api/stream?file=${liveFile}` }, (res) => {
          res.on("data", (d) => {
            buf += d;
            lastStream = (lastStream + d).slice(-600);
            let i;
            while ((i = buf.indexOf("\n\n")) >= 0) {
              const block = buf.slice(0, i);
              buf = buf.slice(i + 2);
              const event = /^event: (.*)$/m.exec(block)?.[1];
              const data = /^data: (.*)$/m.exec(block)?.[1];
              if (!event) continue;
              state.events.push(event);
              if (event === "records") {
                const { source, records } = JSON.parse(data);
                if (source === null) state.main = state.main.concat(records);
                else state.agents[source] = { ...state.agents[source], records: (state.agents[source]?.records ?? []).concat(records) };
              } else if (event === "reset") {
                // Like useSessionStream: the main log starts over, the helpers' logs are kept.
                state.resets++;
                state.main = [];
              } else if (event === "ready" && !ready) {
                ready = true;
                script(state, waitFor).then(
                  () => (req.destroy(), resolve(state)),
                  (err) => (req.destroy(), reject(err)),
                );
              }
              check();
            }
          });
        });
        req.on("error", (err) => err.code !== "ECONNRESET" && reject(err));
      });

    // Builds the model with the app's own code. Node 20 can't run TypeScript: there the record checks still run.
    const [major, minor] = process.versions.node.split(".").map(Number);
    const canModel = major > 22 || (major === 22 && minor >= 6);
    const model = (state) =>
      JSON.parse(
        execSync(`"${process.execPath}" --no-warnings --experimental-strip-types "${path.join(root, "scripts", "live-model.mts")}"`, {
          input: JSON.stringify({ main: state.main, agents: state.agents }),
        }).toString(),
      );
    const uses = (state, id) => state.main.filter((r) => r.message?.content?.some?.((b) => b.type === "tool_use" && b.id === id)).length;
    const results = (state, id) => state.main.filter((r) => r.message?.content?.some?.((b) => b.type === "tool_result" && b.tool_use_id === id)).length;

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await follow(async (state, waitFor) => {
      // The tool call, then its result written in two halves (a line caught mid-write).
      add({ type: "assistant", timestamp: t, message: { stop_reason: "tool_use", content: [{ type: "tool_use", id: "rf5-tool", name: "Bash", input: { command: "echo rf5" } }] } });
      await waitFor((s) => uses(s, "rf5-tool") > 0, "the tool call");
      const result = JSON.stringify({ type: "user", timestamp: t, message: { content: [{ type: "tool_result", tool_use_id: "rf5-tool", content: "rf5-done" }] } }) + "\n";
      fs.appendFileSync(liveLog, result.slice(0, 40));
      await sleep(400);
      fs.appendFileSync(liveLog, result.slice(40));
      await waitFor((s) => results(s, "rf5-tool") > 0, "the tool result");
      await sleep(1500); // room for a duplicate to show up, if one were coming
      assert.equal(uses(state, "rf5-tool"), 1, "the tool call arrives once");
      assert.equal(results(state, "rf5-tool"), 1, "the tool result arrives once");
      assert.equal(state.main.length, 4, "nothing else was re-sent");
      if (canModel) {
        const m = model(state);
        const steps = m.steps.filter((s) => s.id === "rf5-tool");
        assert.equal(steps.length, 1, "the new step is in the model exactly once");
        assert.equal(steps[0].status, "success");
        assert.equal(new Set(m.steps.map((s) => s.id)).size, m.steps.length, "no step id twice");
      }

      // A helper log, so the restart below can show helpers survive it.
      const liveSub = path.join(liveDir, "live", "subagents");
      fs.mkdirSync(liveSub, { recursive: true });
      fs.appendFileSync(path.join(liveSub, "agent-lh.jsonl"), JSON.stringify({ type: "user", timestamp: t, message: { content: "rf5-helper" } }) + "\n");
      await waitFor((s) => (s.agents.lh?.records ?? []).length > 0, "the helper log");

      // /clear-style: the log is rewritten shorter. The page must start over, with no old steps left.
      const resetsBefore = state.resets;
      fs.writeFileSync(liveLog, JSON.stringify({ type: "user", timestamp: t, message: { content: "after-clear" } }) + "\n");
      await waitFor((s) => s.resets > resetsBefore && s.main.some((r) => r.message?.content === "after-clear"), "the restart after the log shrank");
      await sleep(800);
      assert.equal(state.main.length, 1, "only the rewritten log is left");
      assert.equal(state.agents.lh?.records.length, 1, "the helper's log survives the main log shrinking, and isn't sent twice");
      if (canModel) {
        const m = model(state);
        assert.equal(m.turns, 1);
        assert.ok(!m.steps.some((s) => s.id === "rf5-tool"), "old steps are gone after the restart");
      }
    });
    console.log(`✓ live updates: a new step arrives once, a shrinking log starts over and keeps its helpers${canModel ? "" : " (model check needs Node 22.6+)"}`);
  }
  // ── end live updates ──

  console.log(`smoke test passed (${process.platform}, node ${process.version})`);
  finish(0);
} catch (err) {
  fail(err);
}
