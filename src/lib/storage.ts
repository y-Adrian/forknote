import type { ChatSession, SessionStore, ThreadRoot } from "../types";
import { createId } from "./id";
import { firstUserMessage, normalizeThread } from "./thread";

const STORE_KEY = "forknote-sessions-v1";
const LEGACY_STORE_KEY = "branch-chat-sessions-v1";
/** Pre-session-store single-thread blob (legacy storage key). */
const LEGACY_THREAD_KEY = "branch-chat-thread";

export function sessionTitleFromThread(thread: ThreadRoot | null): string {
  const q = firstUserMessage(thread)?.trim().replace(/\s+/g, " ");
  if (!q) return "Untitled";
  return q.length > 40 ? `${q.slice(0, 40)}…` : q;
}

export function createEmptySession(): ChatSession {
  const now = Date.now();
  return {
    id: createId(),
    title: "Untitled",
    titleLocked: false,
    thread: null,
    createdAt: now,
    updatedAt: now,
  };
}

function loadLegacyThread(): ThreadRoot | null {
  try {
    const raw = localStorage.getItem(LEGACY_THREAD_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ThreadRoot;
  } catch {
    return null;
  }
}

function readSessionStoreRaw(): string | null {
  const current = localStorage.getItem(STORE_KEY);
  if (current) return current;
  const legacy = localStorage.getItem(LEGACY_STORE_KEY);
  if (legacy) {
    localStorage.setItem(STORE_KEY, legacy);
    localStorage.removeItem(LEGACY_STORE_KEY);
    return legacy;
  }
  return null;
}

export function loadSessionStore(): SessionStore {
  try {
    const raw = readSessionStoreRaw();
    if (raw) {
      const parsed = JSON.parse(raw) as SessionStore;
      if (parsed.sessions?.length) {
        return {
          ...parsed,
          sessions: parsed.sessions.map((s) => ({
            ...s,
            thread: s.thread ? normalizeThread(s.thread) : null,
          })),
        };
      }
    }
  } catch {
    // fall through to migration / default
  }

  const legacy = loadLegacyThread();
  if (legacy) {
    const normalized = normalizeThread(legacy);
    const session: ChatSession = {
      id: createId(),
      title: sessionTitleFromThread(normalized),
      thread: normalized,
      createdAt: legacy.createdAt,
      updatedAt: Date.now(),
    };
    localStorage.removeItem(LEGACY_THREAD_KEY);
    const store: SessionStore = {
      sessions: [session],
      activeSessionId: session.id,
    };
    saveSessionStore(store);
    return store;
  }

  const session = createEmptySession();
  const store: SessionStore = {
    sessions: [session],
    activeSessionId: session.id,
  };
  saveSessionStore(store);
  return store;
}

export function saveSessionStore(store: SessionStore): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
  localStorage.removeItem(LEGACY_STORE_KEY);
}
