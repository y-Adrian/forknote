import type {
  FeedbackAttribution,
  FeedbackEvent,
  PointAttributionMap,
  PointDoubtMap,
  PointVerdict,
  PointVerdictMap,
} from "../types";

/** Explicit Accept — strong positive. */
export const WEIGHT_EXPLICIT_ACCEPT = 1;
/** Silent default (no click) — weak positive; do not treat as equal to Accept. */
export const WEIGHT_SILENT_DEFAULT = 0.25;
/** Passive use (e.g. copy) — strong positive without clicking Accept. */
export const WEIGHT_PASSIVE_USE = 0.9;
/** Reject magnitude (direction is negative; attribution decides how Policy moves). */
export const WEIGHT_REJECT = 1;

/** Consecutive same-class rejects before a stronger hypothesis ask. */
export const REJECT_STREAK_ASK_THRESHOLD = 3;

/** Bandit step size: score += lr * signal_weight * (±1). */
export const POLICY_LEARNING_RATE = 0.15;

export const FEEDBACK_ATTRIBUTIONS: FeedbackAttribution[] = [
  "goal_mismatch",
  "constraint_conflict",
  "unfamiliar_approach",
  "user_expertise",
  "style_dislike",
];

/** Agent-facing Chinese labels (for context injection, not chip lists). */
export const ATTRIBUTION_AGENT_LABEL: Record<FeedbackAttribution, string> = {
  goal_mismatch: "偏离了我的目标",
  constraint_conflict: "不符合我已有的约束",
  unfamiliar_approach: "技术路线我不习惯",
  user_expertise: "我有更专业的判断",
  style_dislike: "单纯不喜欢表达方式",
};

/** Hypothesis text shown as a follow-up question (二元确认), zh. */
export const ATTRIBUTION_HYPOTHESIS_ZH: Record<FeedbackAttribution, string> = {
  goal_mismatch: "看起来这个方向可能偏离了你真正想解决的问题，是这个原因吗？",
  constraint_conflict:
    "看起来这个方案可能跟你现有的技术约束或环境冲突，是这个原因吗？",
  unfamiliar_approach: "看起来这条技术路线你可能不太习惯，是这个原因吗？",
  user_expertise: "看起来你对这块有更专业的判断，想换一种做法，是这个原因吗？",
  style_dislike: "看起来主要是表达方式不太合适，而不是方向本身，是这个原因吗？",
};

export const ATTRIBUTION_HYPOTHESIS_EN: Record<FeedbackAttribution, string> = {
  goal_mismatch:
    "It looks like this may have missed what you actually want to solve — is that why?",
  constraint_conflict:
    "It looks like this may conflict with your existing constraints — is that why?",
  unfamiliar_approach:
    "It looks like this technical approach may not fit how you usually work — is that why?",
  user_expertise:
    "It looks like you may already have a stronger judgment here and want a different approach — is that why?",
  style_dislike:
    "It looks like it's mostly the writing style, not the direction itself — is that why?",
};

export const UNSURE_HYPOTHESIS_ZH =
  "看起来你是觉得这里证据或边界还不够清楚，需要我再验证一下，是这样吗？";
export const UNSURE_HYPOTHESIS_EN =
  "It looks like the evidence or boundaries here aren't clear enough and you'd like me to verify — is that right?";

export function feedbackWeightFor(
  signal: PointVerdict | "silent" | "passive_use",
): number {
  if (signal === "accept") return WEIGHT_EXPLICIT_ACCEPT;
  if (signal === "passive_use") return WEIGHT_PASSIVE_USE;
  if (signal === "silent") return WEIGHT_SILENT_DEFAULT;
  if (signal === "reject") return WEIGHT_REJECT;
  return 0;
}

export function formatAttributionForAgent(
  attribution: FeedbackAttribution | undefined,
): string | null {
  if (!attribution) return null;
  return ATTRIBUTION_AGENT_LABEL[attribution] ?? attribution;
}

export function hypothesisText(
  signal: PointVerdict,
  attribution: FeedbackAttribution,
  locale: "zh" | "en",
): string {
  if (signal === "unsure") {
    return locale === "zh" ? UNSURE_HYPOTHESIS_ZH : UNSURE_HYPOTHESIS_EN;
  }
  const map = locale === "zh" ? ATTRIBUTION_HYPOTHESIS_ZH : ATTRIBUTION_HYPOTHESIS_EN;
  return map[attribution];
}

/**
 * Pick ONE hypothesized attribution without calling the chat Agent
 * (avoid same-turn self-rationalization). Heuristic + rotate.
 */
