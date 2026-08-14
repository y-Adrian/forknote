/**
 * Probe #378: project memory pack load preserves filesystem mtimes.
 *
 * Usage: npx tsx scripts/test-memory-pack-mtime.mts
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadContextMemoryPack,
  resolveMemoryPackUpdatedAt,
} from "../src/lib/contextMemory.ts";
import type { ApiSettings } from "../src/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROJECT = path.join(ROOT, `.tmp-memory-mtime-${process.pid}`);
const TOKEN = "a".repeat(64);

const results: Array<{ name: string; pass: boolean }> = [];
function ok(name: string, pass: boolean, detail = "") {
  results.push({ name, pass });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

assert.equal(resolveMemoryPackUpdatedAt([100, 50, undefined], 999), 100);
assert.equal(resolveMemoryPackUpdatedAt([null, undefined], 999), 999);
ok("resolveMemoryPackUpdatedAt picks max / falls back", true);

{
  const src = await fs.readFile(
    path.join(ROOT, "src/lib/contextMemory.ts"),
    "utf8",
  );
  const loadFn = src.slice(
    src.indexOf("export async function loadContextMemoryPack"),
    src.indexOf("export async function saveContextMemoryPack"),
  );
  ok(
    "load no longer stamps project packs with bare Date.now()",
    /updatedAt:\s*resolveMemoryPackUpdatedAt/.test(loadFn) &&
      !/updatedAt:\s*Date\.now\(\)/.test(loadFn),
  );
  const sidecarRead = await fs.readFile(
    path.join(ROOT, "sidecar/index.js"),
    "utf8",
  );
  const handleRead = sidecarRead.slice(
    sidecarRead.indexOf("async function handleRead"),
    sidecarRead.indexOf("async function handleWrite"),
  );
  ok("sidecar /fs/read returns mtimeMs", /mtimeMs:\s*stat\.mtimeMs/.test(handleRead));
}

async function freePort(): Promise<number> {
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

async function json(
  base: string,
  method: string,
  pathname: string,
  body?: unknown,
) {
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      "X-ForkNote-Sidecar-Token": TOKEN,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

function waitHealth(base: string, timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await json(base, "GET", "/health");
        if (r.status === 200 && (r.data as { ok?: boolean })?.ok) {
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

async function main() {
  const beforeNow = Date.now();
  // Prove the old failure mode would stamp "now" for old files.
  const staleMs = beforeNow - 7 * 24 * 60 * 60 * 1000;
  ok(
    "stale mtime is distinguishable from Date.now()",
    staleMs < beforeNow - 60_000,
  );

  await fs.rm(PROJECT, { recursive: true, force: true });
  const memDir = path.join(PROJECT, ".forknote", "memory");
  await fs.mkdir(memDir, { recursive: true });
  const summaryPath = path.join(memDir, "SUMMARY.md");
  const tasksPath = path.join(memDir, "TASKS.md");
  await fs.writeFile(summaryPath, "Background for an old project.\n");
  await fs.writeFile(tasksPath, "- [ ] finish audit\n");
  await fs.writeFile(path.join(memDir, "DECISIONS.md"), "");
  // Set SUMMARY older; TASKS newer — pack updatedAt should follow TASKS.
  await fs.utimes(summaryPath, new Date(staleMs), new Date(staleMs));
  const tasksMtime = staleMs + 3_600_000;
  await fs.utimes(tasksPath, new Date(tasksMtime), new Date(tasksMtime));

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

  const origFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set("X-ForkNote-Sidecar-Token", TOKEN);
    return origFetch(input, { ...init, headers });
  }) as typeof fetch;

  try {
    await waitHealth(base);
    const opened = await json(base, "POST", "/project/open", { path: PROJECT });
    const expectedRoot =
      (opened.data as { root?: string })?.root ?? PROJECT;

    const readRes = await json(
      base,
      "GET",
      `/fs/read?path=${encodeURIComponent(".forknote/memory/TASKS.md")}&expectedRoot=${encodeURIComponent(expectedRoot)}`,
    );
    const readData = readRes.data as { mtimeMs?: number; content?: string };
    ok(
      "/fs/read includes mtimeMs near utimes",
      readRes.status === 200 &&
        typeof readData.mtimeMs === "number" &&
        Math.abs(readData.mtimeMs - tasksMtime) < 2000,
      `mtimeMs=${readData.mtimeMs} expected≈${tasksMtime}`,
    );

    const settings = {
      baseUrl: "",
      apiKey: "",
      model: "",
      useProxy: true,
      memoryDir: ".forknote/memory",
    } satisfies ApiSettings;

    const beforeLoad = Date.now();
    const pack = await loadContextMemoryPack({
      settings,
      projectRoot: expectedRoot,
      sidecarUrl: base,
    });
    const afterLoad = Date.now();

    ok("load returns project pack", pack?.storage === "project");
    ok(
      "load updatedAt uses filesystem mtime (not Date.now)",
      typeof pack?.updatedAt === "number" &&
        Math.abs((pack?.updatedAt ?? 0) - tasksMtime) < 2000 &&
        (pack?.updatedAt ?? 0) < beforeLoad - 60_000 &&
        (pack?.updatedAt ?? 0) < afterLoad - 60_000,
      `updatedAt=${pack?.updatedAt} tasksMtime=${tasksMtime} now=${afterLoad}`,
    );
    ok(
      "SUMMARY content preserved",
      Boolean(pack?.summary.includes("old project")),
    );
  } finally {
    globalThis.fetch = origFetch;
    child.kill("SIGTERM");
    await fs.rm(PROJECT, { recursive: true, force: true }).catch(() => {});
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
