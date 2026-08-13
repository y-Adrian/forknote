/**
 * Regression probes for bounded sidecar JSON bodies and disconnect cancellation.
 * Usage: node scripts/test-sidecar-request-limits.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { handleNetStatus } from "../sidecar/network.mjs";
import { spawnPlantumlPipe } from "../sidecar/plantuml.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_ROOT = path.join(
  os.tmpdir(),
  `forknote-sidecar-limits-${process.pid}`,
);
const PROJECT = path.join(TEST_ROOT, "project");
const BIN = path.join(TEST_ROOT, "bin");
const RG_STARTED = path.join(TEST_ROOT, "rg-started");
const RG_CANCELLED = path.join(TEST_ROOT, "rg-cancelled");
const PLANTUML_STARTED = path.join(TEST_ROOT, "plantuml-started");
const TOKEN = "b".repeat(64);
const DEFAULT_LIMIT = 256 * 1024;

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitFor(predicate, timeoutMs = 5_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}

async function requestJson(base, pathname, body) {
  const response = await fetch(`${base}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-ForkNote-Sidecar-Token": TOKEN,
    },
    body,
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

function exactJsonBody(bytes) {
  const empty = JSON.stringify({ path: PROJECT, padding: "" });
  assert.ok(empty.length < bytes);
  const body = JSON.stringify({
    path: PROJECT,
    padding: "x".repeat(bytes - Buffer.byteLength(empty)),
  });
  assert.equal(Buffer.byteLength(body), bytes);
  return body;
}

async function sendChunkedOversize(base) {
  const target = new URL("/project/open", base);
  return new Promise((resolve, reject) => {
    const request = http.request(
      target,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-ForkNote-Sidecar-Token": TOKEN,
        },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      },
    );
    request.on("error", (error) => {
      // A server may close a completed 413 connection while the client still
      // has buffered upload bytes. The response status remains authoritative.
      if (!request.res) reject(error);
    });
    request.write('{"path":');
    for (let sent = 0; sent <= DEFAULT_LIMIT; sent += 16 * 1024) {
      request.write(`"${"x".repeat(16 * 1024)}"`);
    }
    request.end("}");
  });
}

async function disconnectSearch(base) {
  const target = new URL("/fs/search", base);
  const body = JSON.stringify({
    expectedRoot: PROJECT,
    query: "needle",
  });
  const request = http.request(target, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "X-ForkNote-Sidecar-Token": TOKEN,
    },
  });
  request.on("error", () => {
    // Expected after destroy().
  });
  request.end(body);

  await waitFor(async () => {
    try {
      await fs.stat(RG_STARTED);
      return true;
    } catch {
      return false;
    }
  });
  const disconnectedAt = Date.now();
  request.destroy();
  await waitFor(async () => {
    try {
      await fs.stat(RG_CANCELLED);
      return true;
    } catch {
      return false;
    }
  }, 3_000);
  return Date.now() - disconnectedAt;
}

async function testPlantumlSpawnCancellation(fakePlantuml) {
  const controller = new AbortController();
  const started = Date.now();
  const render = spawnPlantumlPipe(
    fakePlantuml,
    [],
    "@startuml\nA -> B\n@enduml\n",
    { ...process.env, FORKNOTE_PLANTUML_STARTED: PLANTUML_STARTED },
    controller.signal,
  );
  await waitFor(async () => {
    try {
      await fs.stat(PLANTUML_STARTED);
      return true;
    } catch {
      return false;
    }
  });
  const pid = Number(await fs.readFile(PLANTUML_STARTED, "utf8"));
  controller.abort();
  await assert.rejects(render, (error) => error?.name === "AbortError");
  await waitFor(() => {
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  });
  assert.ok(Date.now() - started < 3_000);
}

async function testNetworkCancellation() {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  globalThis.fetch = ((_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () =>
          reject(
            Object.assign(new Error("aborted"), {
              name: "AbortError",
            }),
          ),
        { once: true },
      );
    }));
  try {
    const started = Date.now();
    const probe = handleNetStatus(controller.signal);
    controller.abort();
    await assert.rejects(probe, (error) => error?.name === "AbortError");
    assert.ok(Date.now() - started < 1_000);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function main() {
  await fs.rm(TEST_ROOT, { recursive: true, force: true });
  await fs.mkdir(PROJECT, { recursive: true });
  await fs.mkdir(BIN, { recursive: true });
  await fs.writeFile(path.join(PROJECT, "file.txt"), "needle\n", "utf8");
  const fakeRg = path.join(BIN, "rg");
  const fakePlantuml = path.join(BIN, "plantuml");
  await fs.writeFile(
    fakeRg,
    `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("quick")) {
  process.stdout.write("file.txt:1:quick\\n");
  process.exit(0);
}
fs.writeFileSync(process.env.FORKNOTE_RG_STARTED, String(process.pid));
process.on("SIGTERM", () => {
  fs.writeFileSync(process.env.FORKNOTE_RG_CANCELLED, "cancelled");
  process.exit(0);
});
setTimeout(() => {
  fs.writeFileSync(process.env.FORKNOTE_RG_CANCELLED, "completed");
  process.exit(0);
}, 30_000);
`,
    { mode: 0o755 },
  );
  await fs.writeFile(
    fakePlantuml,
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(process.env.FORKNOTE_PLANTUML_STARTED, String(process.pid));
process.stdin.resume();
setInterval(() => {}, 30_000);
`,
    { mode: 0o755 },
  );

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(ROOT, "sidecar/index.js")], {
    cwd: ROOT,
    env: {
      ...process.env,
      PATH: `${BIN}${path.delimiter}${process.env.PATH || ""}`,
      SIDECAR_PORT: String(port),
      SIDECAR_HOST: "127.0.0.1",
      SIDECAR_AUTH_TOKEN: TOKEN,
      FORKNOTE_RG_STARTED: RG_STARTED,
      FORKNOTE_RG_CANCELLED: RG_CANCELLED,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    logs += String(chunk);
  });

  try {
    await waitFor(async () => {
      try {
        const response = await fetch(`${base}/health`, {
          headers: { "X-ForkNote-Sidecar-Token": TOKEN },
        });
        return response.ok;
      } catch {
        return false;
      }
    });

    const boundary = await requestJson(
      base,
      "/project/open",
      exactJsonBody(DEFAULT_LIMIT),
    );
    assert.equal(boundary.status, 200);
    console.log("ok exact boundary-size JSON request");

    const oversized = await requestJson(
      base,
      "/project/open",
      exactJsonBody(DEFAULT_LIMIT + 1),
    );
    assert.equal(oversized.status, 413);
    assert.match(oversized.body?.error || "", /too large/i);
    console.log("ok declared oversized JSON returns early 413");

    assert.equal(await sendChunkedOversize(base), 413);
    console.log("ok chunked oversized JSON returns bounded 413");

    const largeWrite = JSON.stringify({
      expectedRoot: PROJECT,
      path: "large.txt",
      content: "w".repeat(300 * 1024),
    });
    const written = await requestJson(base, "/fs/write", largeWrite);
    assert.equal(written.status, 200);
    console.log("ok body-class limit preserves large fs/write");

    const normalSearch = await requestJson(
      base,
      "/fs/search",
      JSON.stringify({
        expectedRoot: PROJECT,
        query: "quick",
      }),
    );
    assert.equal(normalSearch.status, 200);
    assert.equal(normalSearch.body?.hits?.[0]?.text, "quick");
    console.log("ok normal request body completion does not abort work");

    const abortElapsed = await disconnectSearch(base);
    assert.ok(abortElapsed < 3_000, `search cancellation took ${abortElapsed}ms`);
    const marker = await fs.readFile(RG_CANCELLED, "utf8");
    assert.match(marker, /cancelled/);
    console.log(`ok disconnect cancels expensive search (${abortElapsed}ms)`);

    const health = await fetch(`${base}/health`, {
      headers: { "X-ForkNote-Sidecar-Token": TOKEN },
    });
    assert.equal(health.status, 200);
    assert.doesNotMatch(
      logs,
      /ERR_HTTP_HEADERS_SENT|write after end|uncaught/i,
    );
    console.log("ok no response write after close; sidecar remains healthy");

    await testPlantumlSpawnCancellation(fakePlantuml);
    console.log("ok PlantUML child terminates on cancellation");

    await testNetworkCancellation();
    console.log("ok network fetch aborts on cancellation");
  } finally {
    child.kill("SIGTERM");
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
