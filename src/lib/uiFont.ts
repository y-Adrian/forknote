import { useCallback, useEffect, useState } from "react";

/**
 * Interface font preference.
 * - default: DM Sans stack
 * - system: OS UI stack (legacy from Default|System toggle)
 * - family: a specific installed font family name
 */
export type UiFontPreference =
  | { kind: "default" }
  | { kind: "system" }
  | { kind: "family"; family: string };

export const UI_FONT_STORAGE_KEY = "forknote-ui-font";

/** Common fonts used when Local Font Access API is unavailable. */
export const FALLBACK_LOCAL_FONTS = [
  "system-ui",
  "-apple-system",
  "BlinkMacSystemFont",
  "Segoe UI",
  "PingFang SC",
  "Hiragino Sans GB",
  "Hiragino Sans",
  "Microsoft YaHei UI",
  "Microsoft YaHei",
  "Noto Sans CJK SC",
  "Noto Sans SC",
  "Source Han Sans SC",
  "Songti SC",
  "STSong",
  "Arial",
  "Helvetica Neue",
  "Helvetica",
  "Verdana",
  "Tahoma",
  "Trebuchet MS",
  "Georgia",
  "Times New Roman",
  "Palatino",
  "Courier New",
  "Menlo",
  "Monaco",
  "Consolas",
] as const;

type Listener = (preference: UiFontPreference) => void;

const listeners = new Set<Listener>();

function notify(preference: UiFontPreference) {
  listeners.forEach((fn) => fn(preference));
}

export function serializeUiFontPreference(pref: UiFontPreference): string {
  if (pref.kind === "family") return `family:${pref.family}`;
  return pref.kind;
}

export function parseUiFontPreference(raw: string | null): UiFontPreference {
  if (!raw || raw === "default") return { kind: "default" };
  if (raw === "system") return { kind: "system" };
  if (raw.startsWith("family:")) {
    const family = raw.slice("family:".length).trim();
    if (family) return { kind: "family", family };
  }
  // Treat unknown legacy values as a custom family when safe.
  if (raw.length > 0 && raw.length < 120 && !raw.includes("\n")) {
    return { kind: "family", family: raw };
  }
  return { kind: "default" };
}

export function getStoredUiFontPreference(): UiFontPreference | null {
  try {
    const value = localStorage.getItem(UI_FONT_STORAGE_KEY);
    if (value == null) return null;
    return parseUiFontPreference(value);
  } catch {
    return null;
  }
}

export function resolveInitialUiFontPreference(): UiFontPreference {
  return getStoredUiFontPreference() ?? { kind: "default" };
}

export function uiFontPreferenceEquals(
  a: UiFontPreference,
  b: UiFontPreference,
): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "family" && b.kind === "family") return a.family === b.family;
  return true;
}

/** Apply preference to `<html>` and optionally persist. */
export function applyUiFontPreference(
  preference: UiFontPreference,
  persist = true,
): void {
  const root = document.documentElement;
  if (preference.kind === "family") {
    root.setAttribute("data-ui-font", "custom");
    root.style.setProperty(
      "--fn-ui-font-family",
      `"${preference.family.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
    );
  } else {
    root.setAttribute("data-ui-font", preference.kind);
    root.style.removeProperty("--fn-ui-font-family");
  }

  if (persist) {
    try {
      localStorage.setItem(
        UI_FONT_STORAGE_KEY,
        serializeUiFontPreference(preference),
      );
    } catch {
      // ignore
    }
  }
  notify(preference);
}

export function canQueryLocalFonts(): boolean {
  return typeof window !== "undefined" && "queryLocalFonts" in window;
}

type LocalFontData = { family: string };

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<LocalFontData[]>;
  }
}

/**
 * List unique font family names from the OS (Local Font Access API),
 * or a curated fallback list when the API is missing / denied.
 */
export async function listLocalFontFamilies(): Promise<{
  families: string[];
  source: "local" | "fallback";
  error?: string;
}> {
  if (!canQueryLocalFonts() || typeof window.queryLocalFonts !== "function") {
    return {
      families: [...FALLBACK_LOCAL_FONTS],
      source: "fallback",
      error: "unsupported",
    };
  }

  try {
    const fonts = await window.queryLocalFonts();
    const names = Array.from(
      new Set(
        fonts
          .map((f) => (f.family || "").trim())
          .filter((name) => name.length > 0),
      ),
    ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

    if (names.length === 0) {
      return {
        families: [...FALLBACK_LOCAL_FONTS],
        source: "fallback",
        error: "empty",
      };
    }
    return { families: names, source: "local" };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not read local fonts";
    return {
      families: [...FALLBACK_LOCAL_FONTS],
      source: "fallback",
      error: message,
    };
  }
}

export function useUiFont() {
  const [preference, setPreferenceState] = useState<UiFontPreference>(() => {
    if (typeof document !== "undefined") {
      const attr = document.documentElement.getAttribute("data-ui-font");
      if (attr === "custom") {
        const raw = getComputedStyle(document.documentElement)
          .getPropertyValue("--fn-ui-font-family")
          .trim()
          .replace(/^["']|["']$/g, "");
        if (raw) return { kind: "family", family: raw };
      }
      if (attr === "system") return { kind: "system" };
      if (attr === "default") return { kind: "default" };
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
