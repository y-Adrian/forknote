/**
 * Sidecar startup health helpers shared by Electron main (and probes).
 * Require the ForkNote `/health` payload shape — not merely HTTP 200 —
 * and surface actionable port-conflict guidance.
 */

/**
 * @param {number|undefined|null} statusCode
 * @param {string} body
 * @returns {boolean}
 */
function isForkNoteSidecarHealthPayload(statusCode, body) {
  if (statusCode !== 200) return false;
  try {
    const data = JSON.parse(String(body || ""));
    return Boolean(data && data.ok === true);
  } catch {
    return false;
  }
}

/**
 * @param {string} host
 * @param {number|string} port
 * @returns {string}
 */
function portOwnerHint(host, port) {
  void host;
  return process.platform === "win32"
    ? `netstat -ano | findstr :${port}`
    : `lsof -nP -iTCP:${port} -sTCP:LISTEN`;
}

/**
 * @param {string} host
 * @param {number|string} port
 * @returns {string[]}
 */
function sidecarPortConflictLines(host, port) {
  return [
    `port ${port} is in use, but GET /health is not a healthy ForkNote sidecar.`,
    `Something else may be bound to http://${host}:${port}.`,
    `See who owns it: ${portOwnerHint(host, port)}`,
    `Free the port, or set SIDECAR_PORT to an unused port and retry.`,
  ];
}

/**
 * Decide whether Electron should reuse, spawn, or refuse a conflicting port.
 * @param {{ healthy: boolean, portOpen: boolean }} state
 * @returns {"reuse" | "spawn" | "conflict"}
 */
function decideSidecarStartupAction({ healthy, portOpen }) {
  if (healthy) return "reuse";
  if (portOpen) return "conflict";
  return "spawn";
}

module.exports = {
  isForkNoteSidecarHealthPayload,
  portOwnerHint,
  sidecarPortConflictLines,
  decideSidecarStartupAction,
};
