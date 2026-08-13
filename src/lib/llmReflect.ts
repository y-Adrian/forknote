/**
 * LLM-backed Reflect overlay.
 * Rules own the circuit breaker; the LLM may only pick from allowed decisions.
 */
import type { ApiSettings } from "../types";
import type {
  AgentLoopController,
  ObserveSignal,
  ReflectDecision,
  ReflectInput,
} from "./agentLoop";
import { streamChat, type ChatMessage } from "./openai";
import { withAgentPhaseModel } from "./agentModelRouting";

const DECISIONS: ReflectDecision[] = [
  "continue",
  "retry",
  "replan",
  "abort",
];

export function parseReflectDecision(text: string): ReflectDecision | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // Prefer JSON blob
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]) as { decision?: unknown };
      if (typeof obj.decision === "string") {
        const d = obj.decision.toLowerCase().trim() as ReflectDecision;
        if (DECISIONS.includes(d)) return d;
      }
    } catch {
      // fall through
    }
  }
  const line = trimmed.toLowerCase();
  for (const d of DECISIONS) {
    if (
      line === d ||
      line.startsWith(`${d} `) ||
      line.includes(`"decision":"${d}"`) ||
      line.includes(`decision: ${d}`) ||
      line.includes(`decision=${d}`)
    ) {
      return d;
    }
  }
  return null;
}

/** When true, ask the LLM (expected outcome check or ambiguous errors). */
export function shouldAskLlmReflect(
  input: ReflectInput,
  ruleDecision: ReflectDecision,
): boolean {
  // Hard stop — no extra latency.
  if (ruleDecision === "abort") return false;
  const { observed, expectedOutcome } = input;
  if (expectedOutcome?.trim() && observed.successCount + observed.errorCount > 0) {
    return true;
  }
  if (
    observed.errorCount > 0 &&
    (observed.primaryErrorType === "unknown" ||
      (observed.successCount > 0 && observed.errorCount > 0))
  ) {
    return true;
  }
  return false;
}

export function clampReflectDecision(
  candidate: ReflectDecision | null,
  allowed: ReflectDecision[],
  fallback: ReflectDecision,
): ReflectDecision {
  if (candidate && allowed.includes(candidate)) return candidate;
  return fallback;
}

function buildReflectPrompt(args: {
  observed: ObserveSignal;
  expectedOutcome?: string;
  ruleDecision: ReflectDecision;
  allowed: ReflectDecision[];
  locale?: "zh" | "en";
}): ChatMessage[] {
  const zh = (args.locale ?? "zh") === "zh";
  const system = zh
    ? `你是 Agent Reflect 控制器。根据观察结果在允许的决策中选一个，只输出 JSON：{"decision":"continue|retry|replan|abort","reason":"一句"}。不要编造工具结果。`
    : `You are the Agent Reflect controller. Pick one allowed decision from the observation. Output JSON only: {"decision":"continue|retry|replan|abort","reason":"one sentence"}. Do not invent tool results.`;
  const user = [
    zh ? `规则基线：${args.ruleDecision}` : `Rule baseline: ${args.ruleDecision}`,
    zh
      ? `允许决策：${args.allowed.join(", ")}`
      : `Allowed: ${args.allowed.join(", ")}`,
    args.expectedOutcome
      ? zh
        ? `预期：${args.expectedOutcome}`
        : `Expected: ${args.expectedOutcome}`
      : zh
        ? "预期：（未声明）"
        : "Expected: (none)",
    zh ? "观察：" : "Observe:",
    args.observed.digest,
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/**
 * Ask the LLM for a Reflect decision; returns null on failure / empty.
 */
export async function askLlmReflectDecision(args: {
  llm: ApiSettings;
  observed: ObserveSignal;
  expectedOutcome?: string;
  ruleDecision: ReflectDecision;
  allowed: ReflectDecision[];
  signal?: AbortSignal;
  locale?: "zh" | "en";
}): Promise<ReflectDecision | null> {
  const settings = withAgentPhaseModel(args.llm, "plan");
  const messages = buildReflectPrompt({
    observed: args.observed,
    expectedOutcome: args.expectedOutcome,
    ruleDecision: args.ruleDecision,
    allowed: args.allowed,
    locale: args.locale,
  });
  try {
    const result = await streamChat(settings, messages, () => {}, {
      signal: args.signal,
      temperature: 0,
    });
    return parseReflectDecision(result.content);
  } catch {
    return null;
  }
}

/**
 * Full Reflect: rule peek → optional LLM (clamped) → commit counters once.
 */
export async function reflectWithOptionalLlm(args: {
  loop: AgentLoopController;
  input: ReflectInput;
  llm?: ApiSettings | null;
  enableLlm?: boolean;
  signal?: AbortSignal;
  locale?: "zh" | "en";
}): Promise<{ decision: ReflectDecision; source: "rule" | "llm" }> {
  const ruleDecision = args.loop.peekReflect(args.input);
  const allowed = args.loop.allowedReflectDecisions(args.input.observed);
  let decision = ruleDecision;
  let source: "rule" | "llm" = "rule";

  if (
    args.enableLlm !== false &&
    args.llm &&
    shouldAskLlmReflect(args.input, ruleDecision)
  ) {
    const llmDecision = await askLlmReflectDecision({
      llm: args.llm,
      observed: args.input.observed,
      expectedOutcome: args.input.expectedOutcome,
      ruleDecision,
      allowed,
      signal: args.signal,
      locale: args.locale,
    });
    const clamped = clampReflectDecision(llmDecision, allowed, ruleDecision);
    if (llmDecision && clamped === llmDecision) {
      decision = clamped;
      source = "llm";
    } else {
      decision = clamped;
    }
  }

  // Ensure final decision is still allowed (e.g. rule peek vs live counters).
  decision = clampReflectDecision(decision, allowed, ruleDecision);
  args.loop.commitReflect(decision, args.input.observed);
  return { decision, source };
}
