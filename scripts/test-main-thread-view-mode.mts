/**
 * Probe: main-thread reading/source view mode helpers.
 * Usage: npx tsx scripts/test-main-thread-view-mode.mts
 */
import {
  MAIN_THREAD_VIEW_MODE_STORAGE_KEY,
  getMainThreadViewMode,
  initMainThreadViewMode,
  readStoredMainThreadViewMode,
  setMainThreadViewMode,
  toggleMainThreadViewMode,
} from "../src/lib/mainThreadViewMode.ts";

const results: Array<{ name: string; pass: boolean }> = [];
function ok(name: string, pass: boolean) {
  results.push({ name, pass });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}`);
}

const memory = new Map<string, string>();
const localStorageMock = {
  getItem(key: string) {
    return memory.has(key) ? memory.get(key)! : null;
  },
  setItem(key: string, value: string) {
    memory.set(key, String(value));
  },
  removeItem(key: string) {
    memory.delete(key);
  },
};

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

memory.clear();
setMainThreadViewMode("reading", false);
ok("default reading", getMainThreadViewMode() === "reading");

ok("toggle to source", toggleMainThreadViewMode() === "source");
ok(
  "persists source key",
  memory.get(MAIN_THREAD_VIEW_MODE_STORAGE_KEY) === "source",
);
ok("readStored source", readStoredMainThreadViewMode() === "source");

ok("toggle back to reading", toggleMainThreadViewMode() === "reading");
ok(
  "clears default key",
  !memory.has(MAIN_THREAD_VIEW_MODE_STORAGE_KEY),
);

memory.set(MAIN_THREAD_VIEW_MODE_STORAGE_KEY, "source");
setMainThreadViewMode("reading", false);
ok("init hydrates source", initMainThreadViewMode() === "source");
ok("memory after init", getMainThreadViewMode() === "source");

memory.set(MAIN_THREAD_VIEW_MODE_STORAGE_KEY, "nope");
ok("invalid stored falls back", readStoredMainThreadViewMode() === "reading");
setMainThreadViewMode("source", false);
ok("memory unchanged by invalid read", getMainThreadViewMode() === "source");

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
