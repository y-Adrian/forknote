/**
 * ForkNote Electron main process — thin shell around the Vite UI + sidecar.
 *
 * Production: loopback UI server serves `dist/` and proxies `/sidecar` + `/openai`
 * (same relative paths as Vite). Dev (`ELECTRON_DEV=1`): load Vite at :5173.
 */
const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { startUiServer } = require("./uiServer.cjs");
const { loadOrCreateSidecarToken } = require("../shared/sidecarAuth.cjs");
const {
  buildSidecarUrl,
  allowDeveloperSurfaces,
  buildDesktopAdditionalArguments,
  isDevToolsShortcut,
} = require("../shared/desktopRuntimeConfig.cjs");
const {
  isForkNoteSidecarHealthPayload,
  sidecarPortConflictLines,
  decideSidecarStartupAction,
} = require("../shared/sidecarStartupHealth.cjs");
const {
  checkDistIndex,
  buildStartupFailure,
  startupError,
} = require("../shared/electronStartupGuard.cjs");
const {
  terminateChildProcess,
  shouldDetachSpawnedSidecar,
} = require("../shared/processShutdown.cjs");

/**
 * Floor must sit below the web shell’s narrow-sidebar breakpoint (768px in
 * `src/lib/layout.ts` / `src/index.css`) so resizing the .app can trigger the
 * same session-drawer collapse as the browser — not page zoom.
 */
const WINDOW_MIN_WIDTH = 360;
const WINDOW_MIN_HEIGHT = 480;
/** Keep pinch/page zoom disabled — chat uses CSS text zoom instead. */
const VISUAL_ZOOM_MIN = 1;
const VISUAL_ZOOM_MAX = 1;

function isSafeExternalUrl(rawUrl) {
  try {
    const protocol = new URL(rawUrl).protocol;
    return protocol === "http:" || protocol === "https:" || protocol === "mailto:";
  } catch {
    return false;
  }
}

