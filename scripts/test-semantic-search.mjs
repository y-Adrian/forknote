/**
 * Probe semantic_search BM25 ranking.
 * Usage: node scripts/test-semantic-search.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import { bm25Search, chunkSource, tokenize } from "../shared/codeSearch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROJECT = path.join(ROOT, `.tmp-semantic-${process.pid}`);
const TEST_TOKEN = "c".repeat(64);

const results = [];
function ok(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

ok("tokenize camel", tokenize("sessionApi").includes("session") && tokenize("sessionApi").includes("api"));

const chunks = [
  ...chunkSource(
    "src/sessionApi.ts",
    "export function resolveSessionApi() { return { model: 'x' }; }\n",
  ),
  ...chunkSource(
    "src/unrelated.ts",
    "export function paintCanvas() { return 1; }\n",
  ),
];
const ranked = bm25Search(chunks, "session api override model", 5);
ok(
  "bm25 ranks sessionApi first",
  ranked[0]?.chunk.path === "src/sessionApi.ts",
  ranked.map((r) => r.chunk.path).join(","),
);

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
  const requestBody = pathname.startsWith("/fs/")
    ? { ...(body ?? {}), expectedRoot: PROJECT }
    : body;
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      "X-ForkNote-Sidecar-Token": TEST_TOKEN,
      ...(requestBody ? { "Content-Type": "application/json" } : {}),
    },
    body: requestBody ? JSON.stringify(requestBody) : undefined,
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

async function main() {
  await fs.rm(PROJECT, { recursive: true, force: true });
  await fs.mkdir(path.join(PROJECT, "src"), { recursive: true });
  await fs.writeFile(
    path.join(PROJECT, "src", "sessionApi.ts"),
    `export function resolveSessionApi(session, settings) {\n  return { model: settings.model };\n}\n`,
  );
  await fs.writeFile(
    path.join(PROJECT, "src", "paint.ts"),
    `export function paintCanvas() { return null; }\n`,
  );

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(ROOT, "sidecar/index.js")], {
    env: {
      ...process.env,
      SIDECAR_PORT: String(port),
      SIDECAR_HOST: "127.0.0.1",
      SIDECAR_AUTH_TOKEN: TEST_TOKEN,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitHealth(base);
    await json(base, "POST", "/project/open", { path: PROJECT });
    const r = await json(base, "POST", "/fs/semantic_search", {
      query: "session api model override",
      limit: 5,
    });
    const top = r.data?.hits?.[0];
    ok(
      "sidecar semantic_search",
      r.status === 200 && top?.path === "src/sessionApi.ts",
      JSON.stringify(r.data?.hits?.slice(0, 2)),
    );
  } finally {
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
