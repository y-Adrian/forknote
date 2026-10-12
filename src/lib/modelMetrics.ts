export type TokenUsage = { inputTokens: number; outputTokens: number; totalTokens: number };
export type ModelMetrics = {
  model: string;
  phase: "plan" | "code" | "answer" | "reflect" | "archive" | "compress";
  durationMs: number;
  usage: TokenUsage | null;
};
export type SessionModelMetrics = {
  calls: number; unknownCalls: number; inputTokens: number;
  outputTokens: number; totalTokens: number; durationMs: number;
  byPhase: Partial<Record<ModelMetrics["phase"], { calls: number; totalTokens: number; durationMs: number }>>;
};
export function isSessionModelMetrics(raw: unknown): raw is SessionModelMetrics {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const m = raw as Record<string, unknown>;
  const nonnegative = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
  for (const key of ["calls", "unknownCalls", "inputTokens", "outputTokens", "totalTokens"]) {
    if (!nonnegative(m[key]) || !Number.isSafeInteger(m[key])) return false;
  }
  if (!nonnegative(m.durationMs) || Number(m.unknownCalls) > Number(m.calls)) return false;
  if (m.totalTokens !== Number(m.inputTokens) + Number(m.outputTokens)) return false;
  if (!m.byPhase || typeof m.byPhase !== "object" || Array.isArray(m.byPhase)) return false;
  return Object.entries(m.byPhase).every(([key, value]) => {
    if (!["plan", "code", "answer", "reflect", "archive", "compress"].includes(key) || !value || typeof value !== "object") return false;
    const phase = value as Record<string, unknown>;
    return nonnegative(phase.calls) && Number.isSafeInteger(phase.calls) &&
      nonnegative(phase.totalTokens) && Number.isSafeInteger(phase.totalTokens) && nonnegative(phase.durationMs);
  });
}
export function parseTokenUsage(raw: unknown): TokenUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  const inputTokens = u.prompt_tokens ?? u.input_tokens;
  const outputTokens = u.completion_tokens ?? u.output_tokens;
  if (typeof inputTokens !== "number" || typeof outputTokens !== "number" ||
      !Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens) || inputTokens < 0 || outputTokens < 0) return null;
  const totalTokens = inputTokens + outputTokens;
  return Number.isSafeInteger(totalTokens) ? { inputTokens, outputTokens, totalTokens } : null;
}
export function accumulateModelMetrics(previous: SessionModelMetrics | undefined, call: ModelMetrics): SessionModelMetrics {
  const p = previous ?? { calls: 0, unknownCalls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, durationMs: 0, byPhase: {} };
  const phase = p.byPhase[call.phase] ?? { calls: 0, totalTokens: 0, durationMs: 0 };
  return {
    calls: p.calls + 1, unknownCalls: p.unknownCalls + (call.usage ? 0 : 1),
    inputTokens: p.inputTokens + (call.usage?.inputTokens ?? 0),
    outputTokens: p.outputTokens + (call.usage?.outputTokens ?? 0),
    totalTokens: p.totalTokens + (call.usage?.totalTokens ?? 0),
    durationMs: p.durationMs + call.durationMs,
    byPhase: { ...p.byPhase, [call.phase]: { calls: phase.calls + 1, totalTokens: phase.totalTokens + (call.usage?.totalTokens ?? 0), durationMs: phase.durationMs + call.durationMs } },
  };
}
