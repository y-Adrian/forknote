import type { ChatSession, SessionStore, ThreadRoot } from "../types";
import { resolveConversationContext } from "./conversationContext";
import { createId } from "./id";
import { loadProjectPrefs } from "./project";
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
    projectRoot: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Move legacy global project binding onto the active session (once). */
function migrateGlobalProjectBinding(store: SessionStore): SessionStore {
  const globalPath = loadProjectPrefs().lastPath.trim();
  if (!globalPath) return store;

  const activeId =
    store.activeSessionId && store.sessions.some((s) => s.id === store.activeSessionId)
      ? store.activeSessionId
      : store.sessions[0]?.id;

  let migrated = false;
  const sessions = store.sessions.map((s) => {
    if (s.projectRoot !== undefined) return s;
    migrated = true;
    return {
      ...s,
      projectRoot: s.id === activeId ? globalPath : null,
    };
  });

  return migrated ? { ...store, sessions } : store;
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
        const store = migrateGlobalProjectBinding({
          ...parsed,
          sessions: parsed.sessions.map((s) => {
            const thread = s.thread ? normalizeThread(s.thread) : null;
            const base = { ...s, thread };
            // Drop stale archive mode so UI "Full thread" matches askMain
            const resolved = resolveConversationContext(base);
            if (resolved.repairedToLive) {
              return {
                ...base,
                contextMode: "live" as const,
                activeArchiveId: null,
              };
            }
            return base;
          }),
        });
        return store;
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
    const store: SessionStore = migrateGlobalProjectBinding({
      sessions: [session],
      activeSessionId: session.id,
    });
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

/** Keys ForkNote writes to localStorage (for Data settings UI). */
export const LOCAL_STORAGE_KEYS = {
  sessions: STORE_KEY,
  settings: "forknote-settings",
  project: "forknote-project",
  theme: "forknote-theme",
  locale: "forknote-locale",
} as const;

export function exportSessionStoreJson(): string {
  const store = loadSessionStore();
  return JSON.stringify(store, null, 2);
}

export function parseSessionStoreImport(raw: string): SessionStore {
  const parsed = JSON.parse(raw) as Partial<SessionStore>;
  if (!parsed || !Array.isArray(parsed.sessions)) {
    throw new Error("Invalid backup: missing sessions array");
  }
  const sessions = parsed.sessions.map((s) => ({
    ...s,
    thread: s.thread ? normalizeThread(s.thread) : null,
  }));
  if (sessions.length === 0) {
    const session = createEmptySession();
    return { sessions: [session], activeSessionId: session.id };
  }
  const activeSessionId =
    (parsed.activeSessionId &&
      sessions.some((s) => s.id === parsed.activeSessionId) &&
      parsed.activeSessionId) ||
    sessions[0].id;
  return { sessions, activeSessionId };
}
