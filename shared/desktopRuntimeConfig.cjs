/**
 * Shared helpers for Electron main ↔ preload runtime configuration.
 * CommonJS so both electron/*.cjs and Node probes can require it.
 */

const DEFAULT_SIDECAR_HOST = "127.0.0.1";
const DEFAULT_SIDECAR_PORT = 8787;

const ARG_SIDECAR_URL = "forknote-sidecar-url";
const ARG_ALLOW_DEV_SURFACES = "forknote-allow-dev-surfaces";

/**
 * @param {string} [host]
 * @param {number|string} [port]
 * @returns {string}
 */
function buildSidecarUrl(host = DEFAULT_SIDECAR_HOST, port = DEFAULT_SIDECAR_PORT) {
  const h = String(host || DEFAULT_SIDECAR_HOST).trim() || DEFAULT_SIDECAR_HOST;
  const p = Number(port);
  const portNum = Number.isFinite(p) && p > 0 ? p : DEFAULT_SIDECAR_PORT;
  return `http://${h}:${portNum}`;
}

/**
 * Developer surfaces (DevTools, reload menu) are allowed in Electron-dev
 * or when the app is not packaged. Packaged production keeps them gated off.
 * @param {{ isDev: boolean, isPackaged: boolean }} opts
 */
function allowDeveloperSurfaces({ isDev, isPackaged }) {
  return Boolean(isDev) || !Boolean(isPackaged);
}

/**
 * @param {string[]} argv
 * @param {string} name
 * @returns {string|undefined}
 */
function readAdditionalArgument(argv, name) {
  const prefix = `--${name}=`;
  for (const arg of argv) {
    if (typeof arg === "string" && arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
  }
  return undefined;
}

/**
 * @param {{ sidecarUrl: string, allowDevSurfaces: boolean }} config
 * @returns {string[]}
 */
function buildDesktopAdditionalArguments(config) {
  return [
    `--${ARG_SIDECAR_URL}=${config.sidecarUrl}`,
    `--${ARG_ALLOW_DEV_SURFACES}=${config.allowDevSurfaces ? "1" : "0"}`,
  ];
}

/**
 * @param {string[]} argv
 */
function parseDesktopRuntimeConfig(argv) {
  const sidecarUrl =
    readAdditionalArgument(argv, ARG_SIDECAR_URL) ||
    buildSidecarUrl();
  const allowRaw = readAdditionalArgument(argv, ARG_ALLOW_DEV_SURFACES);
  const allowDevSurfaces = allowRaw == null ? true : allowRaw === "1";
  return { sidecarUrl, allowDevSurfaces };
}

/**
 * DevTools accelerator heuristic for before-input-event gating.
 * @param {{ type: string, key: string, control: boolean, meta: boolean, alt: boolean, shift: boolean }} input
 */
function isDevToolsShortcut(input) {
  if (!input || input.type !== "keyDown") return false;
  const key = String(input.key || "").toLowerCase();
  if (key === "f12") return true;
  // Cmd+Opt+I (mac) / Ctrl+Shift+I (win/linux)
  if (key === "i" && input.alt && (input.meta || input.control)) return true;
  if (key === "i" && input.shift && input.control) return true;
  // Cmd+Opt+J / Ctrl+Shift+J
  if (key === "j" && input.alt && (input.meta || input.control)) return true;
  if (key === "j" && input.shift && input.control) return true;
  return false;
}

module.exports = {
  DEFAULT_SIDECAR_HOST,
  DEFAULT_SIDECAR_PORT,
  ARG_SIDECAR_URL,
  ARG_ALLOW_DEV_SURFACES,
  buildSidecarUrl,
  allowDeveloperSurfaces,
  readAdditionalArgument,
  buildDesktopAdditionalArguments,
  parseDesktopRuntimeConfig,
  isDevToolsShortcut,
};
