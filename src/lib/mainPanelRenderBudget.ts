/**
 * Section boundaries for MainPanel store subscriptions.
 * Message list must not depend on composer `input` so typing stays local.
 */

export const MAIN_PANEL_MESSAGE_LIST_STORE_KEYS = [
  "thread",
  "loadingMainBySession",
  "loadingArchiveSessionId",
  "loadingBranchBySession",
  "agentPendingPlan",
  "archiveDraft",
  "archiveAlreadyCurrent",
  "error",
] as const;

export const MAIN_PANEL_COMPOSER_STORE_KEYS = [
  "pendingClarifyBySession",
  "pendingFileIncludes",
  "projectRoot",
  "sidecarUrl",
  "loadingMainBySession",
  "loadingArchiveSessionId",
  "loadingCompressSessionId",
  "loadingBranchBySession",
] as const;

export function changedPropKeys(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  return [...keys].filter((k) => !Object.is(prev[k], next[k]));
}

/** Typing only changes composer input — message-list props must stay identical. */
export function messageListPropsStableAcrossTyping(
  beforeTyping: Record<string, unknown>,
  afterTyping: Record<string, unknown>,
): boolean {
  if ("input" in beforeTyping || "input" in afterTyping) return false;
  return changedPropKeys(beforeTyping, afterTyping).length === 0;
}

/**
 * During streaming, only the tail message identity/content should change.
 * Prior rows keep the same message object reference when the store updates
 * immutably.
 */
export function countStableMessageRows(
  prev: ReadonlyArray<{ id: string }>,
  next: ReadonlyArray<{ id: string }>,
): { stable: number; changed: number } {
  const nextById = new Map(next.map((m) => [m.id, m]));
  let stable = 0;
  let changed = 0;
  for (const m of prev) {
    const n = nextById.get(m.id);
    if (!n) {
      changed += 1;
      continue;
    }
    if (Object.is(m, n)) stable += 1;
    else changed += 1;
  }
  for (const m of next) {
    if (!prev.some((p) => p.id === m.id)) changed += 1;
  }
  return { stable, changed };
}
