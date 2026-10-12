import type { ApiSettings } from "../types";
import type { AgentContentPatch, AgentTurnOutcome } from "./agentTurn";
import type { Locale } from "./i18n";
import type { ModelMetrics } from "./modelMetrics";
import { streamChat, type ChatMessage, type StreamTiming } from "./openai";
import { stripToolCalls } from "./agentTools";
import { mergeReasoningChannels } from "./reasoning";

export function thinkingSecondsFromTiming(timing: StreamTiming, reasoningText: string): number | undefined {
  if (!reasoningText.trim()) return undefined;
  const startAt = timing.firstReasoningAt ?? timing.startedAt;
  const endAt = Math.max(startAt, timing.lastReasoningAt ?? 0, timing.firstVisibleContentAt ?? 0);
  return Math.max(1, Math.round((endAt - startAt) / 1000));
}

export function hiddenInternalReasoningFallback(locale: Locale): string {
  return locale === "zh"
    ? "本次生成只包含内部思考，已隐藏。请重试生成。"
    : "This generation only contained internal reasoning, so it was hidden. Please retry.";
}

/** Plain-answer streaming, independently of planning and tool execution. */
export async function streamPlainChatAnswer(args: {
  onModelMetrics?: (metrics: ModelMetrics) => void;
  llm: ApiSettings;
  apiMessages: ChatMessage[];
  signal: AbortSignal;
  isOwned: () => boolean;
  patchContent: (patch: AgentContentPatch) => void;
  locale: Locale;
}): Promise<AgentTurnOutcome> {
  let reasoning = "";
  let content = "";
  const patch = (value: AgentContentPatch) => {
    if (args.isOwned() && !args.signal.aborted) args.patchContent(value);
  };
  const merged = () => mergeReasoningChannels(reasoning, stripToolCalls(content), {
    expectChineseAnswer: args.locale === "zh", hidePeeledReasoning: true,
  });
  const result = await streamChat(args.llm, args.apiMessages, delta => {
    content += delta;
    const value = merged();
    if (value.content) patch({ content: value.content, ...(value.reasoning.trim() ? { reasoning: value.reasoning } : {}) });
  }, {
    signal: args.signal, temperature: 0.6,
    onMetrics: m => args.onModelMetrics?.({ ...m, phase: "answer" }),
    onReasoningDelta: delta => { reasoning += delta; if (reasoning.trim()) patch({ reasoning }); },
  });
  if (args.signal.aborted || !args.isOwned()) return "aborted";
  content = result.content || content;
  if (result.reasoning.length >= reasoning.length) reasoning = result.reasoning;
  const value = merged();
  patch({
    content: value.content || (stripToolCalls(content).trim() ? hiddenInternalReasoningFallback(args.locale) : ""),
    ...(value.reasoning.trim() ? {
      reasoning: value.reasoning,
      thinkingSeconds: thinkingSecondsFromTiming(result.timing, value.reasoning),
    } : {}),
  });
  return "completed";
}
