/// <reference types="vite/client" />

/** Injected by Electron preload when running as the desktop app. */
interface ForkNoteDesktop {
  isDesktop: true;
  /** Absolute sidecar origin (also reachable via relative `/sidecar` proxy). */
  sidecarUrl: string;
}

interface Window {
  forknoteDesktop?: ForkNoteDesktop;
}
