/**
 * Preload: expose a small desktop marker for the renderer.
 * Sidecar traffic still uses `/sidecar` (proxied by Electron's loopback UI
 * server in production, or Vite in `electron:dev`). Absolute URL is available
 * when a caller wants to hit 8787 directly.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("forknoteDesktop", {
  isDesktop: true,
  sidecarUrl: "http://127.0.0.1:8787",
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
