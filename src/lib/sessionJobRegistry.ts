/**
 * Owns at most one job per session.
 *
 * Different sessions may run concurrently. Starting a replacement aborts only
 * the prior job for that session, and identity-checked release prevents a stale
 * completion from clearing its replacement.
 */
export class SessionJobRegistry {
  private readonly controllers = new Map<string, AbortController>();

  start(sessionId: string): AbortController {
    this.abort(sessionId);
    const controller = new AbortController();
    this.controllers.set(sessionId, controller);
    return controller;
  }

  owns(sessionId: string, controller: AbortController): boolean {
    return (
      this.controllers.get(sessionId) === controller &&
      !controller.signal.aborted
    );
  }

  release(sessionId: string, controller: AbortController): boolean {
    if (this.controllers.get(sessionId) !== controller) return false;
    this.controllers.delete(sessionId);
    return true;
  }

  abort(sessionId: string): boolean {
    const controller = this.controllers.get(sessionId);
    if (!controller) return false;
    controller.abort();
    this.controllers.delete(sessionId);
    return true;
  }

  abortAll(): void {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }

  has(sessionId: string): boolean {
    return this.controllers.has(sessionId);
  }
}

export function resolveSessionJobTarget(
  activeSessionId: string | null,
  requestedSessionId?: string,
): string | null {
  return requestedSessionId ?? activeSessionId;
}

export function projectSessionJobUi(
  activeSessionId: string | null,
  archiveJobs: Record<string, boolean>,
  compressJobs: Record<string, boolean>,
  archiveDrafts: Record<string, string>,
): {
  loadingArchiveSessionId: string | null;
  loadingCompressSessionId: string | null;
  archiveDraft: string;
} {
  return {
    loadingArchiveSessionId:
      activeSessionId && archiveJobs[activeSessionId]
        ? activeSessionId
        : null,
    loadingCompressSessionId:
      activeSessionId && compressJobs[activeSessionId]
        ? activeSessionId
        : null,
    archiveDraft: activeSessionId ? archiveDrafts[activeSessionId] ?? "" : "",
  };
}