/** Prefer the brand mark exported into `build/` for Dock / window chrome. */
function resolveAppIconPath() {
  const candidates = [
    path.join(__dirname, "..", "build", "icon.png"),
    path.join(__dirname, "..", "build", "icon.icns"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

// Never run the shell itself as Node (would make `app` undefined).
delete process.env.ELECTRON_RUN_AS_NODE;

const SIDECAR_HOST = process.env.SIDECAR_HOST || "127.0.0.1";
const SIDECAR_PORT = Number(process.env.SIDECAR_PORT || 8787);
const SIDECAR_URL = buildSidecarUrl(SIDECAR_HOST, SIDECAR_PORT);
const SIDECAR_AUTH_TOKEN = loadOrCreateSidecarToken();
const isDev = process.env.ELECTRON_DEV === "1";

/** @type {import('node:child_process').ChildProcess | null} */
let sidecarChild = null;
let weStartedSidecar = false;
/** @type {import('node:http').Server | null} */
let uiServer = null;
/** @type {string | null} */
let uiOrigin = null;
/** @type {Promise<string> | null} */
let uiServerStart = null;

/** Project / packaged app root (`Resources/app` when packaged; asar is off). */
function appRoot() {
  return app.isPackaged ? app.getAppPath() : path.join(__dirname, "..");
}

function distDir() {
  return path.join(appRoot(), "dist");
}

async function ensureUiServer() {
  if (uiServer?.listening && uiOrigin) return uiOrigin;
  if (uiServerStart) return uiServerStart;

  const dist = distDir();
  const distCheck = checkDistIndex(path.join(dist, "index.html"));
  if (!distCheck.ok) {
    const failure = buildStartupFailure("missing_dist", {
      path: path.join(dist, "index.html"),
    });
    throw startupError(failure.code, failure.message);
  }

  uiServerStart = startUiServer({
    distDir: dist,
    sidecarToken: SIDECAR_AUTH_TOKEN,
  })
    .then(({ server, origin }) => {
      uiServer = server;
      uiOrigin = origin;
      console.log(`[forknote-desktop] UI at ${origin}`);
      return origin;
    })
    .catch((err) => {
      const failure = buildStartupFailure("ui_bind", { err });
      throw startupError(failure.code, failure.message);
    })
    .finally(() => {
      uiServerStart = null;
    });
  return uiServerStart;
}

/**
 * Dev shell expects an already-running Vite; probe before loadURL so we do not
 * leave a blank BrowserWindow when :5173 is down.
 * @param {string} viteUrl
 */
function viteDevServerReachable(viteUrl) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(viteUrl);
    } catch {
      resolve(false);
      return;
    }
    const req = http.get(
      {
        host: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname || "/",
        timeout: 800,
      },
      (res) => {
        res.resume();
        resolve((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 500);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function sidecarEntry() {
  return path.join(appRoot(), "sidecar", "index.js");
}

function isPortOpen(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

function sidecarHealthy() {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: SIDECAR_HOST,
        port: SIDECAR_PORT,
        path: "/health",
        headers: {
          "X-ForkNote-Sidecar-Token": SIDECAR_AUTH_TOKEN,
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve(isForkNoteSidecarHealthPayload(res.statusCode, body));
        });
      },
    );
    req.on("error", () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function failSidecarPortConflict() {
  const lines = sidecarPortConflictLines(SIDECAR_HOST, SIDECAR_PORT);
  for (const line of lines) {
    console.error(`[forknote-desktop] ${line}`);
  }
  const message = lines.join("\n");
  try {
    dialog.showErrorBox("ForkNote sidecar port conflict", message);
  } catch {
    /* dialog may be unavailable very early; console already logged */
  }
  const err = new Error(message);
  err.code = "FORKNOTE_SIDECAR_PORT_CONFLICT";
  throw err;
}

async function ensureSidecar() {
  if (await sidecarHealthy()) {
    console.log(
      `[forknote-desktop] sidecar already healthy on http://${SIDECAR_HOST}:${SIDECAR_PORT}`,
    );
    return;
  }

  if (await isPortOpen(SIDECAR_PORT, SIDECAR_HOST)) {
    // Port open but /health not OK yet — wait briefly for a still-booting sidecar.
    for (let i = 0; i < 20; i++) {
      if (await sidecarHealthy()) {
        console.log(
          `[forknote-desktop] sidecar became healthy on http://${SIDECAR_HOST}:${SIDECAR_PORT}`,
        );
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    // Occupied by a non-ForkNote (or unhealthy) listener — do not spawn into it.
    if (
      decideSidecarStartupAction({ healthy: false, portOpen: true }) ===
      "conflict"
    ) {
      failSidecarPortConflict();
    }
  }

  const entry = sidecarEntry();
  const cwd = appRoot();
  console.log(`[forknote-desktop] starting sidecar: ${entry}`);

  sidecarChild = spawn(process.execPath, [entry], {
    cwd,
    stdio: "inherit",
    // New process group on POSIX so quit can signal the tree without hitting Electron.
    detached: shouldDetachSpawnedSidecar(),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      SIDECAR_HOST,
      SIDECAR_PORT: String(SIDECAR_PORT),
      SIDECAR_AUTH_TOKEN,
    },
  });
  weStartedSidecar = true;

  sidecarChild.on("exit", (code, signal) => {
    if (!weStartedSidecar) return;
    void sidecarHealthy().then((up) => {
      if (up) {
        weStartedSidecar = false;
        sidecarChild = null;
        return;
      }
      console.error(
        `[forknote-desktop] sidecar exited (code=${code ?? "null"} signal=${signal ?? "null"})`,
      );
    });
  });

  for (let i = 0; i < 40; i++) {
    if (await sidecarHealthy()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  console.error(
    `[forknote-desktop] sidecar did not become ready on http://${SIDECAR_HOST}:${SIDECAR_PORT}`,
  );
}

const SIDECAR_QUIT_GRACE_MS = Number(
  process.env.FORKNOTE_SIDECAR_QUIT_GRACE_MS || 2000,
);

/**
 * SIGTERM the sidecar tree, wait, then SIGKILL after a bounded grace period.
 * @param {number} [graceMs]
 */
async function stopSidecar(graceMs = SIDECAR_QUIT_GRACE_MS) {
  if (!weStartedSidecar || !sidecarChild) return;
  const child = sidecarChild;
  weStartedSidecar = false;
  sidecarChild = null;
  const result = await terminateChildProcess(child, graceMs);
  console.log(`[forknote-desktop] sidecar shutdown: ${result}`);
}

function stopSidecarSyncBestEffort() {
  if (!weStartedSidecar || !sidecarChild) return;
  const child = sidecarChild;
  weStartedSidecar = false;
  sidecarChild = null;
  // Failure / sync paths cannot await — still escalate quickly.
  void terminateChildProcess(child, Math.min(500, SIDECAR_QUIT_GRACE_MS));
}

/**
 * Application menu with View → Zoom In / Out / Actual Size.
 * These adjust chat text size only (IPC → renderer), not page zoomFactor.
 */
function sendTextZoom(action) {
  const win = BrowserWindow.getFocusedWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send("text-zoom", action);
}

function buildAppMenu(allowDevSurfaces) {
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const viewExtras = allowDevSurfaces
    ? [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
      ]
    : [];
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        ...viewExtras,
        {
          label: "Actual Size",
          accelerator: "CommandOrControl+0",
          click: () => sendTextZoom("reset"),
        },
        {
          label: "Zoom In",
          accelerator: "CommandOrControl+=",
          click: () => sendTextZoom("in"),
        },
        {
          label: "Zoom Out",
          accelerator: "CommandOrControl+-",
          click: () => sendTextZoom("out"),
        },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(process.platform === "darwin"
          ? [
              { type: "separator" },
              { role: "front" },
              { type: "separator" },
              { role: "window" },
            ]
          : [{ role: "close" }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function stopUiServer() {
  if (!uiServer) return;
  try {
    uiServer.close();
  } catch {
    /* ignore */
  }
  uiServer = null;
  uiOrigin = null;
}

/**
 * User-visible startup failure: log, dialog (unless already shown), cleanup, quit.
 * @param {unknown} err
 * @param {{ dialogAlreadyShown?: boolean }} [opts]
 */
function reportStartupFailureAndQuit(err, opts = {}) {
  const code =
    err && typeof err === "object" && "code" in err
      ? String(/** @type {{ code?: string }} */ (err).code || "")
      : "";
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[forknote-desktop] startup failed: ${message}`);

  const alreadyShown =
    opts.dialogAlreadyShown ||
    code === "FORKNOTE_SIDECAR_PORT_CONFLICT";
  if (!alreadyShown) {
    let title = "ForkNote failed to start";
    if (code === "FORKNOTE_MISSING_DIST") title = "ForkNote UI missing";
    else if (code === "FORKNOTE_VITE_UNAVAILABLE")
      title = "ForkNote dev UI unavailable";
    else if (code === "FORKNOTE_UI_BIND") title = "ForkNote UI server failed";
    else if (code === "FORKNOTE_LOAD_URL") title = "ForkNote failed to load UI";
    try {
      dialog.showErrorBox(title, message);
    } catch {
      /* ignore */
    }
  }

  stopSidecarSyncBestEffort();
  stopUiServer();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.destroy();
  }
  app.quit();
}

async function createWindow(allowDevSurfaces) {
  await ensureSidecar();

  let loadUrl;
  if (isDev) {
    loadUrl = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";
    if (!(await viteDevServerReachable(loadUrl))) {
      const failure = buildStartupFailure("vite_unavailable", { url: loadUrl });
      throw startupError(failure.code, failure.message);
    }
  } else {
    loadUrl = await ensureUiServer();
  }

  const appIcon = resolveAppIconPath();
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    resizable: true,
    maximizable: true,
    title: "ForkNote",
    ...(appIcon ? { icon: appIcon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: buildDesktopAdditionalArguments({
        sidecarUrl: SIDECAR_URL,
        allowDevSurfaces,
      }),
    },
    show: false,
  });

  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) win.show();
  });

  // Disable pinch/page zoom — main session uses CSS `--fn-text-zoom` instead.
  void win.webContents.setVisualZoomLevelLimits(
    VISUAL_ZOOM_MIN,
    VISUAL_ZOOM_MAX,
  );
  win.webContents.setZoomFactor(1);
  win.webContents.on("zoom-changed", () => {
    if (win.isDestroyed()) return;
    if (win.webContents.getZoomFactor() !== 1) {
      win.webContents.setZoomFactor(1);
    }
  });

  if (!allowDevSurfaces) {
    win.webContents.on("before-input-event", (event, input) => {
      if (isDevToolsShortcut(input)) event.preventDefault();
    });
    win.webContents.on("devtools-opened", () => {
      if (!win.isDestroyed()) win.webContents.closeDevTools();
    });
  }

  const appOrigin = new URL(loadUrl).origin;
  const keepExternalNavigationOutOfChat = (event, url) => {
    let targetOrigin = "";
    try {
      targetOrigin = new URL(url).origin;
    } catch {
      event.preventDefault();
      return;
    }
    if (targetOrigin === appOrigin) return;

    event.preventDefault();
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  };

  // A normal same-tab link used to replace the entire React conversation with
  // the remote page. Keep the app mounted even if a renderer misses target=_blank.
  win.webContents.on("will-navigate", keepExternalNavigationOutOfChat);
  win.webContents.on("will-redirect", keepExternalNavigationOutOfChat);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  try {
    await win.loadURL(loadUrl);
  } catch (err) {
    if (!win.isDestroyed()) win.destroy();
    const failure = buildStartupFailure("load_url", { url: loadUrl, err });
    throw startupError(failure.code, failure.message);
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  /** Resolved once app is ready; safe default until then. */
  let allowDevSurfaces = allowDeveloperSurfaces({
    isDev,
    isPackaged: false,
  });

  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      return;
    }
    void createWindow(allowDevSurfaces).catch((err) => {
      reportStartupFailureAndQuit(err);
    });
  });

  app.whenReady().then(() => {
    allowDevSurfaces = allowDeveloperSurfaces({
      isDev,
      isPackaged: app.isPackaged,
    });
    const appIcon = resolveAppIconPath();
    if (appIcon && process.platform === "darwin" && app.dock) {
      app.dock.setIcon(appIcon);
    }
    buildAppMenu(allowDevSurfaces);
    void createWindow(allowDevSurfaces).catch((err) => {
      reportStartupFailureAndQuit(err);
    });
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow(allowDevSurfaces).catch((err) => {
          reportStartupFailureAndQuit(err);
        });
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  let quitCleanupStarted = false;
  app.on("before-quit", (event) => {
    if (quitCleanupStarted) return;
    // Always run bounded sidecar shutdown when we spawned it.
    if (!weStartedSidecar || !sidecarChild) {
      stopUiServer();
      return;
    }
    event.preventDefault();
    quitCleanupStarted = true;
    void (async () => {
      try {
        await stopSidecar();
      } finally {
        stopUiServer();
        app.exit(0);
      }
    })();
  });
}
