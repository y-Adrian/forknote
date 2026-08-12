import type {
  ArchiveSnapshot,
  ChatSession,
  ContextMode,
  ThreadView,
} from "../types";

export type ResolvedConversationContext = {
  /** Effective mode that askMain / UI must both honor */
  mode: ContextMode;
  /** Non-null only when mode === "archive" */
  archive: ArchiveSnapshot | null;
  /**
   * Persisted session asked for archive, but the archive id was missing/stale.
   * Callers should repair session meta back to live so UI and API stay aligned.
   */
  repairedToLive: boolean;
};

type SessionContextFields = Pick<
  ChatSession,
  "contextMode" | "activeArchiveId" | "archives"
>;

/**
 * Single source of truth for Full thread vs Archive context.
 * Archive is effective only when contextMode is "archive" AND the active
 * archive snapshot still exists; otherwise fall back to live (full thread).
 */
export function resolveConversationContext(
  session: SessionContextFields | null | undefined,
): ResolvedConversationContext {
  const requested = session?.contextMode ?? "live";
  if (requested !== "archive") {
    return { mode: "live", archive: null, repairedToLive: false };
  }

  const id = session?.activeArchiveId ?? null;
  if (!id) {
    return { mode: "live", archive: null, repairedToLive: true };
  }

  const archive = session?.archives?.find((a) => a.id === id) ?? null;
  if (!archive) {
    return { mode: "live", archive: null, repairedToLive: true };
  }

  return { mode: "archive", archive, repairedToLive: false };
}

/**
 * What the main pane shows. Archive send-mode defaults to the archive
 * document; live mode always shows the full evolution record.
 */
export function resolveThreadView(
  session: Pick<ChatSession, "threadView"> | null | undefined,
  mode: ContextMode,
): ThreadView {
  if (mode !== "archive") return "evolution";
  return session?.threadView === "evolution" ? "evolution" : "archive";
}
