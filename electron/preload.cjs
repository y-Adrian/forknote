/**
 * Preload: expose a small desktop marker for the renderer.
 * Sidecar traffic still uses `/sidecar` (proxied by Electron's loopback UI
 * server in production, or Vite in `electron:dev`). Absolute URL comes from
 * main via additionalArguments so SIDECAR_HOST / SIDECAR_PORT stay aligned.
 */
const { contextBridge, ipcRenderer } = require("electron");
const {
  parseDesktopRuntimeConfig,
} = require("../shared/desktopRuntimeConfig.cjs");

const runtime = parseDesktopRuntimeConfig(process.argv);

contextBridge.exposeInMainWorld("forknoteDesktop", {
  isDesktop: true,
  sidecarUrl: runtime.sidecarUrl,
  /** False in packaged production — DevTools / reload menu are gated in main. */
  allowDevSurfaces: runtime.allowDevSurfaces,
  /**
   * Subscribe to View → Zoom In/Out/Actual Size (text zoom only).
   * @param {(action: 'in'|'out'|'reset') => void} handler
   * @returns {() => void} unsubscribe
   */
  onTextZoom(handler) {
    const channel = "text-zoom";
    /** @param {Electron.IpcRendererEvent} _event */
    /** @param {'in'|'out'|'reset'} action */
    const listener = (_event, action) => {
      if (action === "in" || action === "out" || action === "reset") {
        handler(action);
      }
    };
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
});
