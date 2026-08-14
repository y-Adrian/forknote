/**
 * Probe #379: packaged desktop builds must ship sidecar Office deps (docx / exceljs).
 *
 * Proves the failure mode of the app files whitelist alone (no node_modules),
 * then installs only the declared Office production deps into a staged app and
 * verifies the sidecar can dynamically import them (as Electron does).
 *
 * Usage: node scripts/test-packaged-office-deps.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  PACKAGED_OFFICE_DEPS,
  packagedOfficeFileGlobs,
} from "../shared/packagedOfficeDeps.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
// Outside the repo so Node module resolution cannot walk into project node_modules.
const STAGE = path.join(os.tmpdir(), `forknote-packaged-office-${process.pid}`);

const results = [];
function ok(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  await fs.cp(src, dest, { recursive: true });
}

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => {
      out += c;
    });
    child.stderr.on("data", (c) => {
      err += c;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ out, err });
      else reject(new Error(`${cmd} ${args.join(" ")} failed (${code}): ${err || out}`));
    });
  });
}

async function stageAppShell() {
  const app = path.join(STAGE, "app");
  await fs.rm(app, { recursive: true, force: true });
  await fs.mkdir(app, { recursive: true });
  await copyDir(path.join(ROOT, "electron"), path.join(app, "electron"));
  await copyDir(path.join(ROOT, "sidecar"), path.join(app, "sidecar"));
  await copyDir(path.join(ROOT, "shared"), path.join(app, "shared"));
  return app;
}

function importFromSidecar(appRoot, specifier) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        `import(${JSON.stringify(specifier)}).then(() => {
           console.log("OK");
           process.exit(0);
         }).catch((e) => {
           console.error(String(e && e.message ? e.message : e));
           process.exit(1);
         })`,
      ],
      {
        cwd: path.join(appRoot, "sidecar"),
        env: {
          ...process.env,
          NODE_PATH: path.join(appRoot, "node_modules"),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => {
      out += c;
    });
    child.stderr.on("data", (c) => {
      err += c;
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0 && /OK/.test(out), out, err, code });
    });
  });
}

async function main() {
  const pkg = JSON.parse(
    await fs.readFile(path.join(ROOT, "package.json"), "utf8"),
  );
  const files = pkg.build?.files ?? [];
  const deps = pkg.dependencies ?? {};
  const expectedGlobs = packagedOfficeFileGlobs();

  for (const name of PACKAGED_OFFICE_DEPS) {
    ok(
      `${name} is a production dependency`,
      Object.prototype.hasOwnProperty.call(deps, name),
    );
  }
  for (const glob of expectedGlobs) {
    ok(
      `build.files includes ${glob}`,
      files.includes(glob),
      `files=${JSON.stringify(files)}`,
    );
  }

  const sharedUrl = pathToFileURL(
    path.join(ROOT, "shared/packagedOfficeDeps.mjs"),
  ).href;
  const shared = await import(sharedUrl);
  ok(
    "shared list matches package probe expectation",
    JSON.stringify(shared.PACKAGED_OFFICE_DEPS) ===
      JSON.stringify(PACKAGED_OFFICE_DEPS),
  );

  await fs.rm(STAGE, { recursive: true, force: true });

  // Failure mode: whitelist-only packaged content has no Office node_modules.
  const without = await stageAppShell();
  await fs.writeFile(
    path.join(without, "package.json"),
    JSON.stringify({ name: "forknote-whitelist-only", private: true, type: "module" }, null, 2),
  );
  const failDocx = await importFromSidecar(without, "docx");
  const failExcel = await importFromSidecar(without, "exceljs");
  ok(
    "whitelist-only staged app cannot import docx (failure mode)",
    !failDocx.ok,
    failDocx.err.slice(0, 120),
  );
  ok(
    "whitelist-only staged app cannot import exceljs (failure mode)",
    !failExcel.ok,
    failExcel.err.slice(0, 120),
  );

  // Success mode: install only declared Office deps into a staged packaged app.
  const withOffice = await stageAppShell();
  const officeDeps = Object.fromEntries(
    PACKAGED_OFFICE_DEPS.map((name) => [name, deps[name]]),
  );
  await fs.writeFile(
    path.join(withOffice, "package.json"),
    JSON.stringify(
      {
        name: "forknote-office-smoke",
        private: true,
        type: "module",
        dependencies: officeDeps,
      },
      null,
      2,
    ),
  );
  await run("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: withOffice,
    env: { ...process.env, npm_config_update_notifier: "false" },
  });

  for (const name of PACKAGED_OFFICE_DEPS) {
    ok(
      `staged packaged app includes node_modules/${name}`,
      await pathExists(path.join(withOffice, "node_modules", name, "package.json")),
    );
  }
  const okDocx = await importFromSidecar(withOffice, "docx");
  const okExcel = await importFromSidecar(withOffice, "exceljs");
  ok("staged packaged sidecar can import docx", okDocx.ok, okDocx.err.slice(0, 160));
  ok(
    "staged packaged sidecar can import exceljs",
    okExcel.ok,
    okExcel.err.slice(0, 160),
  );

  const releaseApp = path.join(
    ROOT,
    "release/mac-arm64/ForkNote.app/Contents/Resources/app",
  );
  if (await pathExists(releaseApp)) {
    for (const name of PACKAGED_OFFICE_DEPS) {
      ok(
        `release app includes node_modules/${name}`,
        await pathExists(path.join(releaseApp, "node_modules", name, "package.json")),
      );
    }
    const relDocx = await importFromSidecar(releaseApp, "docx");
    const relExcel = await importFromSidecar(releaseApp, "exceljs");
    ok("release sidecar can import docx", relDocx.ok, relDocx.err.slice(0, 120));
    ok(
      "release sidecar can import exceljs",
      relExcel.ok,
      relExcel.err.slice(0, 120),
    );
  } else {
    ok("release app optional check skipped (no local build)", true);
  }

  await fs.rm(STAGE, { recursive: true, force: true }).catch(() => {});

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
