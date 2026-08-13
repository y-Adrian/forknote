/** Main-session text zoom — scales chat fonts only, not page layout. */

export const TEXT_ZOOM_STORAGE_KEY = "forknote-text-zoom";
export const TEXT_ZOOM_MIN = 0.85;
export const TEXT_ZOOM_MAX = 1.5;
export const TEXT_ZOOM_STEP = 0.05;
export const TEXT_ZOOM_DEFAULT = 1;

export type TextZoomAction = "in" | "out" | "reset";

let memoryZoom = TEXT_ZOOM_DEFAULT;

function clamp(value: number): number {
  return Math.min(TEXT_ZOOM_MAX, Math.max(TEXT_ZOOM_MIN, value));
}

function roundZoom(value: number): number {
  return Math.round(clamp(value) * 100) / 100;
}

export function readStoredTextZoom(): number {
  try {
    const raw = localStorage.getItem(TEXT_ZOOM_STORAGE_KEY);
    if (!raw) return TEXT_ZOOM_DEFAULT;
    const n = Number(raw);
    if (!Number.isFinite(n)) return TEXT_ZOOM_DEFAULT;
    return roundZoom(n);
  } catch {
    return TEXT_ZOOM_DEFAULT;
  }
}

export function applyTextZoom(value: number, persist = true): number {
  const next = roundZoom(value);
  memoryZoom = next;
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty("--fn-text-zoom", String(next));
  }
  if (persist) {
    try {
      if (next === TEXT_ZOOM_DEFAULT) {
        localStorage.removeItem(TEXT_ZOOM_STORAGE_KEY);
      } else {
        localStorage.setItem(TEXT_ZOOM_STORAGE_KEY, String(next));
      }
    } catch {
      // ignore quota / private mode
    }
  }
  return next;
}

export function getTextZoom(): number {
  if (typeof document !== "undefined") {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue("--fn-text-zoom")
      .trim();
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return roundZoom(n);
  }
  return memoryZoom;
}

export function stepTextZoom(action: TextZoomAction): number {
  const current = getTextZoom();
  if (action === "reset") return applyTextZoom(TEXT_ZOOM_DEFAULT);
  if (action === "in") return applyTextZoom(current + TEXT_ZOOM_STEP);
  return applyTextZoom(current - TEXT_ZOOM_STEP);
}

/** Boot-time apply (call before React render). */
export function initTextZoom(): number {
  return applyTextZoom(readStoredTextZoom(), false);
}
