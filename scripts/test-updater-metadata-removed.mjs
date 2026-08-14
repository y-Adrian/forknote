/**
 * Probe #384: do not publish auto-update metadata without an in-app updater.
 *
 * Proves the prior gap (mac release uploaded latest-mac.yml while the app has
 * no updater integration), then asserts release workflows no longer publish
 * latest*.yml and the app still has no updater wiring.
 *
 * Usage: node scripts/test-updater-metadata-removed.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === "release" || ent.name === "dist") continue;
      walkFiles(abs, out);
    } else if (/\.(cjs|js|mjs|ts|tsx|json)$/.test(ent.name)) {
      out.push(abs);
    }
  }
  return out;
}

const macWf = readText(".github/workflows/release-electron-mac.yml");
const winWf = readText(".github/workflows/release-electron-win.yml");
const linuxWf = readText(".github/workflows/release-electron-linux.yml");
const readme = readText("README.md");
const pkg = JSON.parse(readText("package.json"));

// --- Prove prior failure mode conceptually: updater metadata without updater ---
ok(
  "no electron-updater dependency",
  !pkg.dependencies?.["electron-updater"] && !pkg.devDependencies?.["electron-updater"],
);

const appRoots = ["electron", "src", "shared", "sidecar"].map((d) => path.join(ROOT, d));
const appFiles = appRoots.flatMap((d) => walkFiles(d));
const updaterHits = [];
for (const file of appFiles) {
  const text = fs.readFileSync(file, "utf8");
  if (
    /autoUpdater|electron-updater|checkForUpdates|setFeedURL|update-electron-app/.test(
      text,
    )
  ) {
    updaterHits.push(path.relative(ROOT, file));
  }
}
ok(
  "app sources have no updater integration",
  updaterHits.length === 0,
  updaterHits.length ? updaterHits.join(", ") : "",
);

// --- Fix assertions: stop publishing misleading metadata ---
ok(
  "mac release does not upload latest-mac.yml",
  !/latest-mac\.yml/.test(macWf),
);
ok(
  "win release does not upload latest.yml / latest-win.yml",
  !/latest(-win)?\.yml/.test(winWf),
);
ok(
  "linux release does not upload latest.yml / latest-linux.yml",
  !/latest(-linux)?\.yml/.test(linuxWf),
);
ok(
  "README no longer advertises latest-mac.yml for updates",
  !/latest-mac\.yml/.test(readme),
);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.error("Failed:\n" + failed.map((f) => `  - ${f.name}`).join("\n"));
  process.exit(1);
}

assert.ok(results.length > 0);
