/**
 * Start Vite + project sidecar together; Ctrl+C stops both.
 * Reuses an already-healthy sidecar on :8787 instead of failing with EADDRINUSE.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { loadOrCreateSidecarToken } = require("../shared/sidecarAuth.cjs");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

const SIDECAR_PORT = Number(process.env.SIDECAR_PORT || 8787);
const SIDECAR_HOST = process.env.SIDECAR_HOST || "127.0.0.1";
const VITE_PORT = Number(process.env.VITE_PORT || 5173);
const VITE_HOST = process.env.VITE_HOST || "127.0.0.1";
const SIDECAR_AUTH_TOKEN = loadOrCreateSidecarToken();
process.env.SIDECAR_AUTH_TOKEN = SIDECAR_AUTH_TOKEN;

/** @type {import("node:child_process").ChildProcess[]} */
const children = [];
let shuttingDown = false;
/** True when this launcher spawned the sidecar (kill it on exit). */
let weStartedSidecar = false;

function isPortOpen(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

function sidecarHealth() {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: SIDECAR_HOST,
        port: SIDECAR_PORT,
        path: "/health",
        timeout: 800,
        headers: {
          "X-ForkNote-Sidecar-Token": SIDECAR_AUTH_TOKEN,
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode !== 200) {
            resolve(false);
            return;
          }
          try {
            const data = JSON.parse(body);
            resolve(data && data.ok === true);
          } catch {
            resolve(false);
          }
        });
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForSidecar(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await sidecarHealth()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function portHint(port) {
  return process.platform === "win32"
    ? `netstat -ano | findstr :${port}`
    : `lsof -nP -iTCP:${port} -sTCP:LISTEN`;
}

/**
 * @param {string} script
 * @param {{ fatal?: boolean }} [opts]
 */
function start(script, opts = {}) {
  const fatal = opts.fatal !== false;
  const child = spawn(npmCmd, ["run", script], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    if (!fatal) {
      // Sidecar child exited while Vite should keep running (e.g. reused port).
      return;
    }
    shuttingDown = true;
    shutdown();
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
  children.push(child);
  return child;
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

async function main() {
  console.log("ForkNote dev: starting sidecar + Vite (Ctrl+C stops both)\n");

  if (await sidecarHealth()) {
    console.log(
      `[forknote] sidecar already healthy on http://${SIDECAR_HOST}:${SIDECAR_PORT} — reusing`,
    );
  } else if (await isPortOpen(SIDECAR_PORT, SIDECAR_HOST)) {
    console.error(
      `[forknote] port ${SIDECAR_PORT} is in use, but GET /health failed.`,
    );
    console.error(
      `  Something else may be bound to http://${SIDECAR_HOST}:${SIDECAR_PORT}.`,
    );
    console.error(`  See who owns it: ${portHint(SIDECAR_PORT)}`);
    console.error(
      `  Then free the port, or set SIDECAR_PORT to an unused port and retry.`,
    );
    process.exit(1);
  } else {
    weStartedSidecar = true;
    // Sidecar exit must not tear down Vite if we later decide to keep going;
    // we wait for health below and only then start Vite.
    start("sidecar", { fatal: false });
    if (!(await waitForSidecar())) {
      console.error(
        `[forknote] sidecar did not become ready on http://${SIDECAR_HOST}:${SIDECAR_PORT}`,
      );
      console.error(
        `  Try: npm run sidecar   (watch for listen / EADDRINUSE errors)`,
      );
      console.error(`  Or:  ${portHint(SIDECAR_PORT)}`);
      shutdown();
      process.exit(1);
    }
    console.log(
      `[forknote] sidecar ready on http://${SIDECAR_HOST}:${SIDECAR_PORT}`,
    );
  }

  if (await isPortOpen(VITE_PORT, VITE_HOST)) {
    console.error(
      `[forknote] Vite port ${VITE_PORT} is already in use on ${VITE_HOST}.`,
    );
    console.error(`  See who owns it: ${portHint(VITE_PORT)}`);
    console.error(
      `  Free the port (or close the other Vite), then run npm run dev again.`,
    );
    if (weStartedSidecar) shutdown();
    process.exit(1);
  }

  // Vite exit ends the session; kill sidecar only if we started it.
  const vite = start("dev:web", { fatal: true });
  vite.on("exit", () => {
    // fatal handler already shuts down children we track
  });
}

main().catch((err) => {
  console.error("[forknote] failed to start:", err instanceof Error ? err.message : err);
  shutdown();
  process.exit(1);
});
