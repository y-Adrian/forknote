import { useEffect } from "react";
import { stepTextZoom, type TextZoomAction } from "./textZoom";

/**
 * Cmd/Ctrl +/- / 0 and Ctrl/Cmd+wheel adjust chat text zoom only.
 * Prevents the browser/Electron page zoom from scaling the whole chrome.
 */
export function useTextZoomShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key;
      let action: TextZoomAction | null = null;
      if (key === "=" || key === "+" || key === "Add") action = "in";
      else if (key === "-" || key === "_" || key === "Subtract") action = "out";
      else if (key === "0" || key === "Digit0") action = "reset";
      if (!action) return;
      e.preventDefault();
      stepTextZoom(action);
    };

    const onWheel = (e: WheelEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      if (e.deltaY < 0) stepTextZoom("in");
      else if (e.deltaY > 0) stepTextZoom("out");
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("wheel", onWheel, { passive: false, capture: true });

    const desktop = window.forknoteDesktop;
    let unsubscribe: (() => void) | undefined;
    if (desktop?.onTextZoom) {
      unsubscribe = desktop.onTextZoom((action) => {
        stepTextZoom(action);
      });
    }

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("wheel", onWheel, true);
      unsubscribe?.();
    };
  }, []);
}
