/**
 * IndexedDB storage for Agent loop traces, keyed by the assistant reply id.
 * Keeps the newest MAX_STORED_TRACES; every call is a no-op without IndexedDB.
 */
import type { AgentTrace } from "./agentTrace";

export const MAX_STORED_TRACES = 30;
const DB_NAME = "forknote-agent-traces";
const STORE = "traces";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function saveAgentTrace(trace: AgentTrace): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.put(trace);
    // Prune: walk oldest-first and delete beyond the cap.
    const countReq = store.count();
    countReq.onsuccess = () => {
      let excess = countReq.result - MAX_STORED_TRACES;
      if (excess <= 0) return;
      const cursorReq = store.index("updatedAt").openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || excess <= 0) return;
        if (cursor.primaryKey !== trace.id) {
          cursor.delete();
          excess -= 1;
        }
        cursor.continue();
      };
    };
    await done(tx);
  } catch {
    /* tracing must never break a turn */
  }
}

export async function getAgentTrace(id: string): Promise<AgentTrace | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    return await new Promise((resolve) => {
      req.onsuccess = () => resolve((req.result as AgentTrace | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}
