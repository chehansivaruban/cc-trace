#!/usr/bin/env node
// `npx cc-trace`: serves the prebuilt dashboard on localhost and opens it.
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import next from "next";

// Keeps the "no network calls" promise: Next.js telemetry is opt-out.
process.env.NEXT_TELEMETRY_DISABLED ??= "1";

// 3000 clashes with React, Next.js and most dev servers; 4747 is rarely taken.
const DEFAULT_PORT = "4747";

const { values: args } = parseArgs({
  options: {
    port: { type: "string", short: "p", default: process.env.PORT ?? DEFAULT_PORT },
    "no-open": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (args.help) {
  console.log(`Usage: cc-trace [--port <n>] [--no-open]

Opens http://localhost:${DEFAULT_PORT} (or the next free port).

See what Claude Code and its helper agents are doing, read from ~/.claude/projects
(or $CLAUDE_CONFIG_DIR/projects). Read-only, local-only, no API calls.`);
  process.exit(0);
}

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = next({ dev: false, dir });
await app.prepare();
const handle = app.getRequestHandler();
const server = http.createServer((req, res) => handle(req, res));

const firstPort = Number(args.port);
let port = firstPort;
server.on("error", (err) => {
  if (err.code === "EADDRINUSE" && port < firstPort + 10) return server.listen(++port, "127.0.0.1");
  console.error(err.message);
  process.exit(1);
});
server.once("listening", () => {
  const url = `http://localhost:${port}`;
  console.log(`cc-trace running at ${url}  (Ctrl+C to stop)`);
  if (!args["no-open"]) openBrowser(url);
});

function openBrowser(url) {
  const [cmd, ...rest] =
    process.platform === "darwin" ? ["open"] : process.platform === "win32" ? ["cmd", "/c", "start", ""] : ["xdg-open"];
  spawn(cmd, [...rest, url], { stdio: "ignore", detached: true, windowsHide: true })
    .on("error", () => {}) // no browser available (e.g. SSH): the URL is printed above
    .unref();
}

// 127.0.0.1 only: transcripts must never be reachable from the network.
server.listen(port, "127.0.0.1");
