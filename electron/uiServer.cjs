/**
 * Loopback static + proxy server for the packaged app.
 * Serves Vite `dist/` and mirrors Vite's `/sidecar` + `/openai` proxies so the
 * web client keeps the same relative URLs (no CORS / file:// issues).
 */
const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const SIDECAR_HOST = process.env.SIDECAR_HOST || "127.0.0.1";
const SIDECAR_PORT = Number(process.env.SIDECAR_PORT || 8787);
const SIDECAR_UNREACHABLE = {
  error:
    "Sidecar unreachable on 127.0.0.1:8787. Run npm run sidecar (or npm run dev), then retry.",
};

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

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

/**
 * @param {string} targetOrigin
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} rewritePath
 * @param {{ kind?: 'sidecar' | 'openai' }} [opts]
 */
function proxyTo(targetOrigin, req, res, rewritePath, opts = {}) {
  let dest;
  try {
    dest = new URL(rewritePath, targetOrigin.endsWith("/") ? targetOrigin : `${targetOrigin}/`);
  } catch {
    sendJson(res, 502, { error: { message: "Invalid proxy target" } });
    return;
  }

  const headers = { ...req.headers, host: dest.host };
  delete headers["x-forknote-target"];
  delete headers["x-branch-chat-target"];
  for (const name of HOP_BY_HOP) delete headers[name];

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
    if (opts.kind === "sidecar") {
      sendJson(res, 502, SIDECAR_UNREACHABLE);
      return;
    }
    sendJson(res, 502, {
      error: {
        message: `Proxy upstream error (${dest.origin}): ${err.message}`,
      },
    });
  });

  req.pipe(proxyReq);
}

function resolveOpenAiRoot(header) {
  const trimmed = typeof header === "string" ? header.trim() : "";
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.origin}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

function serveStatic(distDir, req, res) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  const filePath = path.normalize(path.join(distDir, rel));
  if (!filePath.startsWith(path.normalize(distDir))) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (rel !== "/index.html") {
        // SPA fallback
        fs.readFile(path.join(distDir, "index.html"), (err2, html) => {
          if (err2) {
            res.writeHead(404).end("Not found");
            return;
          }
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
        });
        return;
      }
      res.writeHead(404).end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
    });
    res.end(data);
  });
}

/**
 * @param {{ distDir: string, host?: string, port?: number }} opts
 * @returns {Promise<{ server: import('node:http').Server, origin: string }>}
 */
function startUiServer(opts) {
  const host = opts.host || "127.0.0.1";
  const preferredPort = opts.port || 8788;
  const distDir = opts.distDir;

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = req.url || "/";
      if (url.startsWith("/sidecar")) {
        const rest = url.replace(/^\/sidecar/, "") || "/";
        proxyTo(`http://${SIDECAR_HOST}:${SIDECAR_PORT}`, req, res, rest, {
          kind: "sidecar",
        });
        return;
      }
      if (url.startsWith("/openai")) {
        const raw =
          req.headers["x-forknote-target"] ||
          req.headers["x-branch-chat-target"];
        const header = Array.isArray(raw) ? raw[0] : raw;
        const root = resolveOpenAiRoot(header);
        if (!root) {
          sendJson(res, 502, {
            error: {
              message:
                "Desktop proxy: missing or invalid X-Forknote-Target. Set Base URL in Settings → API, keep “Use proxy” on, Save, then retry.",
            },
          });
          return;
        }
        let prefix = "";
        try {
          prefix = new URL(root).pathname.replace(/\/$/, "") || "";
        } catch {
          /* ignore */
        }
        const rest = url.replace(/^\/openai/, "") || "/";
        proxyTo(root.endsWith("/") ? root : `${root}/`, req, res, `${prefix}${rest}`);
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405).end("Method Not Allowed");
        return;
      }
      serveStatic(distDir, req, res);
    });

    const tryListen = (port, attemptsLeft) => {
      const onError = (err) => {
        server.off("listening", onListening);
        if (err.code === "EADDRINUSE" && attemptsLeft > 0) {
          tryListen(port + 1, attemptsLeft - 1);
          return;
        }
        reject(err);
      };
      const onListening = () => {
        server.off("error", onError);
        const addr = server.address();
        const bound =
          typeof addr === "object" && addr ? addr.port : preferredPort;
        resolve({
          server,
          origin: `http://${host}:${bound}`,
        });
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    };

    tryListen(preferredPort, 20);
  });
}

module.exports = { startUiServer };
