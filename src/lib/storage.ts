import type { ChatSession, SessionStore, ThreadRoot } from "../types";
import { createId } from "./id";
import { firstUserMessage, normalizeThread } from "./thread";

const STORE_KEY = "branch-chat-sessions-v1";
const LEGACY_THREAD_KEY = "branch-chat-thread";

export function sessionTitleFromThread(thread: ThreadRoot | null): string {
  const q = firstUserMessage(thread)?.trim().replace(/\s+/g, " ");
  if (!q) return "新会话";
  return q.length > 40 ? `${q.slice(0, 40)}…` : q;
}

export function createEmptySession(): ChatSession {
  const now = Date.now();
  return {
    id: createId(),
    title: "新会话",
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

export function loadSessionStore(): SessionStore {
  try {
    const raw = localStorage.getItem(STORE_KEY);
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
}
