import { useCallback, useEffect, useState } from "react";

/** UI / chat body font preference (code surfaces stay on JetBrains Mono). */
export type UiFontPreference = "default" | "system";

export const UI_FONT_STORAGE_KEY = "forknote-ui-font";

type Listener = (preference: UiFontPreference) => void;

const listeners = new Set<Listener>();

function notify(preference: UiFontPreference) {
  listeners.forEach((fn) => fn(preference));
}

export function getStoredUiFontPreference(): UiFontPreference | null {
  try {
    const value = localStorage.getItem(UI_FONT_STORAGE_KEY);
    if (value === "default" || value === "system") return value;
  } catch {
    // ignore
  }
  return null;
}

export function resolveInitialUiFontPreference(): UiFontPreference {
  return getStoredUiFontPreference() ?? "default";
}

/** Apply preference to `<html data-ui-font>` and optionally persist. */
export function applyUiFontPreference(
  preference: UiFontPreference,
  persist = true,
): void {
  document.documentElement.setAttribute("data-ui-font", preference);
  if (persist) {
    try {
      localStorage.setItem(UI_FONT_STORAGE_KEY, preference);
    } catch {
      // ignore
    }
  }
  notify(preference);
}

export function useUiFont() {
  const [preference, setPreferenceState] = useState<UiFontPreference>(() => {
    if (typeof document !== "undefined") {
      const attr = document.documentElement.getAttribute("data-ui-font");
      if (attr === "default" || attr === "system") return attr;
    }
    return resolveInitialUiFontPreference();
  });

  useEffect(() => {
    const onNotify: Listener = (next) => setPreferenceState(next);
    listeners.add(onNotify);
    return () => {
      listeners.delete(onNotify);
    };
  }, []);

  const setUiFontPreference = useCallback((next: UiFontPreference) => {
    applyUiFontPreference(next);
  }, []);

  return { preference, setUiFontPreference };
}
