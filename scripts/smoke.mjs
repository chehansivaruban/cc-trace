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

  console.log(`smoke test passed (${process.platform}, node ${process.version})`);
  finish(0);
} catch (err) {
  fail(err);
}
