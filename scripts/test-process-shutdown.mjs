/**
 * Probe #360: sidecar quit must escalate SIGTERM → wait → SIGKILL (process group
 * when safe), not fire-and-forget a single SIGTERM.
 *
 * Usage: node scripts/test-process-shutdown.mjs
 */
import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const {
  signalChild,
  terminateChildProcess,
  shouldDetachSpawnedSidecar,
} = require("../shared/processShutdown.cjs");

const results = [];
function ok(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(
    `[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`,
  );
}

async function spawnReadyStubborn() {
  const child = spawn(
    process.execPath,
    [
      "-e",
      "process.on('SIGTERM',()=>{}); process.stdout.write('ready\\n'); setInterval(()=>{},1000);",
    ],
    {
      stdio: ["ignore", "pipe", "ignore"],
      detached: shouldDetachSpawnedSidecar(),
    },
  );
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("stubborn ready timeout")), 2000);
    child.stdout.once("data", () => {
      clearTimeout(t);
      resolve(undefined);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(t);
      reject(new Error(`stubborn exited early code=${code} signal=${signal}`));
    });
  });
  return child;
}

// --- Stubborn child ignores SIGTERM; escalation must force-kill after grace ---
{
  const stubborn = await spawnReadyStubborn();
  const started = Date.now();
  const result = await terminateChildProcess(stubborn, 250);
  const elapsed = Date.now() - started;
  ok(
    "stubborn child is force-killed after grace",
    result === "force-killed",
    `result=${result} elapsed=${elapsed}ms`,
  );
  ok(
    "grace period is bounded (~250ms)",
    elapsed >= 200 && elapsed < 2000,
    `${elapsed}ms`,
  );

  try {
    if (stubborn.pid) process.kill(stubborn.pid, 0);
    signalChild(stubborn, "SIGKILL", { processGroup: true });
  } catch {
    /* already dead */
  }
}

{
  const quick = spawn(
    process.execPath,
    [
      "-e",
      "process.stdout.write('ready\\n'); setTimeout(()=>{}, 5000);",
    ],
    {
      stdio: ["ignore", "pipe", "ignore"],
      detached: shouldDetachSpawnedSidecar(),
    },
  );
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("quick ready timeout")), 2000);
    quick.stdout.once("data", () => {
      clearTimeout(t);
      resolve(undefined);
    });
  });
  const result = await terminateChildProcess(quick, 1500);
  ok(
    "cooperative child exits on SIGTERM without needing force-kill",
    result === "exited",
    `result=${result}`,
  );
}

{
  const dead = spawn(process.execPath, ["-e", "process.exit(0)"], {
    stdio: "ignore",
  });
  await new Promise((r) => dead.once("exit", r));
  ok(
    "already-dead child short-circuits",
    (await terminateChildProcess(dead, 500)) === "already-dead",
  );
}

ok(
  "POSIX detach policy for sidecar spawn",
  shouldDetachSpawnedSidecar() === (process.platform !== "win32"),
);

// --- Source wiring ---
{
  const mainSrc = fs.readFileSync(
    path.join(ROOT, "electron", "main.cjs"),
    "utf8",
  );
  ok(
    "main uses processShutdown helpers",
    /processShutdown\.cjs/.test(mainSrc) &&
      /terminateChildProcess/.test(mainSrc) &&
      /shouldDetachSpawnedSidecar/.test(mainSrc),
  );
  ok(
    "main spawns sidecar detached on POSIX",
    /detached:\s*shouldDetachSpawnedSidecar\(\)/.test(mainSrc),
  );
  ok(
    "before-quit awaits bounded stopSidecar (preventDefault)",
    /before-quit/.test(mainSrc) &&
      /event\.preventDefault\(\)/.test(mainSrc) &&
      /await stopSidecar\(\)/.test(mainSrc),
  );
  ok(
    "main no longer fire-and-forget single SIGTERM-only stop",
    !/sidecarChild\.kill\("SIGTERM"\)/.test(mainSrc),
  );
  ok(
    "shutdown helper does not treat child.killed as exited",
    !/child\.killed \|\| child\.exitCode/.test(
      fs.readFileSync(path.join(ROOT, "shared", "processShutdown.cjs"), "utf8"),
    ),
  );
}

const failed = results.filter((r) => !r.pass);
if (failed.length) {
  console.error(`\n${failed.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nok ${results.length} process shutdown checks`);