export function pickHypothesisAttribution(
  content: string,
  recent: FeedbackAttribution[] = [],
): FeedbackAttribution {
  const text = content.toLowerCase();
  const scored: Array<{ id: FeedbackAttribution; score: number }> = [
    { id: "constraint_conflict", score: 1 },
    { id: "goal_mismatch", score: 1 },
    { id: "unfamiliar_approach", score: 1 },
    { id: "user_expertise", score: 1 },
    { id: "style_dislike", score: 0.5 },
  ];

  if (/约束|必须|禁止|生产|线上|legacy|compat|兼容|不能改/.test(text)) {
    scored.find((s) => s.id === "constraint_conflict")!.score += 3;
  }
  if (/目标|需求|你想|真正|其实|不是这个/.test(text)) {
    scored.find((s) => s.id === "goal_mismatch")!.score += 2;
  }
  if (/```|实现|架构|重构|框架|api|算法/.test(text)) {
    scored.find((s) => s.id === "unfamiliar_approach")!.score += 2;
  }
  if (/建议|应该|最佳实践|推荐/.test(text)) {
    scored.find((s) => s.id === "user_expertise")!.score += 1.5;
  }

  for (const id of recent.slice(-5)) {
    const row = scored.find((s) => s.id === id);
    if (row) row.score -= 1.2;
  }

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.id ?? "constraint_conflict";
}

export function createFeedbackEvent(input: {
  targetId: string;
  pointIndex: number;
  signal: PointVerdict;
  attribution?: FeedbackAttribution;
  note?: string;
  source?: FeedbackEvent["source"];
  weight?: number;
}): FeedbackEvent {
  const source = input.source ?? "explicit";
  const weight =
    input.weight ??
    (source === "passive_copy"
      ? WEIGHT_PASSIVE_USE
      : feedbackWeightFor(input.signal));
  return {
    id: `fb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    targetId: input.targetId,
    pointIndex: input.pointIndex,
    signal: input.signal,
    explicit: source === "explicit" || source === "hypothesis_confirm",
    weight,
    attribution: input.attribution,
    note: input.note?.trim() || undefined,
    source,
    at: Date.now(),
  };
}

/** Cap stored raw events so sessions stay bounded. */
export const FEEDBACK_LOG_MAX = 200;

export function appendFeedbackEvent(
  log: FeedbackEvent[] | undefined,
  event: FeedbackEvent,
): FeedbackEvent[] {
  const next = [...(log ?? []), event];
  if (next.length <= FEEDBACK_LOG_MAX) return next;
  return next.slice(next.length - FEEDBACK_LOG_MAX);
}

const EMPTY_REJECT_ATTRIBUTIONS: FeedbackAttribution[] = [];

export function recentRejectAttributions(
  log: FeedbackEvent[] | undefined,
): FeedbackAttribution[] {
  if (!log?.length) return EMPTY_REJECT_ATTRIBUTIONS;
  const next = log
    .filter((e) => e.signal === "reject" && e.attribution)
    .slice(-8)
    .map((e) => e.attribution!);
  return next.length === 0 ? EMPTY_REJECT_ATTRIBUTIONS : next;
}

export function countRecentRejectStreak(
  log: FeedbackEvent[] | undefined,
): number {
  const events = log ?? [];
  let streak = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]?.signal === "reject") streak += 1;
    else break;
  }
  return streak;
}

/**
 * Build agent-facing point annotations from structured feedback.
 * Explicit Accept ≠ silent default (weights differ).
 */
export function describePointFeedbackForAgent(input: {
  index: number;
  content: string;
  verdict: PointVerdict | undefined;
  doubt?: string;
  attribution?: FeedbackAttribution;
  /** Later silent points after an earlier reject — obsolete, not live advice. */
  truncated?: boolean;
}): string {
  const { index, content, verdict, doubt, attribution, truncated } = input;
  const attr = formatAttributionForAgent(attribution);
  const attrSuffix = attr ? `；已确认归因：${attr}` : "";

  if (truncated && !verdict) {
    return `【${index}】（已截断：用户在更早分点处分叉，此步骤不再作为可行方案，勿再展开）${content}`;
  }

  if (verdict === "reject") {
    const why = attr
      ? `用户确认原因是「${attr}」——请据此调整决策方式，勿再沿用同类策略`
      : "尚无确认归因——记为强负信号；勿在当轮自我合理化原因，优先依据用户后续行为或二元确认结果";
    return `【${index}】（用户反馈·不采纳，权重 ${WEIGHT_REJECT}${attrSuffix}：${why}）${content}`;
  }

  if (verdict === "unsure") {
    const note = doubt?.trim();
    const notePart = note ? `；用户备注：${note}` : "";
    return `【${index}】（用户反馈·存疑：降低该主题置信度并触发验证——补证据、收紧边界或列出关键假设供确认${attrSuffix}${notePart}）${content}`;
  }

  if (verdict === "accept") {
    return `【${index}】（用户反馈·主动采纳，权重 ${WEIGHT_EXPLICIT_ACCEPT}${attrSuffix}：此策略在当前场景对该用户有效，后续同类问题优先沿用）${content}`;
  }

  return `【${index}】（默认沉默，弱正信号权重 ${WEIGHT_SILENT_DEFAULT}：未主动确认，勿等同于主动采纳）${content}`;
}

export type AnnotateFeedbackMaps = {
  verdicts?: PointVerdictMap;
  doubts?: PointDoubtMap;
  attributions?: PointAttributionMap;
};
