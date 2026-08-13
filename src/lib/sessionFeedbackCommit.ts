import type { ChatSession, FeedbackEvent, NodeId } from "../types";
import { commitFeedbackEvent, inferStrategyId } from "./policy";

export type SessionFeedbackSnapshot = {
  sessions: ChatSession[];
  activeSessionId: NodeId | null;
};

export type SessionFeedbackCommitEffects = {
  persistSessions: (
    sessions: ChatSession[],
    activeSessionId: NodeId | null,
  ) => void;
  persistUserModel: (event: FeedbackEvent) => void;
};

export type SessionFeedbackCommitResult = SessionFeedbackSnapshot & {
  committed: boolean;
};

function alreadyCommitted(
  feedbackLog: FeedbackEvent[] | undefined,
  event: FeedbackEvent,
): boolean {
  if (feedbackLog?.some((existing) => existing.id === event.id)) return true;
  if (event.decisionType !== "plan_approval" || !event.decisionId) return false;
  return Boolean(
    feedbackLog?.some(
      (existing) =>
        existing.decisionType === "plan_approval" &&
        existing.decisionId === event.decisionId,
    ),
  );
}

/** Apply feedback to one explicit session without consulting active UI state. */
export function applySessionFeedbackOnce(
  sessions: ChatSession[],
  targetSessionId: NodeId,
  event: FeedbackEvent,
  strategyContent = "",
): { sessions: ChatSession[]; committed: boolean } {
  const target = sessions.find((session) => session.id === targetSessionId);
  if (!target || alreadyCommitted(target.feedbackLog, event)) {
    return { sessions, committed: false };
  }

  const strategyId = inferStrategyId(strategyContent);
  const next = commitFeedbackEvent(
    target.feedbackLog,
    target.feedbackPolicy,
    event,
    strategyId,
  );
  return {
    committed: true,
    sessions: sessions.map((session) =>
      session.id === targetSessionId
        ? {
            ...session,
            feedbackLog: next.feedbackLog,
            feedbackPolicy: next.feedbackPolicy,
            updatedAt: Date.now(),
          }
        : session,
    ),
  };
}

/**
 * Commit session feedback and both persistence effects from one captured
 * snapshot. The active id is persisted verbatim and never retargets the event.
 */
export function commitSessionFeedbackSnapshot(
  snapshot: SessionFeedbackSnapshot,
  targetSessionId: NodeId,
  event: FeedbackEvent,
  effects: SessionFeedbackCommitEffects,
  strategyContent = "",
): SessionFeedbackCommitResult {
  const next = applySessionFeedbackOnce(
    snapshot.sessions,
    targetSessionId,
    event,
    strategyContent,
  );
  if (!next.committed) {
    return { ...snapshot, committed: false };
  }

  effects.persistUserModel(event);
  effects.persistSessions(next.sessions, snapshot.activeSessionId);
  return {
    sessions: next.sessions,
    activeSessionId: snapshot.activeSessionId,
    committed: true,
  };
}
