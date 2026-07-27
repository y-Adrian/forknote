/**
 * Preload: expose a small desktop marker for the renderer.
 * Sidecar traffic still uses `/sidecar` (proxied by Electron's loopback UI
 * server in production, or Vite in `electron:dev`). Absolute URL is available
 * when a caller wants to hit 8787 directly.
 */
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("forknoteDesktop", {
  isDesktop: true,
  sidecarUrl: "http://127.0.0.1:8787",
});
