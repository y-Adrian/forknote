/**
 * Probe dependency_graph sidecar tool.
 * Usage: node scripts/test-dep-graph.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROJECT = path.join(ROOT, `.tmp-dep-graph-${process.pid}`);

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
    headers: body ? { "Content-Type": "application/json" } : undefined,
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
        reject(new Error(`sidecar health timeout`));
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
    path.join(PROJECT, "src", "a.ts"),
    `import fs from "node:fs";\nexport const a = 1;\n`,
  );
  await fs.writeFile(
    path.join(PROJECT, "src", "b.ts"),
    `import { a } from "./a";\nexport const b = a;\n`,
  );

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(ROOT, "sidecar/index.js")], {
    env: { ...process.env, SIDECAR_PORT: String(port), SIDECAR_HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitHealth(base);
    await json(base, "POST", "/project/open", { path: PROJECT });

    const all = await json(base, "POST", "/fs/dependency_graph", { path: "." });
    ok(
      "graph edges",
      all.status === 200 &&
        all.data?.edgeCount >= 2 &&
        (all.data?.edges ?? []).some(
          (e) => e.from === "src/b.ts" && e.resolved === "src/a.ts",
        ),
      `edges=${all.data?.edgeCount}`,
    );

    const focus = await json(base, "POST", "/fs/dependency_graph", {
      focus: "src/a.ts",
    });
    ok(
      "focus importers",
      focus.status === 200 &&
        focus.data?.focus?.importerCount >= 1 &&
        focus.data?.focus?.imports?.some((e) => e.external),
      JSON.stringify(focus.data?.focus),
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
