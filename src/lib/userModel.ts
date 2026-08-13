/**
 * Rule-based User Model (preferences table + confidence).
 * uncertain/unsure does not move confidence — only accept / reject do.
 */
import type { FeedbackEvent, PointVerdict, SessionFeedbackPolicy } from "../types";

export type UserPreferenceEntry = {
  prefer: string;
  confidence: number;
  samples: number;
  updatedAt: number;
};

export type UserModel = {
  preferences: Record<string, UserPreferenceEntry>;
  lastUpdated: number;
};

const CONF_MIN = 0.05;
const CONF_MAX = 0.95;

function clamp(n: number): number {
  return Math.min(CONF_MAX, Math.max(CONF_MIN, n));
}

export function emptyUserModel(): UserModel {
  return { preferences: {}, lastUpdated: Date.now() };
}

/**
 * Map a feedback event onto a preference key.
 * Decision-bound events use decisionType; point verdicts use strategyId.
 */
export function preferenceKeyForEvent(event: FeedbackEvent): string | null {
  if (event.decisionType === "plan_approval") {
    return "plan_approval.default";
  }
  if (event.decisionType === "tool_selection" && event.contextSnapshot) {
    return `tool_selection.${event.contextSnapshot.slice(0, 64)}`;
  }
  if (event.strategyId) return `strategy.${event.strategyId}`;
  return null;
}

function preferLabelFor(event: FeedbackEvent): string {
  if (event.decisionType === "plan_approval") {
    return event.signal === "accept" ? "allow_plan" : "reject_plan";
  }
  return event.contextSnapshot?.slice(0, 80) || event.strategyId || "unknown";
}

/**
 * Apply one event. unsure → no confidence change (queued for clarification later).
 */
export function applyFeedbackToUserModel(
  model: UserModel,
  event: FeedbackEvent,
): UserModel {
  if (event.signal === "unsure") {
    return model;
  }
  const key = preferenceKeyForEvent(event);
  if (!key) return model;

  const prev = model.preferences[key];
  const prefer = preferLabelFor(event);
  const samples = (prev?.samples ?? 0) + 1;
  let confidence = prev?.confidence ?? 0.5;

  if (event.signal === "accept") {
    if (!prev || prev.prefer === prefer) {
      confidence = clamp(confidence + 0.08);
    } else {
      // Preference flipped by accept of a different value.
      confidence = clamp(0.55);
    }
  } else if (event.signal === "reject") {
    if (prev && prev.prefer === prefer) {
      confidence = clamp(confidence - 0.12);
    } else {
      confidence = clamp(confidence - 0.06);
    }
  }

  return {
    preferences: {
      ...model.preferences,
      [key]: {
        prefer: event.signal === "accept" ? prefer : prev?.prefer ?? prefer,
        confidence,
        samples,
        updatedAt: event.at,
      },
    },
    lastUpdated: event.at,
  };
}

/** Derive / refresh a User Model from the session feedback log (offline-friendly). */
export function buildUserModelFromFeedbackLog(
  events: FeedbackEvent[] | null | undefined,
): UserModel {
  let model = emptyUserModel();
  for (const event of events ?? []) {
    model = applyFeedbackToUserModel(model, event);
  }
  return model;
}

/** Inject high-confidence prefs into the agent system addendum. */
export function formatUserModelForAgent(
  model: UserModel | null | undefined,
  minConfidence = 0.7,
): string | null {
  if (!model) return null;
  const lines: string[] = [];
  for (const [key, entry] of Object.entries(model.preferences)) {
    if (entry.confidence < minConfidence) continue;
    lines.push(`- ${key}: prefer ${entry.prefer} (confidence ${entry.confidence.toFixed(2)})`);
  }
  if (lines.length === 0) return null;
  return ["【User Model — stable preferences】", ...lines].join("\n");
}

/**
 * Session-scoped policy still lives in SessionFeedbackPolicy (bandit).
 * Expose a thin bridge so callers can read confidence for a strategy.
 */
export function policyConfidence(
  policy: SessionFeedbackPolicy | null | undefined,
  strategyId: string,
): number {
  return policy?.confidence?.[strategyId] ?? 0;
}

export function shouldClarifyUnsure(
  events: FeedbackEvent[],
  decisionType: NonNullable<FeedbackEvent["decisionType"]>,
  threshold = 0.4,
): boolean {
  const slice = events.filter((e) => e.decisionType === decisionType);
  if (slice.length < 5) return false;
  const unsure = slice.filter((e) => e.signal === "unsure").length;
  return unsure / slice.length >= threshold;
}

/** Map PointVerdict to policy signal naming used in docs. */
export function verdictToFeedbackLabel(
  v: PointVerdict,
): "accepted" | "uncertain" | "rejected" {
  if (v === "accept") return "accepted";
  if (v === "unsure") return "uncertain";
  return "rejected";
}
