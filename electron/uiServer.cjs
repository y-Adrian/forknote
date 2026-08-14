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
const { assertSafeApiTarget } = require("../shared/apiTargetPolicy.cjs");
const { PACKAGED_UI_CSP } = require("../shared/packagedUiCsp.cjs");

const SIDECAR_HOST = process.env.SIDECAR_HOST || "127.0.0.1";
const SIDECAR_PORT = Number(process.env.SIDECAR_PORT || 8787);
const SIDECAR_UNREACHABLE = {
  error: `Sidecar unreachable on ${SIDECAR_HOST}:${SIDECAR_PORT}. Run npm run sidecar (or npm run dev), then retry.`,
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
    "Content-Security-Policy": PACKAGED_UI_CSP,
  });
  res.end(data);
}

/** @param {import('node:http').ServerResponse} res */
function applyPackagedCsp(res) {
  res.setHeader("Content-Security-Policy", PACKAGED_UI_CSP);
}

/**
 * @param {string} targetOrigin
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} rewritePath
 * @param {{ kind?: 'sidecar' | 'openai', headers?: Record<string, string>, lookup?: Function }} [opts]
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
  Object.assign(headers, opts.headers || {});

  const lib = dest.protocol === "https:" ? https : http;
  const proxyReq = lib.request(
    {
      protocol: dest.protocol,
      hostname: dest.hostname,
      port: dest.port || (dest.protocol === "https:" ? 443 : 80),
      path: `${dest.pathname}${dest.search}`,
      method: req.method,
      headers,
      ...(opts.lookup ? { lookup: opts.lookup } : {}),
      ...(opts.lookup ? { agent: false } : {}),
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

/**
 * Validate the renderer-selected OpenAI root before copying or forwarding any
 * request headers. DNS answers are pinned into the outgoing socket lookup.
 * @param {string | undefined} header
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ apiTargetLookup?: Function }} opts
 */
async function forwardOpenAi(header, req, res, opts) {
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

  let approved;
  try {
    approved = await assertSafeApiTarget(header, {
      ...(opts.apiTargetLookup ? { lookup: opts.apiTargetLookup } : {}),
    });
  } catch (err) {
    sendJson(res, 403, {
      error: {
        message: `Desktop proxy blocked unsafe API target: ${
          err instanceof Error ? err.message : "validation failed"
        }`,
      },
    });
    return;
  }

  const approvedRoot = `${approved.url.origin}${approved.url.pathname.replace(/\/$/, "")}`;
  const prefix = approved.url.pathname.replace(/\/$/, "") || "";
  const rest = (req.url || "/").replace(/^\/openai/, "") || "/";
  proxyTo(
    approvedRoot.endsWith("/") ? approvedRoot : `${approvedRoot}/`,
    req,
    res,
    `${prefix}${rest}`,
    { kind: "openai", lookup: approved.lookup },
  );
}

function serveStatic(distDir, req, res) {
  const requestTarget = req.url || "/";
  const queryStart = requestTarget.indexOf("?");
  const rawPathname =
    queryStart === -1 ? requestTarget : requestTarget.slice(0, queryStart);
  let pathname;
  try {
    pathname = decodeURIComponent(rawPathname);
  } catch {
    applyPackagedCsp(res);
    res.writeHead(400).end("Bad Request");
    return;
  }
  if (pathname.includes("\0")) {
    applyPackagedCsp(res);
    res.writeHead(400).end("Bad Request");
    return;
  }

  // Treat both URL slash forms as separators so the containment check has the
  // same result on POSIX and Windows.
  pathname = pathname.replaceAll("\\", "/");
  if (pathname === "/" || pathname === "") pathname = "/index.html";

  const root = path.resolve(distDir);
  const filePath = path.resolve(root, `.${pathname}`);
  const relativePath = path.relative(root, filePath);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    applyPackagedCsp(res);
    res.writeHead(403).end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (pathname !== "/index.html") {
        // SPA fallback
        fs.readFile(path.join(root, "index.html"), (err2, html) => {
          if (err2) {
            applyPackagedCsp(res);
            res.writeHead(404).end("Not found");
            return;
          }
          applyPackagedCsp(res);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
        });
        return;
      }
      applyPackagedCsp(res);
      res.writeHead(404).end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    applyPackagedCsp(res);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
    });
    res.end(data);
  });
}

/**
 * @param {{ distDir: string, host?: string, port?: number, sidecarToken: string, apiTargetLookup?: Function }} opts
 * @returns {Promise<{ server: import('node:http').Server, origin: string }>}
 */
function startUiServer(opts) {
  const host = opts.host || "127.0.0.1";
  const preferredPort = opts.port ?? 8788;
  const distDir = opts.distDir;

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = req.url || "/";
      if (url.startsWith("/sidecar")) {
        const rest = url.replace(/^\/sidecar/, "") || "/";
        proxyTo(`http://${SIDECAR_HOST}:${SIDECAR_PORT}`, req, res, rest, {
          kind: "sidecar",
          headers: {
            "X-ForkNote-Sidecar-Token": opts.sidecarToken,
          },
        });
        return;
      }
      if (url.startsWith("/openai")) {
        const raw =
          req.headers["x-forknote-target"] ||
          req.headers["x-branch-chat-target"];
        const header = Array.isArray(raw) ? raw[0] : raw;
        void forwardOpenAi(header, req, res, opts).catch((err) => {
          if (res.headersSent) {
            res.destroy(err);
            return;
          }
          sendJson(res, 502, {
            error: { message: "Desktop proxy target validation failed" },
          });
        });
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

module.exports = {
  forwardOpenAi,
  resolveOpenAiRoot,
  startUiServer,
  PACKAGED_UI_CSP,
};
