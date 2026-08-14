import type {
  ChatSession,
  SessionApiOverride,
  SessionStore,
  ThreadRoot,
} from "../types";
import {
  safeLocalStorageRemoveItem,
  safeLocalStorageSetItem,
  type StorageWriteResult,
} from "./browserStorage";
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
const STREAM_STORE_WRITE_DEBOUNCE_MS = 250;
const STREAM_STORE_WRITE_MAX_WAIT_MS = 1000;

let pendingSessionStore: SessionStore | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;

function clearSessionStoreTimers(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (maxWaitTimer) {
    clearTimeout(maxWaitTimer);
    maxWaitTimer = null;
  }
}

function writeSessionStore(store: SessionStore): StorageWriteResult {
  const result = safeLocalStorageSetItem(STORE_KEY, JSON.stringify(store));
  if (result.ok) {
    safeLocalStorageRemoveItem(LEGACY_STORE_KEY);
  }
  return result;
}

function tryFlushScheduledSessionStoreSave(reason: string): void {
  try {
    flushScheduledSessionStoreSave();
  } catch (e) {
    console.warn(`[ForkNote] scheduled session flush failed (${reason})`, e);
  }
}

function installScheduledSessionStoreFlush(): void {
  if (typeof window === "undefined") return;
  const flush = () => tryFlushScheduledSessionStoreSave("page lifecycle");
  window.addEventListener("beforeunload", flush);
  window.addEventListener("pagehide", flush);
}

installScheduledSessionStoreFlush();

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

function normalizeLoadedSession(session: ChatSession): ChatSession {
  const thread = session.thread ? normalizeThread(session.thread) : null;
  const base = migrateSessionApiFields({ ...session, thread });
  // Drop stale archive mode so UI "Full thread" matches askMain.
  const resolved = resolveConversationContext(base);
  if (resolved.repairedToLive) {
    return {
      ...base,
      contextMode: "live" as const,
      activeArchiveId: null,
    };
  }
  return base;
}

function normalizeLoadedStore(store: SessionStore): SessionStore {
  return migrateLoadedStore({
    ...store,
    sessions: store.sessions.map(normalizeLoadedSession),
  });
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
    const moved = safeLocalStorageSetItem(STORE_KEY, legacy);
    if (moved.ok) safeLocalStorageRemoveItem(LEGACY_STORE_KEY);
    return legacy;
  }
  return null;
}

/**
 * A parsed store is valid when `sessions` is an array — including empty.
 * Empty arrays are seeded with one blank session (same as import).
 */
export function coerceLoadedSessionStore(
  parsed: SessionStore,
): SessionStore | null {
  if (!parsed || !Array.isArray(parsed.sessions)) return null;
  if (parsed.sessions.length === 0) {
    const session = createEmptySession();
    return { sessions: [session], activeSessionId: session.id };
  }
  return normalizeLoadedStore(parsed);
}

