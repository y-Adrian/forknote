/// <reference types="vite/client" />

/** Injected by Electron preload when running as the desktop app. */
interface ForkNoteDesktop {
  isDesktop: true;
  /** Absolute sidecar origin (also reachable via relative `/sidecar` proxy). */
  sidecarUrl: string;
  /** False in packaged production when main gates DevTools / reload. */
  allowDevSurfaces?: boolean;
  /** View menu / accelerators → chat text zoom (not page zoom). */
  onTextZoom?: (handler: (action: "in" | "out" | "reset") => void) => () => void;
}

interface Window {
  forknoteDesktop?: ForkNoteDesktop;
}
