import type { ApiSettings, ChatSession, SessionApiOverride } from "../types";

/** Connection/model fields that a session may override. */
export const SESSION_API_KEYS = [
  "baseUrl",
  "apiKey",
  "model",
  "useProxy",
] as const;

export type SessionApiKey = (typeof SESSION_API_KEYS)[number];

export type ApiConnectionFields = Pick<
  ApiSettings,
  "baseUrl" | "apiKey" | "model" | "useProxy"
>;

function trimOrEmpty(value: string | undefined | null): string {
  return (value ?? "").trim();
}

/** Drop empty / undefined override entries so missing means inherit. */
export function normalizeSessionApi(
  raw: SessionApiOverride | null | undefined,
): SessionApiOverride | null {
  if (!raw || typeof raw !== "object") return null;
  const next: SessionApiOverride = {};
  if (raw.baseUrl !== undefined) {
    const v = trimOrEmpty(raw.baseUrl);
    if (v) next.baseUrl = v;
  }
  if (raw.apiKey !== undefined) {
    // Allow explicit empty string to clear inherited key for local endpoints
    next.apiKey = String(raw.apiKey);
  }
  if (raw.model !== undefined) {
    const v = trimOrEmpty(raw.model);
    if (v) next.model = v;
  }
  if (raw.useProxy !== undefined) {
    next.useProxy = Boolean(raw.useProxy);
  }
  return Object.keys(next).length > 0 ? next : null;
}

/**
 * Migrate legacy top-level `model` into `api.model`.
 * Prefer existing `api` when present; fold legacy model only if api.model missing.
 */
export function migrateSessionApiFields(session: ChatSession): ChatSession {
  const legacyModel =
    typeof session.model === "string" ? session.model.trim() : "";
  let api = normalizeSessionApi(session.api);
  if (legacyModel && !api?.model) {
    api = normalizeSessionApi({ ...(api ?? {}), model: legacyModel });
  }
  const { model: _legacy, ...rest } = session;
  return { ...rest, api };
}

export function hasSessionApiOverride(
  session: ChatSession | null | undefined,
): boolean {
  return Boolean(normalizeSessionApi(session?.api));
}

/** Effective connection settings for LLM calls. */
export function resolveSessionApi(
  session: ChatSession | null | undefined,
  settings: ApiSettings,
): ApiConnectionFields {
  const own = normalizeSessionApi(session?.api);
  return {
    baseUrl:
      own?.baseUrl !== undefined
        ? trimOrEmpty(own.baseUrl)
        : settings.baseUrl.trim(),
    apiKey:
      own?.apiKey !== undefined ? String(own.apiKey) : settings.apiKey,
    model:
      own?.model !== undefined
        ? trimOrEmpty(own.model)
        : settings.model.trim(),
    useProxy:
      own?.useProxy !== undefined ? Boolean(own.useProxy) : settings.useProxy,
  };
}

/** Effective model id (sidebar / composer label). */
export function resolveSessionModel(
  session: ChatSession | null | undefined,
  settings: ApiSettings,
): string {
  return resolveSessionApi(session, settings).model;
}

/** Full ApiSettings with session connection overrides applied. */
export function settingsForSession(
  settings: ApiSettings,
  session: ChatSession | null | undefined,
): ApiSettings {
  const resolved = resolveSessionApi(session, settings);
  if (
    resolved.baseUrl === settings.baseUrl.trim() &&
    resolved.apiKey === settings.apiKey &&
    resolved.model === settings.model.trim() &&
    resolved.useProxy === settings.useProxy
  ) {
    return settings;
  }
  return { ...settings, ...resolved };
}

/**
 * Diff draft against global settings → only store true overrides.
 * Matching globals are omitted (inherit). Empty result → null (clear).
 */
export function overridesFromDraft(
  draft: ApiConnectionFields,
  settings: ApiSettings,
): SessionApiOverride | null {
  const next: SessionApiOverride = {};
  const baseUrl = draft.baseUrl.trim();
  const model = draft.model.trim();
  const apiKey = draft.apiKey;
  const useProxy = Boolean(draft.useProxy);

  if (baseUrl !== settings.baseUrl.trim()) next.baseUrl = baseUrl;
  if (apiKey !== settings.apiKey) next.apiKey = apiKey;
  if (model !== settings.model.trim()) next.model = model;
  if (useProxy !== settings.useProxy) next.useProxy = useProxy;

  return normalizeSessionApi(next);
}

/** Short label for sidebar rows (keep provider prefix when short). */
export function truncateModelLabel(model: string, max = 22): string {
  const trimmed = model.trim();
  if (!trimmed) return "";
  if (trimmed.length <= max) return trimmed;
  const slash = trimmed.lastIndexOf("/");
  if (slash >= 0 && trimmed.length - slash - 1 >= 6) {
    const leaf = trimmed.slice(slash + 1);
    if (leaf.length <= max) return leaf;
    return `${leaf.slice(0, Math.max(1, max - 1))}…`;
  }
  return `${trimmed.slice(0, Math.max(1, max - 1))}…`;
}

/** Persist API overrides on one session without touching others. */
export function patchSessionApi(
  sessions: ChatSession[],
  sessionId: string | null,
  api: SessionApiOverride | null,
): ChatSession[] {
  if (!sessionId) return sessions;
  const now = Date.now();
  const normalized = normalizeSessionApi(api);
  return sessions.map((s) => {
    if (s.id !== sessionId) return s;
    const { model: _drop, ...rest } = s;
    return { ...rest, api: normalized, updatedAt: now };
  });
}

/** Clear overrides → inherit system defaults live. */
export function clearSessionApi(
  sessions: ChatSession[],
  sessionId: string | null,
): ChatSession[] {
  return patchSessionApi(sessions, sessionId, null);
}
