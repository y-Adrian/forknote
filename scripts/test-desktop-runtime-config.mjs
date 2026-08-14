/**
 * Probe #380: preload sidecar URL comes from main, and packaged production
 * gates DevTools / reload developer surfaces.
 *
 * Usage: node scripts/test-desktop-runtime-config.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const {
  buildSidecarUrl,
  allowDeveloperSurfaces,
  buildDesktopAdditionalArguments,
  parseDesktopRuntimeConfig,
  isDevToolsShortcut,
  ARG_SIDECAR_URL,
  ARG_ALLOW_DEV_SURFACES,
} = require("../shared/desktopRuntimeConfig.cjs");

const results = [];
function ok(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

// --- unit: URL / policy helpers ---
assert.equal(buildSidecarUrl("127.0.0.1", 8787), "http://127.0.0.1:8787");
assert.equal(buildSidecarUrl("127.0.0.1", 19090), "http://127.0.0.1:19090");
ok("buildSidecarUrl honors host/port overrides", true);

ok(
  "packaged production gates developer surfaces",
  allowDeveloperSurfaces({ isDev: false, isPackaged: true }) === false,
);
ok(
  "ELECTRON_DEV allows developer surfaces even if packaged",
  allowDeveloperSurfaces({ isDev: true, isPackaged: true }) === true,
);
ok(
  "unpackaged allows developer surfaces",
  allowDeveloperSurfaces({ isDev: false, isPackaged: false }) === true,
);

const args = buildDesktopAdditionalArguments({
  sidecarUrl: "http://127.0.0.1:19090",
  allowDevSurfaces: false,
});
const parsed = parseDesktopRuntimeConfig(["electron", ...args]);
ok(
  "additionalArguments round-trip sidecar URL",
  parsed.sidecarUrl === "http://127.0.0.1:19090",
);
ok(
  "additionalArguments round-trip allowDevSurfaces=false",
  parsed.allowDevSurfaces === false,
);
ok(
  "default argv falls back to 8787 and allow=true",
  parseDesktopRuntimeConfig([]).sidecarUrl === "http://127.0.0.1:8787" &&
    parseDesktopRuntimeConfig([]).allowDevSurfaces === true,
);

ok(
  "F12 is a DevTools shortcut",
  isDevToolsShortcut({ type: "keyDown", key: "F12", control: false, meta: false, alt: false, shift: false }),
);
ok(
  "plain typing is not a DevTools shortcut",
  !isDevToolsShortcut({ type: "keyDown", key: "a", control: false, meta: false, alt: false, shift: false }),
);

// --- source: preload no longer hardcodes only 8787 ---
{
  const preload = fs.readFileSync(path.join(ROOT, "electron/preload.cjs"), "utf8");
  ok(
    "preload parses runtime config from argv",
    preload.includes("parseDesktopRuntimeConfig") &&
      preload.includes("runtime.sidecarUrl"),
  );
  ok(
    "preload does not hardcode absolute 8787 sidecar URL",
    !/sidecarUrl:\s*"http:\/\/127\.0\.0\.1:8787"/.test(preload),
  );
}

// --- source: main wires args + gates menu ---
{
  const main = fs.readFileSync(path.join(ROOT, "electron/main.cjs"), "utf8");
  ok(
    "main builds additionalArguments from SIDECAR_URL",
    main.includes("buildDesktopAdditionalArguments") &&
      main.includes("sidecarUrl: SIDECAR_URL"),
  );
  ok(
    "main gates View reload/DevTools via allowDevSurfaces",
    main.includes("toggleDevTools") &&
      main.includes("allowDevSurfaces") &&
      /viewExtras\s*=\s*allowDevSurfaces/.test(main),
  );
  ok(
    "main blocks DevTools shortcuts when gated",
    main.includes("isDevToolsShortcut") &&
      main.includes("before-input-event"),
  );
  ok(
    `shared arg names stay ${ARG_SIDECAR_URL} / ${ARG_ALLOW_DEV_SURFACES}`,
    main.includes("buildDesktopAdditionalArguments") &&
      fs
        .readFileSync(path.join(ROOT, "shared/desktopRuntimeConfig.cjs"), "utf8")
        .includes(ARG_SIDECAR_URL),
  );
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
