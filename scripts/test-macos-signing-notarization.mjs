/**
 * Probe #385: macOS signing/notarization wiring exists, and secret-dependent
 * execution stays blocked (skip) until credentials are present.
 *
 * Usage: node scripts/test-macos-signing-notarization.mjs
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const results = [];
function ok(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function readText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const pkg = JSON.parse(readText("package.json"));
const wf = readText(".github/workflows/release-electron-mac.yml");
const readme = readText("README.md");
const hookSrc = readText("scripts/macos-notarize.cjs");

ok("package.json afterSign points at macos-notarize.cjs", pkg.build?.afterSign === "scripts/macos-notarize.cjs");
ok(
  "mac hardenedRuntime enabled for notarization readiness",
  pkg.build?.mac?.hardenedRuntime === true,
);
ok(
  "mac entitlements plist configured",
  pkg.build?.mac?.entitlements === "build/entitlements.mac.plist" &&
    fs.existsSync(path.join(ROOT, "build/entitlements.mac.plist")),
);
ok(
  "mac.identity is not hard-forced to null (allows CSC_LINK signing)",
  pkg.build?.mac?.identity !== null && pkg.build?.mac?.identity !== "null",
);

ok(
  "release workflow resolves signing mode from secrets",
  /Resolve signing mode/.test(wf) && /MACOS_CERTIFICATE/.test(wf) && /APPLE_TEAM_ID/.test(wf),
);
ok(
  "unsigned path keeps CSC_IDENTITY_AUTO_DISCOVERY=false",
  /mode=unsigned/.test(wf) && /CSC_IDENTITY_AUTO_DISCOVERY=false/.test(wf),
);
ok(
  "signed path exports CSC_LINK from MACOS_CERTIFICATE",
  /mode=signed/.test(wf) && /CSC_LINK="\$\{MACOS_CERTIFICATE\}"/.test(wf),
);
ok(
  "missing secrets emit notice (do not fail the job)",
  /::notice::/.test(wf) && /UNSIGNED/.test(wf),
);

ok(
  "README documents required macOS signing secrets",
  /MACOS_CERTIFICATE/.test(readme) &&
    /APPLE_APP_SPECIFIC_PASSWORD/.test(readme) &&
    /APPLE_TEAM_ID/.test(readme),
);
ok(
  "notarize hook skips without Apple env",
  /Skipping notarization/.test(hookSrc) && /APPLE_ID/.test(hookSrc),
);

// Runtime: afterSign module loads and skips with empty env
{
  const prev = {
    APPLE_ID: process.env.APPLE_ID,
    APPLE_APP_SPECIFIC_PASSWORD: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    APPLE_TEAM_ID: process.env.APPLE_TEAM_ID,
    CSC_LINK: process.env.CSC_LINK,
    CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY,
  };
  delete process.env.APPLE_ID;
  delete process.env.APPLE_APP_SPECIFIC_PASSWORD;
  delete process.env.APPLE_TEAM_ID;
  delete process.env.CSC_LINK;
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false";

  const hook = require("../scripts/macos-notarize.cjs");
  let threw = false;
  try {
    await hook.default({
      electronPlatformName: "darwin",
      appOutDir: "/tmp",
      packager: { appInfo: { productFilename: "ForkNote" } },
    });
  } catch (err) {
    threw = true;
    console.error(err);
  }

  ok("afterSign no-ops without credentials (no throw)", !threw);

  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

// Non-darwin platform also no-ops
{
  const hook = require("../scripts/macos-notarize.cjs");
  let threw = false;
  try {
    await hook.default({
      electronPlatformName: "linux",
      appOutDir: "/tmp",
      packager: { appInfo: { productFilename: "ForkNote" } },
    });
  } catch {
    threw = true;
  }
  ok("afterSign no-ops on non-darwin", !threw);
}

// Sanity: hook is loadable via electron-builder path string
ok(
  "notarize script is a CommonJS module with default export",
  typeof require("../scripts/macos-notarize.cjs").default === "function",
);

// Keep spawnSync available for future expansion without unused import lint noise
assert.equal(typeof spawnSync, "function");

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.error("Failed:\n" + failed.map((f) => `  - ${f.name}`).join("\n"));
  process.exit(1);
}
