/**
 * Main-thread display mode: rendered markdown (reading) vs raw source.
 * Persisted lightly in localStorage for copy/debug convenience.
 */

export const MAIN_THREAD_VIEW_MODE_STORAGE_KEY = "forknote-main-thread-view-mode";

export type MainThreadViewMode = "reading" | "source";

const DEFAULT_MODE: MainThreadViewMode = "reading";

let memoryMode: MainThreadViewMode = DEFAULT_MODE;

function isMode(value: unknown): value is MainThreadViewMode {
  return value === "reading" || value === "source";
}

export function readStoredMainThreadViewMode(): MainThreadViewMode {
  try {
    const raw = localStorage.getItem(MAIN_THREAD_VIEW_MODE_STORAGE_KEY);
    if (isMode(raw)) return raw;
  } catch {
    // ignore quota / private mode
  }
  return DEFAULT_MODE;
}

export function getMainThreadViewMode(): MainThreadViewMode {
  return memoryMode;
}

export function setMainThreadViewMode(
  mode: MainThreadViewMode,
  persist = true,
): MainThreadViewMode {
  const next: MainThreadViewMode = isMode(mode) ? mode : DEFAULT_MODE;
  memoryMode = next;
  if (persist) {
    try {
      if (next === DEFAULT_MODE) {
        localStorage.removeItem(MAIN_THREAD_VIEW_MODE_STORAGE_KEY);
      } else {
        localStorage.setItem(MAIN_THREAD_VIEW_MODE_STORAGE_KEY, next);
      }
    } catch {
      // ignore quota / private mode
    }
  }
  return next;
}

export function toggleMainThreadViewMode(persist = true): MainThreadViewMode {
  return setMainThreadViewMode(
    memoryMode === "source" ? "reading" : "source",
    persist,
  );
}

/** Boot / first render: hydrate memory from localStorage. */
export function initMainThreadViewMode(): MainThreadViewMode {
  return setMainThreadViewMode(readStoredMainThreadViewMode(), false);
}
