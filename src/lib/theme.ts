import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";
/** Stored preference; `system` follows OS and is not written as data-theme. */
export type ThemePreference = Theme | "system";

export const THEME_STORAGE_KEY = "forknote-theme";

type Listener = (preference: ThemePreference, theme: Theme) => void;

const listeners = new Set<Listener>();

function notify(preference: ThemePreference, theme: Theme) {
  listeners.forEach((fn) => fn(preference, theme));
}

export function getSystemTheme(): Theme {
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  ) {
    return "light";
  }
  return "dark";
}

export function getStoredThemePreference(): ThemePreference | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system") {
      return value;
    }
  } catch {
    // ignore
  }
  return null;
}

/** @deprecated Prefer getStoredThemePreference */
export function getStoredTheme(): Theme | null {
  const pref = getStoredThemePreference();
  if (pref === "light" || pref === "dark") return pref;
  return null;
}

export function resolveTheme(preference: ThemePreference): Theme {
  if (preference === "system") return getSystemTheme();
  return preference;
}

/** Saved preference, else system preference, else dark. */
export function resolveInitialTheme(): Theme {
  const stored = getStoredThemePreference();
  if (stored) return resolveTheme(stored);
  return getSystemTheme();
}

export function resolveInitialPreference(): ThemePreference {
  return getStoredThemePreference() ?? "system";
}

/** Apply resolved light/dark to the document. Optionally persist preference. */
export function applyTheme(
  theme: Theme,
  preferenceToStore?: ThemePreference,
): void {
  document.documentElement.setAttribute("data-theme", theme);
  if (preferenceToStore !== undefined) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, preferenceToStore);
    } catch {
      // ignore
    }
  }
}

export function applyThemePreference(preference: ThemePreference): Theme {
  const resolved = resolveTheme(preference);
  applyTheme(resolved, preference);
  notify(preference, resolved);
  return resolved;
}

export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    if (typeof document !== "undefined") {
      const stored = getStoredThemePreference();
      if (stored) return stored;
    }
    return resolveInitialPreference();
  });

  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof document !== "undefined") {
      const attr = document.documentElement.getAttribute("data-theme");
      if (attr === "light" || attr === "dark") return attr;
    }
    return resolveTheme(resolveInitialPreference());
  });

  useEffect(() => {
    const onNotify: Listener = (nextPref, nextTheme) => {
      setPreferenceState(nextPref);
      setThemeState(nextTheme);
    };
    listeners.add(onNotify);
    return () => {
      listeners.delete(onNotify);
    };
  }, []);

  useEffect(() => {
    if (preference !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      applyThemePreference("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [preference]);

  const setTheme = useCallback((next: Theme) => {
    applyThemePreference(next);
  }, []);

  const setThemePreference = useCallback((next: ThemePreference) => {
    applyThemePreference(next);
  }, []);

  const toggleTheme = useCallback(() => {
    const current = resolveTheme(
      getStoredThemePreference() ?? resolveInitialPreference(),
    );
    applyThemePreference(current === "dark" ? "light" : "dark");
  }, []);

  return { theme, preference, setTheme, setThemePreference, toggleTheme };
}
