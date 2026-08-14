/**
 * Probe: destructive session import safety, validation, and migration.
 * Usage: npx tsx scripts/test-session-import-safety.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
        throw new Error("QuotaExceededError");
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

const localStorageStub = installLocalStorage();
const {
  LOCAL_STORAGE_KEYS,
  SESSION_IMPORT_BACKUP_KEY,
  captureSessionImportBackup,
  parseSessionStoreImport,
  saveSessionStore,
} = await import("../src/lib/storage.ts");

function storeJson(value: unknown): string {
  return JSON.stringify(value);
}

function validSession(id = "s1") {
  return {
    id,
    title: "Imported session",
    thread: null,
    createdAt: 1,
    updatedAt: 2,
  };
}

{
  const ui = readFileSync("src/components/SettingsPanel.tsx", "utf8");
  const fileHandler = ui.slice(
    ui.indexOf("const onImportFile"),
    ui.indexOf("const onBackupPendingImport"),
  );
  const confirmHandler = ui.slice(
    ui.indexOf("const onConfirmImport"),
    ui.indexOf("const closePendingImport"),
  );
  assert.ok(
    !fileHandler.includes("replaceSessionStore("),
    "file selection must not replace sessions before confirmation",
  );
  assert.ok(
    confirmHandler.includes("backupReady") &&
      confirmHandler.includes("replaceSessionStore(") &&
      confirmHandler.includes("data.importSaveFailed"),
    "confirmed import must require backup and surface save errors",
  );
}

{
  localStorageStub.clear();
  localStorage.setItem(
    "forknote-project",
    JSON.stringify({ lastPath: "/tmp/project", sidecarUrl: "/sidecar" }),
  );
  const migrated = parseSessionStoreImport(
    storeJson({
      sessions: [
        {
          ...validSession("legacy"),
          model: "legacy-model",
          projectRoot: undefined,
          thread: {
            id: "thread-1",
            createdAt: 10,
            userQuestion: "What changed?",
            assistantMessage: "A lot.",
            children: [],
          },
        },
      ],
      activeSessionId: "legacy",
    }),
  );
  assert.equal(migrated.sessions[0]?.api?.model, "legacy-model");
  assert.equal(migrated.sessions[0]?.model, undefined);
  assert.equal(migrated.sessions[0]?.projectRoot, "/tmp/project");
  assert.equal(migrated.sessions[0]?.thread?.messages.length, 2);
}

{
  localStorageStub.clear();
  const repaired = parseSessionStoreImport(
    storeJson({
      sessions: [
        {
          ...validSession("archived"),
          contextMode: "archive",
          activeArchiveId: "missing-archive",
          archives: [],
        },
      ],
      activeSessionId: "archived",
    }),
  );
  assert.equal(repaired.sessions[0]?.contextMode, "live");
  assert.equal(repaired.sessions[0]?.activeArchiveId, null);
}

{
  assert.throws(
    () =>
      parseSessionStoreImport(
        storeJson({
          sessions: [validSession("dup"), validSession("dup")],
          activeSessionId: "dup",
        }),
      ),
    /duplicate session id/,
  );
}

{
  assert.throws(
    () =>
      parseSessionStoreImport(
        storeJson({
          sessions: [
            {
              ...validSession("bad-thread"),
              thread: {
                id: "thread-1",
                createdAt: 1,
                messages: [
                  {
                    id: "m1",
                    role: "system",
                    content: "bad",
                    children: [],
                    createdAt: 2,
                  },
                ],
              },
            },
          ],
          activeSessionId: "bad-thread",
        }),
      ),
    /role is invalid/,
  );
}

{
  const empty = parseSessionStoreImport(
    storeJson({ sessions: [], activeSessionId: null }),
  );
  assert.equal(empty.sessions.length, 1, "empty valid imports create one empty session");
  assert.equal(empty.activeSessionId, empty.sessions[0]?.id);
}

{
  const imported = parseSessionStoreImport(
    storeJson({
      sessions: [
        {
          ...validSession("with-key"),
          api: { apiKey: "sk-imported", model: "kept-model" },
        },
      ],
      activeSessionId: "with-key",
    }),
  );
  assert.equal(imported.sessions[0]?.api?.apiKey, undefined);
  assert.equal(imported.sessions[0]?.api?.model, "kept-model");
}

{
  localStorageStub.clear();
  localStorage.setItem(
    LOCAL_STORAGE_KEYS.sessions,
    storeJson({
      sessions: [
        {
          ...validSession("current"),
          api: { apiKey: "sk-current", model: "current-model" },
        },
      ],
      activeSessionId: "current",
    }),
  );
  const backup = captureSessionImportBackup();
  assert.equal(backup.stored, true);
  assert.equal(localStorage.getItem(SESSION_IMPORT_BACKUP_KEY), backup.json);
  assert.ok(!backup.json.includes("sk-current"));
  assert.ok(backup.json.includes("current-model"));
}

{
  localStorageStub.clear();
  localStorage.setItem(
    LOCAL_STORAGE_KEYS.sessions,
    storeJson({ sessions: [validSession("current")], activeSessionId: "current" }),
  );
  localStorageStub.failWrites = true;
  const backup = captureSessionImportBackup();
  assert.equal(backup.stored, false, "backup download JSON remains available on quota error");
  const save = saveSessionStore({
    sessions: [validSession("next")],
    activeSessionId: "next",
  });
  assert.equal(save.ok, false);
  assert.equal(save.ok === false && save.quotaExceeded, true);
}

console.log("test-session-import-safety: ok");
