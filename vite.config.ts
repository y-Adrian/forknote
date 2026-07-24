import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { isValidApiBaseUrl, normalizeBaseUrl } from "./src/lib/settings";

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
      "Dev proxy: missing or invalid X-Forknote-Target. In Settings → API set Base URL (e.g. https://api.deepseek.com), keep “Use proxy” on, Save, then retry.",
  },
});

/** Default proxy origin; per-request router overrides from X-Forknote-Target. */
const PROXY_DEFAULT_ORIGIN = "https://api.deepseek.com";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/openai": {
        // Must not point at the dev server — self-target breaks http-proxy routing (404).
        target: PROXY_DEFAULT_ORIGIN,
        changeOrigin: true,
        secure: true,
        bypass(req, res) {
          const root = resolveProxyRoot(targetHeader(req));
          if (root) return undefined;
          res.statusCode = 502;
          res.setHeader("Content-Type", "application/json");
          res.end(PROXY_MISCONFIGURED);
          return false;
        },
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            const root = resolveProxyRoot(targetHeader(req));
            if (!root) return;
            const prefix = pathPrefixOf(root);
            const rest = (req.url || "").replace(/^\/openai/, "") || "/";
            proxyReq.path = `${prefix}${rest}`;
          });
        },
        router: (req) => {
          const root = resolveProxyRoot(targetHeader(req));
          return root ? originOf(root) : PROXY_DEFAULT_ORIGIN;
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
