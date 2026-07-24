import type { ChatSession, NodeId, SessionStore, ThreadRoot } from "../types";

/** Persist a project binding on one session without touching others. */
export function patchSessionProject(
  sessions: ChatSession[],
  sessionId: NodeId | null,
  projectRoot: string | null,
): ChatSession[] {
  if (!sessionId) return sessions;
  const now = Date.now();
  return sessions.map((s) =>
    s.id === sessionId ? { ...s, projectRoot, updatedAt: now } : s,
  );
}

/**
 * Flush thread + project for the session being left.
 * `upsertActiveSession` keeps thread/title in sync before projectRoot is written.
 */
export function flushActiveSession(
  sessions: ChatSession[],
  activeSessionId: NodeId | null,
  thread: ThreadRoot | null,
  projectRoot: string | null,
  upsertActiveSession: (
    sessions: ChatSession[],
    activeSessionId: NodeId | null,
    thread: ThreadRoot | null,
  ) => ChatSession[],
): ChatSession[] {
  return patchSessionProject(
    upsertActiveSession(sessions, activeSessionId, thread),
    activeSessionId,
    projectRoot,
  );
}

/**
 * Move legacy global `forknote-project.lastPath` onto the active session only.
 * Sessions that already have `projectRoot` (including null) are left alone.
 */
export function migrateGlobalProjectBinding(
  store: SessionStore,
  globalPath: string,
): SessionStore {
  const path = globalPath.trim();
  if (!path) return store;

  const activeId =
    store.activeSessionId &&
    store.sessions.some((s) => s.id === store.activeSessionId)
      ? store.activeSessionId
      : store.sessions[0]?.id;

  let migrated = false;
  const sessions = store.sessions.map((s) => {
    if (s.projectRoot !== undefined) return s;
    migrated = true;
    return {
      ...s,
      projectRoot: s.id === activeId ? path : null,
    };
  });

  return migrated ? { ...store, sessions } : store;
}
