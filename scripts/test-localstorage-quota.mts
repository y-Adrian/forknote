/**
 * Probe #377: empty session arrays are valid; writes are quota-guarded.
 *
 * Usage: npx tsx scripts/test-localstorage-quota.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isQuotaExceededError,
  safeLocalStorageSetItem,
} from "../src/lib/browserStorage.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

type LocalStorageStub = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
  failWrites: boolean;
};

function installLocalStorage(): LocalStorageStub {
  const data = new Map<string, string>();
  const stub: LocalStorageStub = {
    failWrites: false,
    getItem: (key) => data.get(key) ?? null,
    setItem(key, value) {
      if (stub.failWrites) {
        const err = new Error("QuotaExceededError");
        err.name = "QuotaExceededError";
        throw err;
      }
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
      stub.failWrites = false;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: stub,
    configurable: true,
  });
  return stub;
}

const stub = installLocalStorage();

const {
  coerceLoadedSessionStore,
  loadSessionStore,
  saveSessionStore,
} = await import("../src/lib/storage.ts");

assert.equal(isQuotaExceededError({ name: "QuotaExceededError" }), true);
assert.equal(isQuotaExceededError(new Error("nope")), false);

// Prove prior failure: empty sessions[] was treated as missing/invalid.
const emptyCoerced = coerceLoadedSessionStore({
  sessions: [],
  activeSessionId: null,
});
assert.ok(emptyCoerced);
assert.equal(emptyCoerced!.sessions.length, 1);
assert.ok(emptyCoerced!.activeSessionId);

stub.clear();
localStorage.setItem(
  "forknote-sessions-v1",
  JSON.stringify({ sessions: [], activeSessionId: null }),
);
const loaded = loadSessionStore();
assert.equal(loaded.sessions.length, 1, "empty array must seed one session");

stub.failWrites = true;
const write = safeLocalStorageSetItem("k", "v");
assert.equal(write.ok, false);
assert.equal(write.ok === false && write.quotaExceeded, true);

const save = saveSessionStore({
  sessions: loaded.sessions,
  activeSessionId: loaded.activeSessionId,
});
assert.equal(save.ok, false);
assert.equal(save.ok === false && save.quotaExceeded, true);

const storageSrc = readFileSync(join(root, "src/lib/storage.ts"), "utf8");
assert.match(storageSrc, /coerceLoadedSessionStore/);
assert.match(storageSrc, /safeLocalStorageSetItem/);
assert.doesNotMatch(
  storageSrc,
  /if \(parsed\.sessions\?\.length\)/,
  "must not treat empty sessions as invalid via truthy length check",
);

const storeSrc = readFileSync(join(root, "src/store/useAppStore.ts"), "utf8");
assert.match(storeSrc, /data\.storageQuotaExceeded/);
assert.match(storeSrc, /isQuotaExceededError/);

console.log("ok: empty-store + quota-guarded session writes");
