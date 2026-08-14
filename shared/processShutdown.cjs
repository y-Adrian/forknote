/**
 * Bounded child-process shutdown with escalation.
 * SIGTERM (process group when safe) → wait → SIGKILL.
 */

/**
 * @param {import("node:child_process").ChildProcess | null | undefined} child
 * @returns {boolean}
 */
function isChildExited(child) {
  return !child || child.exitCode != null || child.signalCode != null;
}

/**
 * @param {import("node:child_process").ChildProcess | null | undefined} child
 * @param {NodeJS.Signals | number} signal
 * @param {{ processGroup?: boolean }} [opts]
 * @returns {boolean} true if a signal was attempted
 */
function signalChild(child, signal, opts = {}) {
  if (isChildExited(child)) return false;
  const useGroup =
    opts.processGroup !== false &&
    process.platform !== "win32" &&
    typeof child.pid === "number" &&
    child.pid > 0;

  if (useGroup) {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch {
      // fall through to direct kill
    }
  }

  try {
    child.kill(signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {import("node:child_process").ChildProcess | null | undefined} child
 * @param {number} graceMs
 * @returns {Promise<"already-dead"|"exited"|"force-killed">}
 */
function terminateChildProcess(child, graceMs = 2000) {
  // Note: do not treat `child.killed` as exited — it only means kill() was sent.
  if (isChildExited(child)) {
    return Promise.resolve("already-dead");
  }

  return new Promise((resolve) => {
    let settled = false;
    let forceKillStarted = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("exit", onExit);
      resolve(result);
    };

    const onExit = () => finish(forceKillStarted ? "force-killed" : "exited");
    child.once("exit", onExit);

    signalChild(child, "SIGTERM", { processGroup: true });

    const timer = setTimeout(() => {
      if (isChildExited(child)) {
        finish("exited");
        return;
      }
      forceKillStarted = true;
      signalChild(child, "SIGKILL", { processGroup: true });
      // Give the force-kill a brief moment to register, then settle.
      setTimeout(() => finish("force-killed"), 50);
    }, Math.max(0, graceMs));
  });
}

/**
 * Whether a spawn should be detached so POSIX process-group signalling is safe
 * (avoids signalling Electron's own process group).
 * @returns {boolean}
 */
function shouldDetachSpawnedSidecar() {
  return process.platform !== "win32";
}

module.exports = {
  isChildExited,
  signalChild,
  terminateChildProcess,
  shouldDetachSpawnedSidecar,
};
