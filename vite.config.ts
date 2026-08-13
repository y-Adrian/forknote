import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ProxyOptions } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { isValidApiBaseUrl, normalizeBaseUrl } from "./src/lib/settings";

const require = createRequire(import.meta.url);
const { loadOrCreateSidecarToken } = require("./shared/sidecarAuth.cjs") as {
  loadOrCreateSidecarToken: () => string;
};
const SIDECAR_PORT = Number(process.env.SIDECAR_PORT || 8787);
const SIDECAR_HOST = process.env.SIDECAR_HOST || "127.0.0.1";
const SIDECAR_AUTH_TOKEN = loadOrCreateSidecarToken();
const SIDECAR_UNREACHABLE = JSON.stringify({
  error:
    "Sidecar unreachable on 127.0.0.1:8787. Run npm run sidecar (or npm run dev), then retry Open project.",
});

function isPortOpen(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

/**
 * Ensure the local FS sidecar is up during `vite` / `npm run dev:web`.
 * If `npm run dev` already started sidecar, we reuse it (no second listener).
 */
function sidecarDevPlugin(): Plugin {
  let child: ChildProcess | null = null;
  let weStarted = false;

  return {
    name: "forknote-sidecar-dev",
    async configureServer(server) {
      if (await isPortOpen(SIDECAR_PORT, SIDECAR_HOST)) {
        console.log(
          `[forknote] sidecar already on http://${SIDECAR_HOST}:${SIDECAR_PORT}`,
        );
      } else {
        const root = path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
        );
        child = spawn(process.execPath, [path.join(root, "sidecar/index.js")], {
          cwd: root,
          stdio: "inherit",
          env: {
            ...process.env,
            SIDECAR_AUTH_TOKEN,
          },
        });
        weStarted = true;
        child.on("exit", (code, signal) => {
          if (!weStarted) return;
          // Another process may have won a short race for the port, or
          // sidecar exited 0 because one was already healthy (idempotent).
          void isPortOpen(SIDECAR_PORT, SIDECAR_HOST).then((up) => {
            if (up) {
              weStarted = false;
              child = null;
              return;
            }
            console.error(
              `[forknote] sidecar exited before becoming ready (code=${code ?? "null"} signal=${signal ?? "null"}).`,
            );
            console.error(
              `  Try: npm run sidecar   — or free port ${SIDECAR_PORT} and restart Vite.`,
            );
          });
        });
        for (let i = 0; i < 40; i++) {
          if (await isPortOpen(SIDECAR_PORT, SIDECAR_HOST)) break;
          await new Promise((r) => setTimeout(r, 50));
        }
        if (!(await isPortOpen(SIDECAR_PORT, SIDECAR_HOST))) {
          console.error(
            `[forknote] sidecar did not become ready on http://${SIDECAR_HOST}:${SIDECAR_PORT}`,
          );
          console.error(
            `  Run \`npm run sidecar\` in another terminal to see the listen error,`,
          );
          console.error(
            `  or: lsof -nP -iTCP:${SIDECAR_PORT} -sTCP:LISTEN`,
          );
        }
      }

      const cleanup = () => {
        if (!weStarted || !child || child.killed) return;
        weStarted = false;
        child.kill("SIGTERM");
      };
      server.httpServer?.once("close", cleanup);
    },
  };
}

function sidecarProxyError(
  _err: Error,
  _req: IncomingMessage,
  res: ServerResponse | import("node:net").Socket,
): void {
  if (!("writeHead" in res) || res.headersSent) {
    if ("destroy" in res) res.destroy();
    return;
  }
  res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
  res.end(SIDECAR_UNREACHABLE);
}

const sidecarProxy: ProxyOptions = {
  target: `http://${SIDECAR_HOST}:${SIDECAR_PORT}`,
  changeOrigin: true,
  rewrite: (p) => p.replace(/^\/sidecar/, "") || "/",
  configure: (proxy) => {
    proxy.on("error", sidecarProxyError);
    proxy.on("proxyReq", (proxyReq) => {
      proxyReq.setHeader(
        "X-ForkNote-Sidecar-Token",
        SIDECAR_AUTH_TOKEN,
      );
    });
  },
};

