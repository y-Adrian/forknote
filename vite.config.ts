import http from "node:http";
import https from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { isValidApiBaseUrl, normalizeBaseUrl } from "./src/lib/settings";

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
  plugins: [react(), openaiDevProxyPlugin()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/sidecar": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/sidecar/, "") || "/",
      },
      // Optional mem0 Platform proxy (avoids browser CORS in `npm run dev`)
      "/mem0": {
        target: "https://api.mem0.ai",
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/mem0/, "") || "/",
      },
    },
  },
});
