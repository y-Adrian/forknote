/**
 * Probe #358: Electron sidecar startup must require `{ ok: true }` health
 * payload and refuse to spawn into an occupied non-ForkNote port.
 *
 * Usage: node scripts/test-sidecar-startup-health.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const {
  isForkNoteSidecarHealthPayload,
  sidecarPortConflictLines,
  decideSidecarStartupAction,
} = require("../shared/sidecarStartupHealth.cjs");

const results = [];
function ok(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(
    `[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`,
  );
}

// --- Prove prior failure mode: bare HTTP 200 is not enough ---
ok(
  "HTTP 200 with empty body is not healthy (regression vs status-only check)",
  isForkNoteSidecarHealthPayload(200, "") === false,
);
ok(
  "HTTP 200 with unrelated JSON is not healthy",
  isForkNoteSidecarHealthPayload(200, JSON.stringify({ status: "ok" })) ===
    false,
);
ok(
  "HTTP 200 with ok:false is not healthy",
  isForkNoteSidecarHealthPayload(200, JSON.stringify({ ok: false })) === false,
);
ok(
  "non-200 with ok:true is not healthy",
  isForkNoteSidecarHealthPayload(503, JSON.stringify({ ok: true })) === false,
);
ok(
  "HTTP 200 with ok:true is healthy",
  isForkNoteSidecarHealthPayload(200, JSON.stringify({ ok: true, root: null })) ===
    true,
);

// --- Port-conflict decision ---
assert.equal(
  decideSidecarStartupAction({ healthy: true, portOpen: true }),
  "reuse",
);
assert.equal(
  decideSidecarStartupAction({ healthy: false, portOpen: false }),
  "spawn",
);
assert.equal(
  decideSidecarStartupAction({ healthy: false, portOpen: true }),
  "conflict",
);
ok("reuse/spawn/conflict decision matrix", true);

const lines = sidecarPortConflictLines("127.0.0.1", 18787);
ok(
  "conflict message is actionable",
  lines.some((l) => /SIDECAR_PORT|lsof|netstat/i.test(l)) &&
    lines.some((l) => /not a healthy ForkNote sidecar/i.test(l)),
  lines.join(" | "),
);

// --- Live: fake 200-without-ok must not count as healthy ---
{
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ service: "imposter" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const body = await new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: "/health" }, (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          raw += c;
        });
        res.on("end", () => resolve({ status: res.statusCode, raw }));
      })
      .on("error", reject);
  });
  ok(
    "live imposter /health (200, no ok) rejected",
    isForkNoteSidecarHealthPayload(body.status, body.raw) === false,
  );
  await new Promise((resolve) => server.close(resolve));
}

// --- Source wiring in electron/main.cjs ---
{
  const mainSrc = fs.readFileSync(
    path.join(ROOT, "electron", "main.cjs"),
    "utf8",
  );
  ok(
    "main requires shared sidecarStartupHealth helpers",
    /sidecarStartupHealth\.cjs/.test(mainSrc) &&
      /isForkNoteSidecarHealthPayload/.test(mainSrc) &&
      /decideSidecarStartupAction/.test(mainSrc) &&
      /failSidecarPortConflict|sidecarPortConflictLines/.test(mainSrc),
  );
  ok(
    "main no longer treats bare statusCode===200 as healthy",
    !/resolve\(res\.statusCode === 200\)/.test(mainSrc),
  );
  ok(
    "main refuses spawn on port conflict (calls fail helper)",
    /failSidecarPortConflict\(/.test(mainSrc),
  );
}

const failed = results.filter((r) => !r.pass);
if (failed.length) {
  console.error(`\n${failed.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nok ${results.length} sidecar startup health checks`);
