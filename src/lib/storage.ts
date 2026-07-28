import type { ChatSession, SessionStore, ThreadRoot } from "../types";
import { resolveConversationContext } from "./conversationContext";
import { createId } from "./id";
import { t } from "./i18n";
import { loadProjectPrefs } from "./project";
import { migrateSessionApiFields } from "./sessionApi";
import { migrateGlobalProjectBinding } from "./sessionProject";
import { firstUserMessage, normalizeThread } from "./thread";

const STORE_KEY = "forknote-sessions-v1";
const LEGACY_STORE_KEY = "branch-chat-sessions-v1";
/** Pre-session-store single-thread blob (legacy storage key). */
const LEGACY_THREAD_KEY = "branch-chat-thread";

/**
 * English storage sentinel for empty / default session titles.
 * Display via {@link displaySessionTitle} so locale can show 未命名 / Untitled.
 */
export const DEFAULT_SESSION_TITLE = "Untitled";

/** True when title is empty or the default sentinel (any known locale string). */
export function isDefaultSessionTitle(title: string): boolean {
  const trimmed = title.trim();
  if (!trimmed || trimmed === DEFAULT_SESSION_TITLE) return true;
  return (
    trimmed === t("main.untitled", undefined, "en") ||
    trimmed === t("main.untitled", undefined, "zh")
  );
}

/** Locale-aware label for sidebar / UI; keeps storage on the English sentinel. */
export function displaySessionTitle(title: string): string {
  return isDefaultSessionTitle(title) ? t("main.untitled") : title;
}

/**
 * Normalize rename / user input back to the storage sentinel when it matches
 * a localized default, so language switches keep working.
 */
export function normalizeStoredSessionTitle(title: string): string {
  const trimmed = title.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  if (isDefaultSessionTitle(trimmed)) return DEFAULT_SESSION_TITLE;
  return trimmed;
}

export function sessionTitleFromThread(thread: ThreadRoot | null): string {
  const q = firstUserMessage(thread)?.trim().replace(/\s+/g, " ");
  if (!q) return DEFAULT_SESSION_TITLE;
  return q.length > 40 ? `${q.slice(0, 40)}…` : q;
}

export function createEmptySession(): ChatSession {
  const now = Date.now();
  return {
    id: createId(),
    title: DEFAULT_SESSION_TITLE,
    titleLocked: false,
    thread: null,
    projectRoot: null,
    api: null,
    createdAt: now,
    updatedAt: now,
  };
}

function migrateLoadedStore(store: SessionStore): SessionStore {
  return migrateGlobalProjectBinding(store, loadProjectPrefs().lastPath);
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
        const store = migrateLoadedStore({
          ...parsed,
          sessions: parsed.sessions.map((s) => {
            const thread = s.thread ? normalizeThread(s.thread) : null;
            const base = migrateSessionApiFields({ ...s, thread });
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
    const store: SessionStore = migrateLoadedStore({
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

/** Skip session-delete confirmation after user opts in. */
export const SKIP_SESSION_DELETE_CONFIRM_KEY =
  "forknote-skip-session-delete-confirm";

/** Keys ForkNote writes to localStorage (for Data settings UI). */
export const LOCAL_STORAGE_KEYS = {
  sessions: STORE_KEY,
  settings: "forknote-settings",
  project: "forknote-project",
  theme: "forknote-theme",
  locale: "forknote-locale",
  uiFont: "forknote-ui-font",
  userPreferences: "forknote-user-preferences",
  recentFiles: "forknote-recent-files",
  skipSessionDeleteConfirm: SKIP_SESSION_DELETE_CONFIRM_KEY,
} as const;

export function getSkipSessionDeleteConfirm(): boolean {
  try {
    return localStorage.getItem(SKIP_SESSION_DELETE_CONFIRM_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSkipSessionDeleteConfirm(skip: boolean): void {
  try {
    if (skip) {
      localStorage.setItem(SKIP_SESSION_DELETE_CONFIRM_KEY, "1");
    } else {
      localStorage.removeItem(SKIP_SESSION_DELETE_CONFIRM_KEY);
    }
  } catch {
    // ignore quota / private mode
  }
}

export function exportSessionStoreJson(): string {
  const store = loadSessionStore();
  return JSON.stringify(store, null, 2);
}

export function parseSessionStoreImport(raw: string): SessionStore {
  const parsed = JSON.parse(raw) as Partial<SessionStore>;
  if (!parsed || !Array.isArray(parsed.sessions)) {
    throw new Error("Invalid backup: missing sessions array");
  }
  const sessions = parsed.sessions.map((s) =>
    migrateSessionApiFields({
      ...s,
      thread: s.thread ? normalizeThread(s.thread) : null,
    }),
  );
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
