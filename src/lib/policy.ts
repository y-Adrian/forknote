import {
  ATTRIBUTION_AGENT_LABEL,
  POLICY_LEARNING_RATE,
  WEIGHT_SILENT_DEFAULT,
  appendFeedbackEvent,
  feedbackWeightFor,
  pickHypothesisAttribution,
} from "./feedback";
import type {
  FeedbackAttribution,
  FeedbackEvent,
  SessionFeedbackPolicy,
} from "../types";

export const DEFAULT_POLICY_WEIGHT = 0.5;
export const POLICY_WEIGHT_MIN = 0.05;
export const POLICY_WEIGHT_MAX = 0.95;

/** Content-class strategy ids (same vocabulary as attributions for simplicity). */
export type StrategyId = FeedbackAttribution | "default";

export function emptyFeedbackPolicy(): SessionFeedbackPolicy {
  return { weights: {}, confidence: {}, updatedAt: Date.now() };
}

export function clampPolicyWeight(n: number): number {
  return Math.min(POLICY_WEIGHT_MAX, Math.max(POLICY_WEIGHT_MIN, n));
}

/** Infer which approach class this answer point used (no chat-Agent call). */
export function inferStrategyId(content: string): StrategyId {
  if (!content.trim()) return "default";
  return pickHypothesisAttribution(content);
}

export function strategyLabel(id: StrategyId): string {
  if (id === "default") return "通用策略";
  return ATTRIBUTION_AGENT_LABEL[id] ?? id;
}

function directionFor(event: FeedbackEvent): number {
  if (event.source === "hypothesis_deny") return 0;
  if (event.signal === "accept") return 1;
  if (event.signal === "reject") return -1;
  if (event.signal === "unsure") return 0;
  return 0;
}

/**
 * score[strategy] += learning_rate * signal_weight * (adopted ? 1 : -1)
 * Unsure → confidence decay on that strategy/topic (not a strong ±).
 */
export function applyFeedbackToPolicy(
  policy: SessionFeedbackPolicy | undefined,
  event: FeedbackEvent,
  strategyId: StrategyId = "default",
): SessionFeedbackPolicy {
  const next: SessionFeedbackPolicy = {
    weights: { ...(policy?.weights ?? {}) },
    confidence: { ...(policy?.confidence ?? {}) },
    updatedAt: Date.now(),
  };

  const weight =
    event.weight ??
    (event.source === "passive_copy"
      ? feedbackWeightFor("passive_use")
      : feedbackWeightFor(event.signal));

  const dir = directionFor(event);
  if (dir !== 0 && weight > 0) {
    const prev = next.weights[strategyId] ?? DEFAULT_POLICY_WEIGHT;
    next.weights[strategyId] = clampPolicyWeight(
      prev + POLICY_LEARNING_RATE * weight * dir,
    );
  }

  if (event.signal === "unsure") {
    const prev = next.confidence[strategyId] ?? 0;
    next.confidence[strategyId] = Math.max(
      -1,
      prev - 0.25 * Math.max(weight, 0.5),
    );
  }

  // Confirmed reject attribution: nudge that failure-mode key down for injection.
  if (
    event.signal === "reject" &&
    event.attribution &&
    event.source === "hypothesis_confirm"
  ) {
    const key = event.attribution;
    const prev = next.weights[key] ?? DEFAULT_POLICY_WEIGHT;
    next.weights[key] = clampPolicyWeight(
      prev - POLICY_LEARNING_RATE * WEIGHT_SILENT_DEFAULT,
    );
  }

  return next;
}

/** Append event + update bandit weights (pure). */
export function commitFeedbackEvent(
  feedbackLog: FeedbackEvent[] | undefined,
  feedbackPolicy: SessionFeedbackPolicy | undefined,
  event: FeedbackEvent,
  strategyId?: StrategyId,
): {
  feedbackLog: FeedbackEvent[];
  feedbackPolicy: SessionFeedbackPolicy;
} {
  const sid =
    strategyId ?? (event.strategyId as StrategyId | undefined) ?? "default";
  const finalEvent: FeedbackEvent = {
    ...event,
    strategyId: event.strategyId ?? (sid === "default" ? undefined : sid),
  };

  return {
    feedbackLog: appendFeedbackEvent(feedbackLog, finalEvent),
    feedbackPolicy: applyFeedbackToPolicy(feedbackPolicy, finalEvent, sid),
  };
}

/**
 * Short system-prompt block from learned weights.
 * Empty when nothing has been learned yet.
 */
export function formatPolicyForAgent(
  policy: SessionFeedbackPolicy | undefined,
): string | null {
  if (!policy) return null;
  const entries = Object.entries(policy.weights);
  const conf = Object.entries(policy.confidence).filter(([, v]) => v < -0.05);
  if (entries.length === 0 && conf.length === 0) return null;

  const ranked = entries
    .map(([id, score]) => ({ id: id as StrategyId, score }))
    .sort((a, b) => b.score - a.score);

  const prefer = ranked.filter((r) => r.score >= 0.6).slice(0, 3);
  const avoid = ranked.filter((r) => r.score <= 0.4).slice(0, 3);

  const lines: string[] = [
    "【用户策略偏好 · 由分点反馈学习】",
    "以下为会话内简单加权分数（非硬约束）；生成时优先高分策略、回避低分策略；与用户最新消息冲突时以最新消息为准。",
  ];

  if (prefer.length) {
    lines.push(
      `优先：${prefer.map((r) => `${strategyLabel(r.id)}（${r.score.toFixed(2)}）`).join("；")}`,
    );
  }
  if (avoid.length) {
    lines.push(
      `回避：${avoid.map((r) => `${strategyLabel(r.id)}（${r.score.toFixed(2)}）`).join("；")}`,
    );
  }
  if (conf.length) {
    lines.push(
      `置信度衰减（存疑）：${conf
        .slice(0, 4)
        .map(
          ([id, v]) =>
            `${strategyLabel(id as StrategyId)}（${v.toFixed(2)}）→ 先验证再下结论`,
        )
        .join("；")}`,
    );
  }

  return lines.join("\n");
}
