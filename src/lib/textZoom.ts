import { useEffect, useState } from "react";

/**
 * Text size scales, each a CSS custom property on `<html>` persisted in
 * localStorage:
 * - chat (`--fn-text-zoom`): conversation text only; Cmd/Ctrl +/- and Settings.
 * - interface (`--fn-ui-text-zoom`): root font size, so every rem-based UI
 *   text follows; chat sizes divide it back out to stay independent.
 */

export const TEXT_ZOOM_STORAGE_KEY = "forknote-text-zoom";
export const TEXT_ZOOM_MIN = 0.85;
export const TEXT_ZOOM_MAX = 1.5;
export const TEXT_ZOOM_STEP = 0.05;
export const TEXT_ZOOM_DEFAULT = 1;

export const UI_TEXT_ZOOM_STORAGE_KEY = "forknote-ui-text-zoom";
export const UI_TEXT_ZOOM_MIN = 0.9;
/** Capped lower than chat: px-sized controls and rows must still fit the text. */
export const UI_TEXT_ZOOM_MAX = 1.2;

export type TextZoomAction = "in" | "out" | "reset";

type ScaleConfig = {
  storageKey: string;
  cssVar: string;
  min: number;
  max: number;
};

type Listener = (value: number) => void;

export type TextScale = ScaleConfig & {
  read: () => number;
  apply: (value: number, persist?: boolean) => number;
  get: () => number;
  step: (action: TextZoomAction) => number;
  subscribe: (fn: Listener) => () => void;
};

function createTextScale(config: ScaleConfig): TextScale {
  const { storageKey, cssVar, min, max } = config;
  let memory = TEXT_ZOOM_DEFAULT;
  const listeners = new Set<Listener>();

  const round = (value: number) =>
    Math.round(Math.min(max, Math.max(min, value)) * 100) / 100;

  const read = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return TEXT_ZOOM_DEFAULT;
      const n = Number(raw);
      return Number.isFinite(n) ? round(n) : TEXT_ZOOM_DEFAULT;
    } catch {
      return TEXT_ZOOM_DEFAULT;
    }
  };

  const apply = (value: number, persist = true) => {
    const next = round(value);
    memory = next;
    if (typeof document !== "undefined") {
      document.documentElement.style.setProperty(cssVar, String(next));
    }
    if (persist) {
      try {
        if (next === TEXT_ZOOM_DEFAULT) localStorage.removeItem(storageKey);
        else localStorage.setItem(storageKey, String(next));
      } catch {
        // ignore quota / private mode
      }
    }
    listeners.forEach((fn) => fn(next));
    return next;
  };

  const get = () => {
    if (typeof document !== "undefined") {
      const n = Number(
        getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim(),
      );
      if (Number.isFinite(n) && n > 0) return round(n);
    }
    return memory;
  };

  const step = (action: TextZoomAction) => {
    if (action === "reset") return apply(TEXT_ZOOM_DEFAULT);
    return apply(get() + (action === "in" ? TEXT_ZOOM_STEP : -TEXT_ZOOM_STEP));
  };

  const subscribe = (fn: Listener) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  };

  return { ...config, read, apply, get, step, subscribe };
}

/** Conversation text (bubbles, answers, composer). */
export const chatTextScale = createTextScale({
  storageKey: TEXT_ZOOM_STORAGE_KEY,
  cssVar: "--fn-text-zoom",
  min: TEXT_ZOOM_MIN,
  max: TEXT_ZOOM_MAX,
});

/** Interface text (sidebar, settings, menus, buttons). */
export const uiTextScale = createTextScale({
  storageKey: UI_TEXT_ZOOM_STORAGE_KEY,
  cssVar: "--fn-ui-text-zoom",
  min: UI_TEXT_ZOOM_MIN,
  max: UI_TEXT_ZOOM_MAX,
});

export function readStoredTextZoom(): number {
  return chatTextScale.read();
}

export function applyTextZoom(value: number, persist = true): number {
  return chatTextScale.apply(value, persist);
}

export function getTextZoom(): number {
  return chatTextScale.get();
}

export function stepTextZoom(action: TextZoomAction): number {
  return chatTextScale.step(action);
}

/** Boot-time apply of both scales (call before React render). */
export function initTextZoom(): number {
  uiTextScale.apply(uiTextScale.read(), false);
  return chatTextScale.apply(chatTextScale.read(), false);
}

/** Current value of a scale, updated when it changes (shortcuts, Settings). */
export function useTextScale(scale: TextScale): number {
  const [value, setValue] = useState(() => scale.get());
  useEffect(() => scale.subscribe(setValue), [scale]);
  return value;
}