export function loadSessionStore(): SessionStore {
  try {
    const raw = readSessionStoreRaw();
    if (raw) {
      const parsed = JSON.parse(raw) as SessionStore;
      const coerced = coerceLoadedSessionStore(parsed);
      if (coerced) {
        // Persist seeded empty → one-session stores so the next load is stable.
        if (parsed.sessions.length === 0) {
          saveSessionStore(coerced);
        }
        return coerced;
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
    safeLocalStorageRemoveItem(LEGACY_THREAD_KEY);
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

export function saveSessionStore(store: SessionStore): StorageWriteResult {
  pendingSessionStore = null;
  clearSessionStoreTimers();
  return writeSessionStore(store);
}

export function scheduleSessionStoreSave(store: SessionStore): void {
  pendingSessionStore = store;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(
    () => tryFlushScheduledSessionStoreSave("debounce"),
    STREAM_STORE_WRITE_DEBOUNCE_MS,
  );
  maxWaitTimer ??= setTimeout(
    () => tryFlushScheduledSessionStoreSave("max-wait"),
    STREAM_STORE_WRITE_MAX_WAIT_MS,
  );
}

export function flushScheduledSessionStoreSave(): boolean {
  const store = pendingSessionStore;
  if (!store) {
    clearSessionStoreTimers();
    return false;
  }
  pendingSessionStore = null;
  clearSessionStoreTimers();
  const result = writeSessionStore(store);
  if (!result.ok) {
    // Keep the payload so a later flush / immediate save can retry.
    pendingSessionStore = store;
    throw Object.assign(new Error(result.message), {
      name: result.quotaExceeded ? "QuotaExceededError" : "StorageWriteError",
      quotaExceeded: result.quotaExceeded,
    });
  }
  return true;
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
  userModel: "forknote-user-model-v1",
  recentFiles: "forknote-recent-files",
  skipSessionDeleteConfirm: SKIP_SESSION_DELETE_CONFIRM_KEY,
  mainThreadViewMode: "forknote-main-thread-view-mode",
} as const;

export function getSkipSessionDeleteConfirm(): boolean {
  try {
    return localStorage.getItem(SKIP_SESSION_DELETE_CONFIRM_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSkipSessionDeleteConfirm(skip: boolean): void {
  if (skip) {
    safeLocalStorageSetItem(SKIP_SESSION_DELETE_CONFIRM_KEY, "1");
  } else {
    safeLocalStorageRemoveItem(SKIP_SESSION_DELETE_CONFIRM_KEY);
  }
}

/** Drop session API keys from a backup payload (never write secrets to export files). */
export function redactSessionApiForExport(
  api: SessionApiOverride | null | undefined,
): SessionApiOverride | null | undefined {
  if (api == null) return api;
  const { apiKey: _omit, ...rest } = api;
  return Object.keys(rest).length > 0 ? rest : null;
}

export function sanitizeSessionStoreForExport(store: SessionStore): SessionStore {
  return {
    ...store,
    sessions: store.sessions.map(
      (s: ChatSession): ChatSession => ({
        ...s,
        api: redactSessionApiForExport(s.api),
      }),
    ),
  };
}

export function exportSessionStoreJson(): string {
  const store = sanitizeSessionStoreForExport(loadSessionStore());
  return JSON.stringify(store, null, 2);
}

export const SESSION_IMPORT_BACKUP_KEY = "forknote-session-import-backup-v1";

export type SessionImportSummary = {
  count: number;
  activeTitle: string;
  source: string;
};

export type SessionImportBackup = {
  json: string;
  stored: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Invalid backup: ${label} must be an object`);
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid backup: ${label} is required`);
  }
  return value;
}

function requireStringValue(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid backup: ${label} is required`);
  }
  return value;
}

function requireTimestamp(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid backup: ${label} must be a valid timestamp`);
  }
  return value;
}

function rejectDuplicateId(ids: Set<string>, id: string, label: string): void {
  if (ids.has(id)) {
    throw new Error(`Invalid backup: duplicate ${label} id "${id}"`);
  }
  ids.add(id);
}

function validateBranchNode(
  raw: unknown,
  ids: Set<string>,
  label: string,
): void {
  const node = requireRecord(raw, label);
  const id = requireString(node.id, `${label}.id`);
  rejectDuplicateId(ids, id, "thread node");
  requireString(node.parentId, `${label}.parentId`);
  requireStringValue(node.userQuestion, `${label}.userQuestion`);
  requireStringValue(node.assistantMessage, `${label}.assistantMessage`);
  requireTimestamp(node.createdAt, `${label}.createdAt`);

  const anchor = requireRecord(node.anchor, `${label}.anchor`);
  if (
    typeof anchor.startOffset !== "number" ||
    typeof anchor.endOffset !== "number" ||
    !Number.isFinite(anchor.startOffset) ||
    !Number.isFinite(anchor.endOffset) ||
    anchor.startOffset < 0 ||
    anchor.endOffset < anchor.startOffset
  ) {
    throw new Error(`Invalid backup: ${label}.anchor offsets are invalid`);
  }
  requireString(anchor.quotedText, `${label}.anchor.quotedText`);

  if (!Array.isArray(node.children)) {
    throw new Error(`Invalid backup: ${label}.children must be an array`);
  }
  node.children.forEach((child, index) =>
    validateBranchNode(child, ids, `${label}.children[${index}]`),
  );

  if (node.replies !== undefined) {
    if (!Array.isArray(node.replies)) {
      throw new Error(`Invalid backup: ${label}.replies must be an array`);
    }
    node.replies.forEach((replyRaw, index) => {
      const reply = requireRecord(replyRaw, `${label}.replies[${index}]`);
      requireStringValue(reply.userQuestion, `${label}.replies[${index}].userQuestion`);
      requireStringValue(
        reply.assistantMessage,
        `${label}.replies[${index}].assistantMessage`,
      );
      requireTimestamp(reply.createdAt, `${label}.replies[${index}].createdAt`);
    });
  }
}

function validateThread(raw: unknown, ids: Set<string>, label: string): void {
  const thread = requireRecord(raw, label);
  const id = requireString(thread.id, `${label}.id`);
  rejectDuplicateId(ids, id, "thread node");
  requireTimestamp(thread.createdAt, `${label}.createdAt`);

  if (thread.messages !== undefined) {
    if (!Array.isArray(thread.messages)) {
      throw new Error(`Invalid backup: ${label}.messages must be an array`);
    }
    thread.messages.forEach((messageRaw, index) => {
      const message = requireRecord(messageRaw, `${label}.messages[${index}]`);
      const messageId = requireString(message.id, `${label}.messages[${index}].id`);
      rejectDuplicateId(ids, messageId, "thread node");
      if (message.role !== "user" && message.role !== "assistant") {
        throw new Error(`Invalid backup: ${label}.messages[${index}].role is invalid`);
      }
      if (typeof message.content !== "string") {
        throw new Error(
          `Invalid backup: ${label}.messages[${index}].content is required`,
        );
      }
      requireTimestamp(message.createdAt, `${label}.messages[${index}].createdAt`);
      if (message.children !== undefined && !Array.isArray(message.children)) {
        throw new Error(
          `Invalid backup: ${label}.messages[${index}].children must be an array`,
        );
      }
      (message.children ?? []).forEach((child: unknown, childIndex: number) =>
        validateBranchNode(
          child,
          ids,
          `${label}.messages[${index}].children[${childIndex}]`,
        ),
      );
    });
    return;
  }

  if (
    thread.userQuestion !== undefined &&
    typeof thread.userQuestion !== "string"
  ) {
    throw new Error(`Invalid backup: ${label}.userQuestion must be a string`);
  }
  if (
    thread.assistantMessage !== undefined &&
    typeof thread.assistantMessage !== "string"
  ) {
    throw new Error(`Invalid backup: ${label}.assistantMessage must be a string`);
  }
  if (thread.children !== undefined) {
    if (!Array.isArray(thread.children)) {
      throw new Error(`Invalid backup: ${label}.children must be an array`);
    }
    thread.children.forEach((child, index) =>
      validateBranchNode(child, ids, `${label}.children[${index}]`),
    );
  }
}

function validateImportStoreShape(parsed: unknown): asserts parsed is SessionStore {
  const store = requireRecord(parsed, "root");
  if (!Array.isArray(store.sessions)) {
    throw new Error("Invalid backup: missing sessions array");
  }
  if (
    store.activeSessionId !== null &&
    store.activeSessionId !== undefined &&
    typeof store.activeSessionId !== "string"
  ) {
    throw new Error("Invalid backup: activeSessionId must be a string or null");
  }

  const sessionIds = new Set<string>();
  store.sessions.forEach((sessionRaw, index) => {
    const session = requireRecord(sessionRaw, `sessions[${index}]`);
    const id = requireString(session.id, `sessions[${index}].id`);
    rejectDuplicateId(sessionIds, id, "session");
    if (typeof session.title !== "string") {
      throw new Error(`Invalid backup: sessions[${index}].title is required`);
    }
    requireTimestamp(session.createdAt, `sessions[${index}].createdAt`);
    requireTimestamp(session.updatedAt, `sessions[${index}].updatedAt`);
    if (session.thread !== null && session.thread !== undefined) {
      validateThread(session.thread, new Set<string>(), `sessions[${index}].thread`);
    }
  });
}

function stripImportedApiKeys(store: SessionStore): SessionStore {
  return {
    ...store,
    sessions: store.sessions.map((session) => ({
      ...session,
      api: redactSessionApiForExport(session.api),
    })),
  };
}

export function parseSessionStoreImport(raw: string): SessionStore {
  const parsed = JSON.parse(raw) as unknown;
  validateImportStoreShape(parsed);
  const normalized = stripImportedApiKeys(normalizeLoadedStore(parsed));
  const sessions = normalized.sessions;
  if (sessions.length === 0) {
    const session = createEmptySession();
    return { sessions: [session], activeSessionId: session.id };
  }
  const activeSessionId =
    (normalized.activeSessionId &&
      sessions.some((s) => s.id === normalized.activeSessionId) &&
      normalized.activeSessionId) ||
    sessions[0].id;
  return { sessions, activeSessionId };
}

export function summarizeSessionStoreImport(
  store: SessionStore,
  source: string,
): SessionImportSummary {
  const active =
    store.sessions.find((s) => s.id === store.activeSessionId) ??
    store.sessions[0];
  return {
    count: store.sessions.length,
    activeTitle: displaySessionTitle(active?.title ?? DEFAULT_SESSION_TITLE),
    source: source.trim() || "JSON file",
  };
}

export function captureSessionImportBackup(): SessionImportBackup {
  const json = exportSessionStoreJson();
  let stored = false;
  try {
    const result = safeLocalStorageSetItem(SESSION_IMPORT_BACKUP_KEY, json);
    stored = result.ok;
  } catch {
    stored = false;
  }
  return { json, stored };
}
