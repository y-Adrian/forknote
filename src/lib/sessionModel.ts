import type { ApiSettings, ChatSession } from "../types";

/** Effective model for LLM calls: session snapshot, else settings default. */
export function resolveSessionModel(
  session: ChatSession | null | undefined,
  settings: ApiSettings,
): string {
  const own = session?.model?.trim();
  if (own) return own;
  return settings.model.trim();
}

/** ApiSettings with the active session's model applied (connection fields unchanged). */
export function settingsForSession(
  settings: ApiSettings,
  session: ChatSession | null | undefined,
): ApiSettings {
  const model = resolveSessionModel(session, settings);
  if (model === settings.model.trim()) return settings;
  return { ...settings, model };
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

/** Persist model on one session without touching others. */
export function patchSessionModel(
  sessions: ChatSession[],
  sessionId: string | null,
  model: string | null,
): ChatSession[] {
  if (!sessionId) return sessions;
  const now = Date.now();
  const next = model?.trim() || null;
  return sessions.map((s) =>
    s.id === sessionId ? { ...s, model: next, updatedAt: now } : s,
  );
}
