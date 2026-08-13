/**
 * Session-scoped immediate corrections.
 * Within one conversation: a reject/flip applies on the next turn immediately
 * (do not wait for cross-session User Model confidence — that lives in
 * `userModelStore` and is merged on inject).
 */
import type { FeedbackEvent } from "../types";
import { strategyLabel, type StrategyId } from "./policy";

export type SessionCorrection = {
  avoidTools: string[];
  preferTools: string[];
  avoidStrategies: StrategyId[];
  preferStrategies: StrategyId[];
  /** Short free-form notes (e.g. cancelled plan). */
  notes: string[];
};

const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

function isUserPointSignal(e: FeedbackEvent): boolean {
  return (
    e.decisionType === "point_verdict" ||
    (!e.decisionType && e.source !== "agent_decision")
  );
}

/**
 * Walk the session feedback log newest-first and derive hard session biases.
 * Later events override earlier ones for the same key (flip support).
 */
export function deriveSessionCorrections(
  log: FeedbackEvent[] | null | undefined,
  options?: { now?: number; maxAgeMs?: number },
): SessionCorrection {
  const now = options?.now ?? Date.now();
  const maxAge = options?.maxAgeMs ?? DEFAULT_LOOKBACK_MS;
  const events = (log ?? []).filter((e) => now - e.at <= maxAge);

  const toolVote = new Map<string, "prefer" | "avoid">();
  const strategyVote = new Map<StrategyId, "prefer" | "avoid">();
  const notes: string[] = [];
  let sawPlanReject = false;

  // Chronological apply so the latest vote wins.
  for (const e of events) {
    if (e.signal === "unsure") continue;
    if (e.source === "hypothesis_deny") continue;

    if (e.decisionType === "tool_selection" && e.contextSnapshot) {
      const tool = e.contextSnapshot.trim();
      if (!tool) continue;
      // User-explicit tool feedback is rare; observe rejects also count for
      // same-session "don't retry the same failing tool blindly".
      if (e.signal === "reject") toolVote.set(tool, "avoid");
      if (e.signal === "accept" && e.source === "explicit") {
        toolVote.set(tool, "prefer");
      }
      // Successful observe accept is weak — only clear avoid if previously avoided
      // and a later explicit accept happened (handled above). Soft success does
      // not force prefer.
      if (
        e.signal === "accept" &&
        e.source === "agent_decision" &&
        toolVote.get(tool) === "avoid"
      ) {
        // A later successful run after a failure — clear avoid for this session.
        toolVote.delete(tool);
      }
      continue;
    }

    if (e.decisionType === "plan_approval" && e.signal === "reject") {
      sawPlanReject = true;
      continue;
    }

    if (e.signal === "reject" && isUserPointSignal(e)) {
      const sid = (e.strategyId ?? e.attribution ?? "default") as StrategyId;
      strategyVote.set(sid, "avoid");
      if (e.attribution) {
        strategyVote.set(e.attribution, "avoid");
      }
      continue;
    }

    if (e.signal === "accept" && isUserPointSignal(e) && e.source === "explicit") {
      const sid = (e.strategyId ?? "default") as StrategyId;
      strategyVote.set(sid, "prefer");
      // Flipping off a prior avoid on the same strategy.
      continue;
    }
  }

  if (sawPlanReject) {
    notes.push(
      "User rejected/cancelled at least one plan this session — do not re-present the same plan; replan with a different approach if tools are still needed.",
    );
  }

  const avoidTools: string[] = [];
  const preferTools: string[] = [];
  for (const [tool, vote] of toolVote) {
    if (vote === "avoid") avoidTools.push(tool);
    else preferTools.push(tool);
  }

  const avoidStrategies: StrategyId[] = [];
  const preferStrategies: StrategyId[] = [];
  for (const [sid, vote] of strategyVote) {
    if (sid === "default") continue;
    if (vote === "avoid") avoidStrategies.push(sid);
    else preferStrategies.push(sid);
  }

  return {
    avoidTools: avoidTools.slice(0, 8),
    preferTools: preferTools.slice(0, 6),
    avoidStrategies: avoidStrategies.slice(0, 6),
    preferStrategies: preferStrategies.slice(0, 6),
    notes: notes.slice(0, 3),
  };
}

export function sessionCorrectionIsEmpty(c: SessionCorrection): boolean {
  return (
    c.avoidTools.length === 0 &&
    c.preferTools.length === 0 &&
    c.avoidStrategies.length === 0 &&
    c.preferStrategies.length === 0 &&
    c.notes.length === 0
  );
}

/** Immediate session-scoped prompt block (working memory). */
export function formatSessionCorrectionAddendum(
  log: FeedbackEvent[] | null | undefined,
  locale: "zh" | "en" = "zh",
): string | null {
  const c = deriveSessionCorrections(log);
  if (sessionCorrectionIsEmpty(c)) return null;

  const lines: string[] =
    locale === "zh"
      ? [
          "【本会话即时纠偏】仅对当前会话生效；用户刚纠正过的行为请立刻调整，不要重复。",
        ]
      : [
          "[Session immediate corrections] Apply in this conversation only; do not repeat approaches the user just corrected.",
        ];

  if (c.avoidTools.length) {
    lines.push(
      locale === "zh"
        ? `避免再用这些工具（除非用户明确要求）：${c.avoidTools.join("、")}`
        : `Avoid these tools unless the user explicitly asks: ${c.avoidTools.join(", ")}`,
    );
  }
  if (c.preferTools.length) {
    lines.push(
      locale === "zh"
        ? `本会话更倾向：${c.preferTools.join("、")}`
        : `Prefer in this session: ${c.preferTools.join(", ")}`,
    );
  }
  if (c.avoidStrategies.length) {
    lines.push(
      locale === "zh"
        ? `回避这些表达/路线：${c.avoidStrategies.map((s) => strategyLabel(s)).join("、")}`
        : `Avoid these approaches: ${c.avoidStrategies.map((s) => strategyLabel(s)).join(", ")}`,
    );
  }
  if (c.preferStrategies.length) {
    lines.push(
      locale === "zh"
        ? `优先这些路线：${c.preferStrategies.map((s) => strategyLabel(s)).join("、")}`
        : `Prefer these approaches: ${c.preferStrategies.map((s) => strategyLabel(s)).join(", ")}`,
    );
  }
  for (const note of c.notes) {
    lines.push(`- ${note}`);
  }
  return lines.join("\n");
}
