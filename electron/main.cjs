/**
 * ForkNote Electron main process — thin shell around the Vite UI + sidecar.
 *
 * Production: loopback UI server serves `dist/` and proxies `/sidecar` + `/openai`
 * (same relative paths as Vite). Dev (`ELECTRON_DEV=1`): load Vite at :5173.
 */
const { app, BrowserWindow, Menu, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { startUiServer } = require("./uiServer.cjs");

/**
 * Floor must sit below the web shell’s narrow-sidebar breakpoint (768px in
 * `src/lib/layout.ts` / `src/index.css`) so resizing the .app can trigger the
 * same session-drawer collapse as the browser — not page zoom.
 */
const WINDOW_MIN_WIDTH = 360;
const WINDOW_MIN_HEIGHT = 480;
/** Pinch / trackpad visual zoom range (Electron disables this by default). */
const VISUAL_ZOOM_MIN = 1;
const VISUAL_ZOOM_MAX = 3;

// Never run the shell itself as Node (would make `app` undefined).
delete process.env.ELECTRON_RUN_AS_NODE;

const SIDECAR_HOST = process.env.SIDECAR_HOST || "127.0.0.1";
const SIDECAR_PORT = Number(process.env.SIDECAR_PORT || 8787);
const isDev = process.env.ELECTRON_DEV === "1";

/** @type {import('node:child_process').ChildProcess | null} */
let sidecarChild = null;
let weStartedSidecar = false;
/** @type {import('node:http').Server | null} */
let uiServer = null;

/** Project / packaged app root (`Resources/app` when packaged; asar is off). */
function appRoot() {
  return app.isPackaged ? app.getAppPath() : path.join(__dirname, "..");
}

function distDir() {
  return path.join(appRoot(), "dist");
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
      `http://${SIDECAR_HOST}:${SIDECAR_PORT}/health`,
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on("error", () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function ensureSidecar() {
  if (await sidecarHealthy()) {
    console.log(
      `[forknote-desktop] sidecar already healthy on http://${SIDECAR_HOST}:${SIDECAR_PORT}`,
    );
    return;
  }
  if (await isPortOpen(SIDECAR_PORT, SIDECAR_HOST)) {
    // Port open but /health not OK yet — wait briefly.
    for (let i = 0; i < 20; i++) {
      if (await sidecarHealthy()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const entry = sidecarEntry();
  const cwd = appRoot();
  console.log(`[forknote-desktop] starting sidecar: ${entry}`);

  sidecarChild = spawn(process.execPath, [entry], {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      SIDECAR_HOST,
      SIDECAR_PORT: String(SIDECAR_PORT),
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

function stopSidecar() {
  if (!weStartedSidecar || !sidecarChild || sidecarChild.killed) return;
  weStartedSidecar = false;
  try {
    sidecarChild.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  sidecarChild = null;
}

/**
 * Application menu with View → Zoom In / Out / Actual Size (Cmd+/−/0)
 * and standard Edit / Window roles. Keyboard zoom is driven by these roles.
 */
function buildAppMenu() {
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
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
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

async function createWindow() {
  await ensureSidecar();

  let loadUrl;
  if (isDev) {
    loadUrl = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";
  } else {
    const dist = distDir();
    if (!fs.existsSync(path.join(dist, "index.html"))) {
      console.error(
        `[forknote-desktop] missing ${path.join(dist, "index.html")} — run npm run build first`,
      );
    }
    const { server, origin } = await startUiServer({ distDir: dist });
    uiServer = server;
    loadUrl = origin;
    console.log(`[forknote-desktop] UI at ${origin}`);
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    resizable: true,
    maximizable: true,
    title: "ForkNote",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  });

  win.once("ready-to-show", () => win.show());

  // Pinch-to-zoom is off by default (limits 1→1); open a reasonable range.
  void win.webContents.setVisualZoomLevelLimits(
    VISUAL_ZOOM_MIN,
    VISUAL_ZOOM_MAX,
  );

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  await win.loadURL(loadUrl);
}

app.whenReady().then(() => {
  buildAppMenu();
  void createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopSidecar();
  if (uiServer) {
    try {
      uiServer.close();
    } catch {
      /* ignore */
    }
    uiServer = null;
  }
});
