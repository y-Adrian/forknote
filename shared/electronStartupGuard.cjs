/**
 * Electron UI startup failure classification and messaging.
 * Keeps diagnostics testable without launching Electron.
 */

/** @typedef {"missing_dist"|"vite_unavailable"|"ui_bind"|"load_url"|"unknown"} StartupFailureKind */

/**
 * @param {string} distIndexPath
 * @returns {{ ok: true } | { ok: false, kind: "missing_dist", message: string }}
 */
function checkDistIndex(distIndexPath) {
  const fs = require("node:fs");
  if (fs.existsSync(distIndexPath)) return { ok: true };
  return {
    ok: false,
    kind: "missing_dist",
    message: [
      `Missing packaged UI at ${distIndexPath}.`,
      "Run `npm run build` (or install a complete desktop build), then launch ForkNote again.",
    ].join("\n"),
  };
}

/**
 * @param {string} viteUrl
 * @returns {string}
 */
function viteUnavailableMessage(viteUrl) {
  return [
    `Dev UI server is not reachable at ${viteUrl}.`,
    "Start Vite first (`npm run dev` / `npm run dev:web`), or set VITE_DEV_SERVER_URL to a running origin, then retry.",
  ].join("\n");
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function uiBindFailureMessage(err) {
  const detail = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === "object" && "code" in err
      ? String(/** @type {{ code?: string }} */ (err).code || "")
      : "";
  if (code === "EADDRINUSE") {
    return [
      "Could not bind the packaged UI server (address already in use).",
      "Free the loopback UI port range starting at 8788, then relaunch ForkNote.",
      detail ? `Detail: ${detail}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    "Could not start the packaged UI server.",
    detail ? `Detail: ${detail}` : "Unknown bind/listen error.",
  ].join("\n");
}

/**
 * @param {string} loadUrl
 * @param {unknown} err
 * @returns {string}
 */
function loadUrlFailureMessage(loadUrl, err) {
  const detail = err instanceof Error ? err.message : String(err);
  return [
    `Failed to load the ForkNote UI from ${loadUrl}.`,
    detail ? `Detail: ${detail}` : "loadURL rejected.",
    "Quit and relaunch after fixing the UI server (build dist, start Vite, or free the UI port).",
  ].join("\n");
}

/**
 * @param {StartupFailureKind} kind
 * @param {{ path?: string, url?: string, err?: unknown }} [ctx]
 * @returns {{ code: string, title: string, message: string }}
 */
function buildStartupFailure(kind, ctx = {}) {
  switch (kind) {
    case "missing_dist": {
      const checked = checkDistIndex(ctx.path || "");
      return {
        code: "FORKNOTE_MISSING_DIST",
        title: "ForkNote UI missing",
        message:
          checked.ok === false
            ? checked.message
            : "Packaged UI (dist/index.html) is missing. Run npm run build, then retry.",
      };
    }
    case "vite_unavailable":
      return {
        code: "FORKNOTE_VITE_UNAVAILABLE",
        title: "ForkNote dev UI unavailable",
        message: viteUnavailableMessage(ctx.url || "http://127.0.0.1:5173"),
      };
    case "ui_bind":
      return {
        code: "FORKNOTE_UI_BIND",
        title: "ForkNote UI server failed",
        message: uiBindFailureMessage(ctx.err),
      };
    case "load_url":
      return {
        code: "FORKNOTE_LOAD_URL",
        title: "ForkNote failed to load UI",
        message: loadUrlFailureMessage(ctx.url || "(unknown)", ctx.err),
      };
    default:
      return {
        code: "FORKNOTE_STARTUP_FAILED",
        title: "ForkNote failed to start",
        message:
          ctx.err instanceof Error
            ? ctx.err.message
            : String(ctx.err || "Unknown startup failure"),
      };
  }
}

/**
 * @param {string} code
 * @param {string} message
 * @returns {Error & { code: string }}
 */
function startupError(code, message) {
  const err = /** @type {Error & { code: string }} */ (new Error(message));
  err.code = code;
  return err;
}

module.exports = {
  checkDistIndex,
  viteUnavailableMessage,
  uiBindFailureMessage,
  loadUrlFailureMessage,
  buildStartupFailure,
  startupError,
};
