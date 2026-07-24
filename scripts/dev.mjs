/**
 * Start Vite + project sidecar together; Ctrl+C stops both.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

/** @type {import("node:child_process").ChildProcess[]} */
const children = [];
let shuttingDown = false;

function start(script) {
  const child = spawn(npmCmd, ["run", script], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    shutdown();
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
  children.push(child);
}

function shutdown() {
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) {
      child.kill("SIGTERM");
    }
  }
}

process.on("SIGINT", () => {
  shutdown();
  setTimeout(() => process.exit(0), 300);
});

process.on("SIGTERM", () => {
  shutdown();
  setTimeout(() => process.exit(0), 300);
});

console.log("ForkNote dev: starting sidecar + Vite (Ctrl+C stops both)\n");
start("sidecar");
start("dev:web");
