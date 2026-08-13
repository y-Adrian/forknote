/**
 * Probe packaged UI static-file containment and SPA fallback behavior.
 * Usage: node scripts/test-ui-server-containment.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { startUiServer } = require("../electron/uiServer.cjs");

function request(origin, requestPath) {
  const target = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: target.hostname,
        port: target.port,
        method: "GET",
        path: requestPath,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "forknote-ui-server-"));
const distDir = path.join(root, "dist");
const siblingDir = path.join(root, "dist-private");
const sentinel = "ISSUE-335-SIBLING-SECRET";
let server;

try {
  await fs.mkdir(path.join(distDir, "assets"), { recursive: true });
  await fs.mkdir(siblingDir);
  await fs.writeFile(path.join(distDir, "index.html"), "<h1>ForkNote test app</h1>");
  await fs.writeFile(path.join(distDir, "assets", "app.js"), "window.testApp = true;");
  await fs.writeFile(path.join(siblingDir, "secret.txt"), sentinel);

  const started = await startUiServer({
    distDir,
    host: "127.0.0.1",
    port: 0,
    sidecarToken: "containment-probe",
  });
  server = started.server;

  const index = await request(started.origin, "/");
  assert.equal(index.status, 200);
  assert.match(index.body, /ForkNote test app/);

  const asset = await request(started.origin, "/assets/app.js");
  assert.equal(asset.status, 200);
  assert.match(asset.body, /window\.testApp/);

  const spaRoute = await request(started.origin, "/notes/example?view=reader");
  assert.equal(spaRoute.status, 200);
  assert.match(spaRoute.body, /ForkNote test app/);

  const escapeAttempts = [
    "/../dist-private/secret.txt",
    "/%2e%2e/dist-private/secret.txt",
    "/..%2fdist-private/secret.txt",
    "/%2e%2e%5cdist-private%5csecret.txt",
  ];
  for (const requestPath of escapeAttempts) {
    const response = await request(started.origin, requestPath);
    assert.equal(response.status, 403, `${requestPath} must be forbidden`);
    assert.doesNotMatch(response.body, new RegExp(sentinel));
  }

  const doubleEncoded = await request(
    started.origin,
    "/%252e%252e%252fdist-private%252fsecret.txt",
  );
  assert.doesNotMatch(doubleEncoded.body, new RegExp(sentinel));

  const malformed = await request(started.origin, "/%E0%A4%A");
  assert.equal(malformed.status, 400);
  assert.doesNotMatch(malformed.body, new RegExp(sentinel));

  const afterMalformed = await request(started.origin, "/");
  assert.equal(afterMalformed.status, 200);
  assert.match(afterMalformed.body, /ForkNote test app/);

  console.log("test-ui-server-containment: ok");
} finally {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  await fs.rm(root, { recursive: true, force: true });
}
