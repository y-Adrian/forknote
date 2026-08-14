/**
 * Probe #359: Electron startup failures must be classified with actionable
 * diagnostics (missing dist, Vite down, UI bind, loadURL) — not a blank window.
 *
 * Usage: node scripts/test-electron-startup-guard.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const {
  checkDistIndex,
  viteUnavailableMessage,
  uiBindFailureMessage,
  loadUrlFailureMessage,
  buildStartupFailure,
  startupError,
} = require("../shared/electronStartupGuard.cjs");

const results = [];
function ok(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(
    `[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`,
  );
}

// --- Prove prior gap: missing dist must fail closed ---
{
  const missing = path.join(
    os.tmpdir(),
    `forknote-no-dist-${process.pid}`,
    "index.html",
  );
  const checked = checkDistIndex(missing);
  ok(
    "missing dist/index.html fails closed",
    checked.ok === false && checked.kind === "missing_dist",
  );
  ok(
    "missing dist message mentions npm run build",
    /npm run build/i.test(checked.message || ""),
  );
}

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "forknote-dist-"));
  const indexPath = path.join(tmp, "index.html");
  fs.writeFileSync(indexPath, "<html></html>");
  ok("present dist/index.html passes", checkDistIndex(indexPath).ok === true);
  fs.rmSync(tmp, { recursive: true, force: true });
}

// --- Vite / bind / loadURL messaging ---
{
  const msg = viteUnavailableMessage("http://127.0.0.1:5173");
  ok(
    "vite unavailable is actionable",
    /VITE_DEV_SERVER_URL|npm run dev/i.test(msg),
  );
}

{
  const err = Object.assign(new Error("listen EADDRINUSE"), {
    code: "EADDRINUSE",
  });
  const msg = uiBindFailureMessage(err);
  ok(
    "UI bind EADDRINUSE mentions free port / 8788",
    /8788|already in use/i.test(msg),
  );
}

{
  const msg = loadUrlFailureMessage(
    "http://127.0.0.1:8788",
    new Error("ERR_CONNECTION_REFUSED"),
  );
  ok(
    "loadURL failure mentions URL and relaunch",
    /8788/.test(msg) && /relaunch|Quit/i.test(msg),
  );
}

{
  const failure = buildStartupFailure("missing_dist", {
    path: "/no/such/dist/index.html",
  });
  assert.equal(failure.code, "FORKNOTE_MISSING_DIST");
  const err = startupError(failure.code, failure.message);
  ok(
    "startupError preserves code",
    err.code === "FORKNOTE_MISSING_DIST" && /npm run build/i.test(err.message),
  );
}

{
  const failure = buildStartupFailure("vite_unavailable", {
    url: "http://127.0.0.1:5173",
  });
  ok(
    "vite failure code",
    failure.code === "FORKNOTE_VITE_UNAVAILABLE" &&
      /5173/.test(failure.message),
  );
}

// --- Source wiring ---
{
  const mainSrc = fs.readFileSync(
    path.join(ROOT, "electron", "main.cjs"),
    "utf8",
  );
  ok(
    "main uses electronStartupGuard helpers",
    /electronStartupGuard\.cjs/.test(mainSrc) &&
      /checkDistIndex/.test(mainSrc) &&
      /buildStartupFailure/.test(mainSrc) &&
      /reportStartupFailureAndQuit/.test(mainSrc),
  );
  ok(
    "main probes Vite before loadURL in dev",
    /viteDevServerReachable/.test(mainSrc) &&
      /FORKNOTE_VITE_UNAVAILABLE|vite_unavailable/.test(mainSrc),
  );
  ok(
    "main destroys window on loadURL failure",
    /win\.destroy\(\)/.test(mainSrc) && /load_url/.test(mainSrc),
  );
  ok(
    "main no longer only logs missing dist without throwing",
    !/missing \$\{path\.join\(dist, "index\.html"\)\} — run npm run build first/.test(
      mainSrc,
    ),
  );
  ok(
    "failure path cleans sidecar + UI server before quit",
    /stopSidecar\(\)/.test(mainSrc) &&
      /stopUiServer\(\)/.test(mainSrc) &&
      /reportStartupFailureAndQuit/.test(mainSrc),
  );
}

const failed = results.filter((r) => !r.pass);
if (failed.length) {
  console.error(`\n${failed.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nok ${results.length} electron startup guard checks`);
