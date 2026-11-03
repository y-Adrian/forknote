/**
 * Terminal commands that climb out of the project with relative `..` paths
 * (or a bare `cd`, which goes home) must need outside-project approval on both
 * the client gate and the sidecar /fs/run check.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  commandLeavesProject,
  isReadOnlyTerminalCommand,
  terminalCallNeedsOutsideApproval,
} from "../src/lib/agentTools.ts";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = path.join(os.tmpdir(), `forknote-parent-escape-${process.pid}`, "proj");
const TOKEN = "e".repeat(64);

const leaving = [
  "ls ..",
  "ls ../",
  "ls -la ../..",
  "cat ../secret.txt",
  "cd .. && ls",
  "cd ../.. ; ls",
  "cd",
  "cd && ls",
  "ls src/../..",
  "find .. -name '*.ts'",
  "cat \"../secret.txt\"",
  "grep -r foo --include=x ../other",
  "head -n1 <../secret.txt",
  "ls ..\\other",
];
const staying = [
  "ls",
  "ls -la src",
  "cat src/../README.md",
  "ls ./src/..",
  "npm run build",
  "git log --oneline -3",
  "echo a..b",
  "git diff main..HEAD",
  "cd src && ls",
];

{
  const root = "/Users/me/work/proj";
  for (const cmd of leaving) {
    assert.equal(commandLeavesProject(cmd, root), true, `client should flag: ${cmd}`);
    assert.equal(isReadOnlyTerminalCommand(cmd, root), false, `not read-only inside: ${cmd}`);
  }
  for (const cmd of staying) {
    assert.equal(commandLeavesProject(cmd, root), false, `client should not flag: ${cmd}`);
  }
  // Relative paths resolve against the call's cwd.
  assert.equal(
    terminalCallNeedsOutsideApproval({ tool: "run_terminal", command: "ls ..", cwd: "src" }, root),
    false,
  );
  assert.equal(
    terminalCallNeedsOutsideApproval({ tool: "run_terminal", command: "ls ../..", cwd: "src" }, root),
    true,
  );
  assert.equal(
    terminalCallNeedsOutsideApproval({ tool: "run_terminal", command: "ls", cwd: ".." }, root),
    true,
  );
  console.log("[PASS] client flags relative parent-dir escapes");
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      s.close(() => resolve(typeof addr === "object" && addr ? addr.port : 0));
    });
    s.on("error", reject);
  });
}

async function call(base: string, pathname: string, body: Record<string, unknown> = {}) {
  const res = await fetch(`${base}${pathname}`, {
    method: "POST",
    headers: { "X-ForkNote-Sidecar-Token": TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(pathname.startsWith("/fs/") ? { expectedRoot: PROJECT, ...body } : body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

await fs.mkdir(path.join(PROJECT, "src"), { recursive: true });
await fs.writeFile(path.join(PROJECT, "..", "secret.txt"), "SECRET");
await fs.writeFile(path.join(PROJECT, "README.md"), "readme");

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [path.join(ROOT, "sidecar/index.js")], {
  cwd: ROOT,
  env: { ...process.env, SIDECAR_PORT: String(port), SIDECAR_HOST: "127.0.0.1", SIDECAR_AUTH_TOKEN: TOKEN },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout?.on("data", (c) => { logs += String(c); });
child.stderr?.on("data", (c) => { logs += String(c); });

try {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(`${base}/health`, { headers: { "X-ForkNote-Sidecar-Token": TOKEN } });
      if (r.ok) break;
    } catch { /* retry */ }
    if (i > 100) throw new Error("sidecar did not start");
    await new Promise((r) => setTimeout(r, 80));
  }
  assert.equal((await call(base, "/project/open", { path: PROJECT })).status, 200);

  for (const command of ["cat ../secret.txt", "cd .. && ls", "ls ../..", "cd && pwd"]) {
    const r = await call(base, "/fs/run", { command });
    assert.equal(r.status, 403, `${command} -> ${r.status} ${JSON.stringify(r.data)}`);
    assert.ok(!JSON.stringify(r.data).includes("SECRET"), command);
  }
  const inside = await call(base, "/fs/run", { command: "cat src/../README.md" });
  assert.equal(inside.status, 200, JSON.stringify(inside.data));
  const fromSub = await call(base, "/fs/run", { command: "cat ../README.md", cwd: "src" });
  assert.equal(fromSub.status, 200, JSON.stringify(fromSub.data));
  const approved = await call(base, "/fs/run", { command: "cat ../secret.txt", allowOutsideProject: true });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  console.log("[PASS] sidecar refuses unapproved parent-dir escapes");
} catch (e) {
  console.error("sidecar logs:\n", logs);
  throw e;
} finally {
  child.kill("SIGTERM");
  await fs.rm(path.dirname(PROJECT), { recursive: true, force: true });
}
console.log("All terminal parent-escape probes passed.");
