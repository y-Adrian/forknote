/**
 * Probe #364: semantic_search keeps a bounded per-project chunk index with
 * mtime/size invalidation and path-scoped refresh.
 *
 * Usage: node scripts/test-semantic-search-mtime-cache.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROJECT = path.join(ROOT, `.tmp-semantic-cache-${process.pid}`);
const TOKEN = "a".repeat(64);

const results = [];
function ok(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
    s.on("error", reject);
  });
}

async function json(base, method, pathname, body) {
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      "X-ForkNote-Sidecar-Token": TOKEN,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

function waitHealth(base, timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await json(base, "GET", "/health");
        if (r.status === 200 && r.data?.ok) {
          resolve(r);
          return;
        }
      } catch {
        /* retry */
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error("health timeout"));
        return;
      }
      setTimeout(tick, 80);
    };
    void tick();
  });
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  await fs.rm(PROJECT, { recursive: true, force: true });
  await fs.mkdir(path.join(PROJECT, "src", "nested"), { recursive: true });
  await fs.writeFile(
    path.join(PROJECT, "src", "sessionApi.ts"),
    `export function resolveSessionApi(session, settings) {\n  return { model: settings.model };\n}\n`,
  );
  await fs.writeFile(
    path.join(PROJECT, "src", "paint.ts"),
    `export function paintCanvas() { return null; }\n`,
  );
  await fs.writeFile(
    path.join(PROJECT, "src", "nested", "util.ts"),
    `export function nestHelper() { return 1; }\n`,
  );

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(ROOT, "sidecar/index.js")], {
    env: {
      ...process.env,
      SIDECAR_PORT: String(port),
      SIDECAR_HOST: "127.0.0.1",
      SIDECAR_AUTH_TOKEN: TOKEN,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitHealth(base);
    const opened = await json(base, "POST", "/project/open", { path: PROJECT });
    const expectedRoot = opened.data?.root ?? PROJECT;

    const first = await json(base, "POST", "/fs/semantic_search", {
      query: "session api model",
      limit: 5,
      expectedRoot,
    });
    const s1 = first.data?.indexStats;
    ok(
      "cold search indexes files",
      first.status === 200 &&
        first.data?.hits?.[0]?.path === "src/sessionApi.ts" &&
        s1?.refreshedFiles >= 2 &&
        s1?.reusedFiles === 0,
      JSON.stringify({ status: first.status, err: first.data?.error, s1 }),
    );

    const second = await json(base, "POST", "/fs/semantic_search", {
      query: "session api model",
      limit: 5,
      expectedRoot,
    });
    const s2 = second.data?.indexStats;
    ok(
      "warm search reuses mtime cache",
      second.status === 200 &&
        second.data?.hits?.[0]?.path === "src/sessionApi.ts" &&
        s2?.reusedFiles >= 2 &&
        s2?.refreshedFiles === 0,
      JSON.stringify(s2),
    );

    // Ensure mtime advances on some filesystems with coarse resolution.
    await sleep(1100);
    await fs.writeFile(
      path.join(PROJECT, "src", "sessionApi.ts"),
      `export function resolveSessionApi(session, settings) {\n  return { model: settings.model, updated: true };\n}\n`,
    );

    const third = await json(base, "POST", "/fs/semantic_search", {
      query: "session api model",
      limit: 5,
      expectedRoot,
    });
    const s3 = third.data?.indexStats;
    ok(
      "mtime change refreshes only that path",
      third.status === 200 &&
        s3?.refreshedFiles === 1 &&
        s3?.reusedFiles >= 1,
      JSON.stringify(s3),
    );

    const scoped = await json(base, "POST", "/fs/semantic_search", {
      query: "nest helper",
      path: "src/nested",
      limit: 5,
      expectedRoot,
    });
    const s4 = scoped.data?.indexStats;
    ok(
      "path-scoped search stays under prefix",
      scoped.status === 200 &&
        scoped.data?.hits?.[0]?.path === "src/nested/util.ts" &&
        s4?.filesSeen === 1 &&
        s4?.path === "src/nested",
      JSON.stringify({ hits: scoped.data?.hits?.slice(0, 2), s4 }),
    );

    await fs.rm(path.join(PROJECT, "src", "paint.ts"));
    const afterDelete = await json(base, "POST", "/fs/semantic_search", {
      query: "paint canvas",
      limit: 5,
      expectedRoot,
    });
    const s5 = afterDelete.data?.indexStats;
    ok(
      "deleted file pruned from index",
      afterDelete.status === 200 && s5?.removedFiles >= 1,
      JSON.stringify(s5),
    );
  } finally {
    child.kill("SIGTERM");
    await fs.rm(PROJECT, { recursive: true, force: true }).catch(() => {});
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
  console.log("test-semantic-search-mtime-cache: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
