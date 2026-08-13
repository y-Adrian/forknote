/**
 * Decision-bound feedback helpers: tool_selection logging + unsure clarify routing.
 * Unsure is NOT a weak reject — it goes to a pending-confirmation queue.
 */
import { createFeedbackEvent } from "./feedback";
import type { ToolErrorType, ToolResult } from "./agentResult";
import type { FeedbackEvent, PointVerdict } from "../types";

const UNSURE_PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function buildToolSelectionDecisionEvents(args: {
  targetId: string;
  turnId?: string;
  phase?: string;
  batchId: string;
  items: Array<{ tool: string; result: ToolResult }>;
}): FeedbackEvent[] {
  const events: FeedbackEvent[] = [];
  for (let i = 0; i < args.items.length; i++) {
    const item = args.items[i]!;
    const signal: PointVerdict = item.result.ok ? "accept" : "reject";
    const errorType: ToolErrorType | undefined = item.result.errorType;
    events.push(
      createFeedbackEvent({
        targetId: args.targetId,
        pointIndex: i,
        signal,
        source: "agent_decision",
        decisionId: `${args.batchId}:${item.tool}:${i}`,
        decisionType: "tool_selection",
        turnId: args.turnId,
        phase: args.phase ?? "act",
        contextSnapshot: item.tool,
        note: errorType
          ? `observe:${item.result.status}/${errorType}`
          : `observe:${item.result.status}`,
      }),
    );
  }
  return events;
}

/** True when a later hypothesis_confirm covers this unsure/reject event. */
export function isDecisionClarified(
  log: FeedbackEvent[],
  event: FeedbackEvent,
): boolean {
  return log.some(
    (e) =>
      e.at > event.at &&
      e.targetId === event.targetId &&
      e.pointIndex === event.pointIndex &&
      (e.source === "hypothesis_confirm" ||
        (e.signal === "accept" && e.source === "explicit")),
  );
}

/**
 * Unsure events still awaiting clarification (hypothesis confirm or flip to accept).
 * Sorted newest-first; capped for prompt injection.
 */
export function listPendingUnsureEvents(
  log: FeedbackEvent[] | null | undefined,
  options?: { maxAgeMs?: number; limit?: number; now?: number },
): FeedbackEvent[] {
  const now = options?.now ?? Date.now();
  const maxAge = options?.maxAgeMs ?? UNSURE_PENDING_MAX_AGE_MS;
  const limit = options?.limit ?? 5;
  const events = log ?? [];
  const pending: FeedbackEvent[] = [];

  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.signal !== "unsure") continue;
    // Hypothesis answers are resolutions, not open doubts.
    if (e.source === "hypothesis_confirm" || e.source === "hypothesis_deny") {
      continue;
    }
    if (now - e.at > maxAge) continue;
    if (isDecisionClarified(events, e)) continue;
    pending.push(e);
    if (pending.length >= limit) break;
  }
  return pending;
}

export function formatPendingUnsureAddendum(
  log: FeedbackEvent[] | null | undefined,
  locale: "zh" | "en" = "zh",
): string | null {
  const pending = listPendingUnsureEvents(log);
  if (pending.length === 0) return null;

  const lines =
    locale === "zh"
      ? [
          "【待澄清 · 存疑队列】用户对以下决策点仍存疑，尚未确认原因。不要当作已拒绝；优先澄清边界/证据，必要时追问一句。",
        ]
      : [
          "[Pending unsure queue] The user marked these decisions as unsure and has not confirmed why. Do not treat them as rejects; clarify evidence/boundaries first, ask one short question if needed.",
        ];

  for (const e of pending) {
    const where =
      e.decisionType === "tool_selection"
        ? `tool:${e.contextSnapshot ?? "?"}`
        : `point【${e.pointIndex}】@${e.targetId.slice(0, 8)}`;
    const note = e.note?.trim() ? ` — ${e.note.trim().slice(0, 120)}` : "";
    lines.push(`- ${where}${note}`);
  }
  return lines.join("\n");
}

/**
 * When unsure ratio for a decision type is high, ask the agent to be more
 * explanatory / conservative — still not a negative weight update.
 */
export function formatUnsureCautionAddendum(
  log: FeedbackEvent[] | null | undefined,
  decisionType: NonNullable<FeedbackEvent["decisionType"]>,
  options?: { threshold?: number; minSamples?: number; locale?: "zh" | "en" },
): string | null {
  const threshold = options?.threshold ?? 0.4;
  const minSamples = options?.minSamples ?? 5;
  const locale = options?.locale ?? "zh";
  const slice = (log ?? []).filter((e) => e.decisionType === decisionType);
  if (slice.length < minSamples) return null;
  const unsure = slice.filter((e) => e.signal === "unsure").length;
  const ratio = unsure / slice.length;
  if (ratio < threshold) return null;

  if (locale === "zh") {
    return [
      "【存疑偏高 · 保守模式】",
      `近期「${decisionType}」存疑比例约 ${(ratio * 100).toFixed(0)}%（${unsure}/${slice.length}）。`,
      "请默认多给一句依据/边界说明，避免跳跃结论；不要把存疑当成否定。",
    ].join("\n");
  }
  return [
    "[Elevated unsure — conservative mode]",
    `Recent "${decisionType}" unsure ratio ≈ ${(ratio * 100).toFixed(0)}% (${unsure}/${slice.length}).`,
    "Default to one extra sentence of evidence/limits; do not treat unsure as rejection.",
  ].join("\n");
}

/** Prefer tool names with high accept confidence from the User Model table. */
export function formatToolPreferenceHint(
  preferences: Record<string, { prefer: string; confidence: number }>,
  minConfidence = 0.7,
): string | null {
  const lines: string[] = [];
  for (const [key, entry] of Object.entries(preferences)) {
    if (!key.startsWith("tool_selection.")) continue;
    if (entry.confidence < minConfidence) continue;
    const tool = key.slice("tool_selection.".length);
    lines.push(`- prefer ${entry.prefer || tool} (confidence ${entry.confidence.toFixed(2)})`);
  }
  if (lines.length === 0) return null;
  return ["【Tool selection preferences】", ...lines].join("\n");
}
