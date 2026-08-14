/**
 * Probe #382: packaged UI server sends a CSP that blocks unexpected scripts/frames
 * while allowing self assets, workers/blobs, and HTTPS connect for diagrams.
 *
 * Usage: node scripts/test-packaged-ui-csp.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const { startUiServer, PACKAGED_UI_CSP } = require("../electron/uiServer.cjs");
const { PACKAGED_UI_CSP: SHARED_CSP } = require("../shared/packagedUiCsp.cjs");

const results = [];
function ok(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

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
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

ok("shared CSP exported", typeof SHARED_CSP === "string" && SHARED_CSP.length > 20);
ok("uiServer re-exports same CSP", PACKAGED_UI_CSP === SHARED_CSP);
ok("CSP blocks frames/objects", /frame-src 'none'/.test(SHARED_CSP) && /object-src 'none'/.test(SHARED_CSP));
ok("CSP allows self scripts only", /script-src 'self'/.test(SHARED_CSP) && !/script-src[^;]*'unsafe-inline'/.test(SHARED_CSP));
ok("CSP allows blob workers + https connect", /worker-src 'self' blob:/.test(SHARED_CSP) && /connect-src[^;]*https:/.test(SHARED_CSP));

{
  const indexHtml = await fs.readFile(path.join(ROOT, "index.html"), "utf8");
  ok(
    "index.html uses external boot.js (no inline boot script)",
    /src="\/boot\.js"/.test(indexHtml) && !/<script>\s*\(function \(\)/.test(indexHtml),
  );
  ok(
    "public/boot.js exists",
    await fs
      .access(path.join(ROOT, "public/boot.js"))
      .then(() => true)
      .catch(() => false),
  );
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "forknote-ui-csp-"));
const distDir = path.join(root, "dist");
let server;

try {
  await fs.mkdir(path.join(distDir, "assets"), { recursive: true });
  await fs.writeFile(
    path.join(distDir, "index.html"),
    '<!doctype html><script src="/boot.js"></script><h1>csp</h1>',
  );
  await fs.writeFile(path.join(distDir, "boot.js"), "window.__boot=1;");
  await fs.writeFile(path.join(distDir, "assets", "app.js"), "window.x=1;");

  const started = await startUiServer({
    distDir,
    host: "127.0.0.1",
    port: 0,
    sidecarToken: "csp-probe",
  });
  server = started.server;

  const index = await request(started.origin, "/");
  const csp = index.headers["content-security-policy"];
  ok("HTML response includes CSP header", typeof csp === "string" && csp.length > 0, String(csp));
  ok("HTML CSP matches packaged policy", csp === PACKAGED_UI_CSP);
  ok("HTML CSP denies frames", /frame-src 'none'/.test(String(csp)));

  const asset = await request(started.origin, "/assets/app.js");
  ok(
    "static asset also carries CSP",
    asset.headers["content-security-policy"] === PACKAGED_UI_CSP,
  );

  const spa = await request(started.origin, "/notes/demo");
  ok(
    "SPA fallback carries CSP",
    spa.status === 200 && spa.headers["content-security-policy"] === PACKAGED_UI_CSP,
  );

  // Prove prior failure mode: without this change responses had no CSP.
  ok(
    "policy string is non-empty (failure mode was missing header)",
    Boolean(PACKAGED_UI_CSP && PACKAGED_UI_CSP.includes("default-src")),
  );
} finally {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  await fs.rm(root, { recursive: true, force: true });
}

// Containment still green.
{
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(process.execPath, ["scripts/test-ui-server-containment.mjs"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  ok(
    "ui-server containment probe still passes",
    r.status === 0,
    (r.stderr || r.stdout || "").slice(0, 200),
  );
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
assert.ok(failed.length === 0);