/** Path prefix on the API root, e.g. `/v1` or `/api/paas/v4`. */
function pathPrefixOf(apiRoot: string): string {
  const pathname = new URL(apiRoot).pathname.replace(/\/$/, "");
  return pathname || "";
}

function targetHeader(req: {
  headers: Record<string, string | string[] | undefined>;
}): string | undefined {
  const raw =
    req.headers["x-forknote-target"] ?? req.headers["x-branch-chat-target"];
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Resolve X-Forknote-Target to an absolute API root, or null when invalid. */
function resolveProxyRoot(header: string | undefined): string | null {
  const trimmed = header?.trim();
  if (!trimmed || !isValidApiBaseUrl(trimmed)) return null;
  const root = normalizeBaseUrl(trimmed);
  return root && isValidApiBaseUrl(root) ? root : null;
}

const PROXY_MISCONFIGURED = JSON.stringify({
  error: {
    message:
      "Dev proxy: missing or invalid X-Forknote-Target. In Settings → API set Base URL (e.g. https://api.deepseek.com or http://127.0.0.1:11434), keep “Use proxy” on, Save, then retry.",
  },
});

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

/**
 * Vite's built-in `server.proxy` uses raw `http-proxy` and does **not** honor
 * `router`. A fixed `target` (previously DeepSeek) meant every `/openai` call
 * hit that host while only the path was rewritten — local Ollama got DeepSeek's
 * `Authentication Fails (governor)` 401. This middleware picks the upstream
 * from `X-Forknote-Target` per request (HTTP local + HTTPS cloud).
 */
function openaiDevProxyPlugin(): Plugin {
  return {
    name: "forknote-openai-dev-proxy",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || "";
        if (!url.startsWith("/openai")) {
          next();
          return;
        }
        forwardOpenAi(req, res, url);
      });
    },
  };
}

function forwardOpenAi(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
): void {
  const root = resolveProxyRoot(targetHeader(req));
  if (!root) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(PROXY_MISCONFIGURED);
    return;
  }

  const prefix = pathPrefixOf(root);
  const rest = url.replace(/^\/openai/, "") || "/";
  let dest: URL;
  try {
    dest = new URL(`${prefix}${rest}`, root.endsWith("/") ? root : `${root}/`);
  } catch {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(PROXY_MISCONFIGURED);
    return;
  }

  const headers: Record<string, string | string[] | undefined> = {
    ...req.headers,
    host: dest.host,
  };
  delete headers["x-forknote-target"];
  delete headers["x-branch-chat-target"];
  for (const name of HOP_BY_HOP) {
    delete headers[name];
  }

  const lib = dest.protocol === "https:" ? https : http;
  const proxyReq = lib.request(
    {
      protocol: dest.protocol,
      hostname: dest.hostname,
      port: dest.port || (dest.protocol === "https:" ? 443 : 80),
      path: `${dest.pathname}${dest.search}`,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.statusCode = proxyRes.statusCode || 502;
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        if (value === undefined) continue;
        const lower = key.toLowerCase();
        // Let Node set length/encoding from the piped stream.
        if (
          lower === "transfer-encoding" ||
          lower === "content-length" ||
          lower === "connection"
        ) {
          continue;
        }
        res.setHeader(key, value);
      }
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (err) => {
    if (res.headersSent) {
      res.destroy(err);
      return;
    }
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: {
          message: `Dev proxy upstream error (${dest.origin}): ${err.message}`,
        },
      }),
    );
  });

  req.pipe(proxyReq);
}

export default defineConfig({
  // Relative asset paths so Electron can load `dist/` via file:// or a
  // loopback static server without absolute `/assets/...` breakage.
  base: "./",
  plugins: [react(), openaiDevProxyPlugin(), sidecarDevPlugin()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/sidecar": sidecarProxy,
    },
  },
});
