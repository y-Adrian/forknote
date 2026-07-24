import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Same rules as src/lib/settings.ts normalizeBaseUrl */
function normalizeApiRoot(url: string): string {
  const base = url.replace(/\/$/, "");
  if (/\/v\d+$/i.test(base)) return base;
  return `${base}/v1`;
}

function originOf(apiRoot: string): string {
  return new URL(apiRoot).origin;
}

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

/** Dev proxy fallback when X-Forknote-Target is missing (should not happen in normal use). */
const PROXY_FALLBACK_ROOT = normalizeApiRoot("https://api.deepseek.com");

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/openai": {
        // Origin-only target. Versioned path (/v1, /v3, /v4, …) is applied
        // in configure — Vite rewrite(path) cannot read the target header.
        target: originOf(PROXY_FALLBACK_ROOT),
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            const header = targetHeader(req);
            const root = normalizeApiRoot(header || PROXY_FALLBACK_ROOT);
            const prefix = pathPrefixOf(root);
            const rest = (req.url || "").replace(/^\/openai/, "") || "/";
            proxyReq.path = `${prefix}${rest}`;
          });
        },
        router: (req) => {
          const header = targetHeader(req);
          return originOf(normalizeApiRoot(header || PROXY_FALLBACK_ROOT));
        },
      },
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
