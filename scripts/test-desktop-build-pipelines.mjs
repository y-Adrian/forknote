/**
 * Probe #383: Windows and Linux desktop build pipelines must be configured
 * (scripts, electron-builder targets, and GitHub Actions workflows), not mac-only.
 *
 * Usage: node scripts/test-desktop-build-pipelines.mjs
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

function mustExist(rel) {
  const abs = path.join(ROOT, rel);
  const exists = fs.existsSync(abs);
  ok(`exists: ${rel}`, exists);
  return exists;
}

const pkg = JSON.parse(readText("package.json"));
const scripts = pkg.scripts ?? {};
const build = pkg.build ?? {};

// --- Prove prior gap: mac scripts alone are insufficient ---
ok(
  "mac release script still present",
  typeof scripts["electron:release:mac"] === "string" &&
    scripts["electron:release:mac"].includes("electron-builder --mac"),
);

const requiredScripts = [
  "electron:build:win",
  "electron:release:win",
  "electron:build:linux",
  "electron:release:linux",
  "test:desktop-build-pipelines",
];
for (const name of requiredScripts) {
  ok(`npm script ${name}`, typeof scripts[name] === "string" && scripts[name].length > 0);
}

ok(
  "win release uses nsis + zip",
  typeof scripts["electron:release:win"] === "string" &&
    scripts["electron:release:win"].includes("--win") &&
    scripts["electron:release:win"].includes("nsis") &&
    scripts["electron:release:win"].includes("zip"),
);
ok(
  "linux release uses AppImage + deb",
  typeof scripts["electron:release:linux"] === "string" &&
    scripts["electron:release:linux"].includes("--linux") &&
    scripts["electron:release:linux"].includes("AppImage") &&
    scripts["electron:release:linux"].includes("deb"),
);

ok("electron-builder win.icon configured", build.win?.icon === "build/icon.png");
ok("electron-builder linux.icon configured", build.linux?.icon === "build/icon.png");
ok(
  "electron-builder win.target includes dir",
  Array.isArray(build.win?.target) && build.win.target.includes("dir"),
);
ok(
  "electron-builder linux.target includes dir",
  Array.isArray(build.linux?.target) && build.linux.target.includes("dir"),
);
ok("build/icon.png present for win/linux", fs.existsSync(path.join(ROOT, "build/icon.png")));

// --- Workflows ---
const winWf = ".github/workflows/release-electron-win.yml";
const linuxWf = ".github/workflows/release-electron-linux.yml";
const verifyWf = ".github/workflows/verify-desktop-builds.yml";
mustExist(winWf);
mustExist(linuxWf);
mustExist(verifyWf);

const winYml = readText(winWf);
const linuxYml = readText(linuxWf);
const verifyYml = readText(verifyWf);

ok("win workflow runs on windows-latest", /runs-on:\s*windows-latest/.test(winYml));
ok(
  "win workflow builds nsis zip",
  /electron-builder\s+--win\s+nsis\s+zip/.test(winYml),
);
ok(
  "win workflow does not publish updater latest.yml",
  !/latest\.yml/.test(winYml) && !/latest-win\.yml/.test(winYml),
);

ok("linux workflow runs on ubuntu-latest", /runs-on:\s*ubuntu-latest/.test(linuxYml));
ok(
  "linux workflow builds AppImage deb",
  /electron-builder\s+--linux\s+AppImage\s+deb/.test(linuxYml),
);
ok(
  "linux workflow does not publish updater latest.yml",
  !/latest\.yml/.test(linuxYml) && !/latest-linux\.yml/.test(linuxYml),
);

ok(
  "verify workflow has Windows dir package job",
  /Windows dir package/.test(verifyYml) &&
    /electron-builder\s+--win\s+--dir/.test(verifyYml),
);
ok(
  "verify workflow has Linux dir package job",
  /Linux dir package/.test(verifyYml) &&
    /electron-builder\s+--linux\s+--dir/.test(verifyYml),
);
ok(
  "verify workflow runs the config probe",
  /test:desktop-build-pipelines|test-desktop-build-pipelines\.mjs/.test(verifyYml),
);

// --- README documents win/linux ---
const readme = readText("README.md");
ok(
  "README documents Windows release workflow",
  /release-electron-win\.yml/.test(readme) && /Windows/.test(readme),
);
ok(
  "README documents Linux release workflow",
  /release-electron-linux\.yml/.test(readme) && /Linux/.test(readme),
);
ok(
  "README documents verify-desktop-builds workflow",
  /verify-desktop-builds\.yml/.test(readme),
);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.error(
    "Failed:\n" + failed.map((f) => `  - ${f.name}`).join("\n"),
  );
  process.exit(1);
}

// Keep assert import "used" for strict mode style consistency with other probes.
assert.ok(results.length > 0);
