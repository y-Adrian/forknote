/**
 * Probe symbol/AST sidecar tools: find_symbol, go_to_definition, find_references.
 * Usage: node scripts/test-symbol-ast.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import { extractSymbols } from "../shared/codeIntel.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROJECT = path.join(ROOT, `.tmp-symbol-ast-${process.pid}`);
const TEST_TOKEN = "d".repeat(64);

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
        reject(new Error(`sidecar health timeout at ${base}`));
        return;
      }
      setTimeout(tick, 80);
    };
    void tick();
  });
}

async function main() {
  const sample = `
export function alphaHelper() { return 1; }
export class BetaClass {}
export type GammaType = string;
const localOnly = 1;
alphaHelper();
`;
  const local = extractSymbols(sample, "alphaHelper");
  ok("extractSymbols finds function", local.some((s) => s.kind === "function" && s.exported));

  await fs.rm(PROJECT, { recursive: true, force: true });
  await fs.mkdir(path.join(PROJECT, "src"), { recursive: true });
  await fs.writeFile(
    path.join(PROJECT, "src", "a.ts"),
    `export function widgetFactory() {\n  return 42;\n}\n`,
  );
  await fs.writeFile(
    path.join(PROJECT, "src", "b.ts"),
    `import { widgetFactory } from "./a";\nexport const value = widgetFactory();\n`,
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

    const sym = await json(base, "POST", "/fs/find_symbol", {
      name: "widgetFactory",
    });
    ok(
      "find_symbol",
      sym.status === 200 &&
        sym.data?.symbols?.some(
          (s) => s.path === "src/a.ts" && s.name === "widgetFactory",
        ),
      `status=${sym.status} data=${JSON.stringify(sym.data)?.slice(0, 200)}`,
    );

    const def = await json(base, "POST", "/fs/go_to_definition", {
      name: "widgetFactory",
      path: "src/b.ts",
    });
    ok(
      "go_to_definition",
      def.status === 200 &&
        def.data?.found &&
        def.data?.definition?.path === "src/a.ts",
      JSON.stringify(def.data?.definition),
    );

    const refs = await json(base, "POST", "/fs/find_references", {
      name: "widgetFactory",
    });
    ok(
      "find_references",
      refs.status === 200 && (refs.data?.count ?? 0) >= 2,
      `count=${refs.data?.count}`,
    );
  } finally {
    child.kill("SIGTERM");
    await fs.rm(PROJECT, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
