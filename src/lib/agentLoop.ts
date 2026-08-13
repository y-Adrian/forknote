/**
 * Explicit agent phase machine: PLAN → ACT → OBSERVE → REFLECT → (PLAN | done).
 * Phases pass structured data; retries / replans are circuit-broken here.
 */
import {
  summarizeToolResultForMemory,
  type ToolErrorType,
  type ToolResult,
} from "./agentResult";

export type AgentPhase =
  | "plan"
  | "await_approval"
  | "act"
  | "observe"
  | "reflect"
  | "done"
  | "aborted";

export type ReflectDecision = "continue" | "retry" | "replan" | "abort";

/** Structured plan step — preferred over free-form prose for Reflect. */
export interface StructuredPlanStep {
  id: string;
  description: string;
  tool?: string;
  params?: Record<string, unknown>;
  expectedOutcome?: string;
  /** Optional DAG deps (step ids that must finish first). */
  dependsOn?: string[];
}

export interface ObserveSignal {
  batchOk: boolean;
  successCount: number;
  errorCount: number;
  /** Dominant error type when batch failed. */
  primaryErrorType?: ToolErrorType;
  /** Normalized per-tool lines for working memory. */
  summaries: string[];
  /** Compact blob for Reflect / next Plan. */
  digest: string;
}

export interface WorkingMemoryStep {
  phase: AgentPhase;
  at: number;
  summary: string;
  decision?: ReflectDecision;
  errorType?: ToolErrorType;
}

export interface AgentLoopOptions {
  maxStepRetries?: number;
  maxReplans?: number;
  /** Keep this many recent working-memory steps fully; older ones compress. */
  workingMemoryKeepRecent?: number;
  workingMemoryCompressAt?: number;
}

export interface ReflectInput {
  observed: ObserveSignal;
  /** expected_outcome from the current plan step, when known. */
  expectedOutcome?: string;
  /** True when the model still has deferred plan work. */
  hasDeferredPlan?: boolean;
}

const ALLOWED: Record<AgentPhase, AgentPhase[]> = {
  plan: ["await_approval", "act", "done", "aborted"],
  await_approval: ["act", "plan", "done", "aborted"],
  act: ["observe", "done", "aborted"],
  observe: ["reflect", "done", "aborted"],
  reflect: ["act", "plan", "done", "aborted"],
  done: [],
  aborted: [],
};

export class AgentLoopController {
  phase: AgentPhase = "plan";
  stepRetries = 0;
  replanCount = 0;
  readonly maxStepRetries: number;
  readonly maxReplans: number;
  readonly workingMemoryKeepRecent: number;
  readonly workingMemoryCompressAt: number;
  /** error_type → count (feeds later reliability / policy). */
  readonly errorTypeCounts: Partial<Record<ToolErrorType, number>> = {};
  workingMemory: WorkingMemoryStep[] = [];
  /** Compressed summary of early steps (rule-based). */
  workingMemoryDigest = "";
  lastObserve: ObserveSignal | null = null;
  lastDecision: ReflectDecision | null = null;
  structuredSteps: StructuredPlanStep[] = [];

  constructor(options: AgentLoopOptions = {}) {
    this.maxStepRetries = options.maxStepRetries ?? 2;
    this.maxReplans = options.maxReplans ?? 3;
    this.workingMemoryKeepRecent = options.workingMemoryKeepRecent ?? 3;
    this.workingMemoryCompressAt = options.workingMemoryCompressAt ?? 8;
  }

  enter(next: AgentPhase, summary?: string): void {
    const allowed = ALLOWED[this.phase];
    if (!allowed.includes(next) && this.phase !== next) {
      // Soft-allow for recovery paths (e.g. chunk replan from act).
      if (!(this.phase === "act" && next === "plan") && !(this.phase === "reflect" && next === "await_approval")) {
        // Still transition — log in working memory for diagnostics.
        this.pushMemory(this.phase, `transition ${this.phase}→${next} (soft)`);
      }
    }
    this.phase = next;
    if (summary) this.pushMemory(next, summary);
  }

  setStructuredPlan(steps: StructuredPlanStep[]): void {
    this.structuredSteps = steps;
  }

  recordToolResults(
    items: Array<{ tool: string; result: ToolResult }>,
  ): ObserveSignal {
    this.enter("observe");
    let successCount = 0;
    let errorCount = 0;
    const errVotes: Partial<Record<ToolErrorType, number>> = {};
    const summaries: string[] = [];

    for (const { tool, result } of items) {
      if (result.ok) successCount += 1;
      else {
        errorCount += 1;
        const et = result.errorType ?? "unknown";
        errVotes[et] = (errVotes[et] ?? 0) + 1;
        this.errorTypeCounts[et] = (this.errorTypeCounts[et] ?? 0) + 1;
      }
      summaries.push(summarizeToolResultForMemory(tool, result));
    }

    let primaryErrorType: ToolErrorType | undefined;
    let best = 0;
    for (const [k, v] of Object.entries(errVotes) as Array<
      [ToolErrorType, number]
    >) {
      if (v > best) {
        best = v;
        primaryErrorType = k;
      }
    }

    const observed: ObserveSignal = {
      batchOk: errorCount === 0 && successCount > 0,
      successCount,
      errorCount,
      primaryErrorType,
      summaries,
      digest: summaries.join("\n") || "(no tool results)",
    };
    this.lastObserve = observed;
    this.pushMemory(
      "observe",
      `ok=${successCount} err=${errorCount}${primaryErrorType ? ` primary=${primaryErrorType}` : ""}`,
    );
    this.compressWorkingMemoryIfNeeded();
    return observed;
  }

  /**
   * Pure rule Reflect (no counter mutation). Used by LLM overlay to know the
   * baseline and the allowed decision set before committing.
   */
  peekReflect(input: ReflectInput): ReflectDecision {
    const { observed, expectedOutcome } = input;
    let decision: ReflectDecision = "continue";

    if (observed.errorCount === 0) {
      decision = "continue";
    } else {
      const et = observed.primaryErrorType ?? "unknown";
      if (et === "permission") {
        decision = "abort";
      } else if (
        et === "timeout" ||
        et === "invalid_input" ||
        et === "not_found"
      ) {
        if (this.stepRetries < this.maxStepRetries) decision = "retry";
        else if (this.replanCount < this.maxReplans) decision = "replan";
        else decision = "abort";
      } else if (this.stepRetries < this.maxStepRetries) {
        decision = "retry";
      } else if (this.replanCount < this.maxReplans) {
        decision = "replan";
      } else {
        decision = "abort";
      }
    }

    if (
      decision === "continue" &&
      expectedOutcome &&
      observed.successCount === 0 &&
      observed.errorCount > 0
    ) {
      if (this.stepRetries < this.maxStepRetries) decision = "retry";
      else if (this.replanCount < this.maxReplans) decision = "replan";
      else decision = "abort";
    }

    return decision;
  }

  /** Decisions still within circuit-breaker budget (for LLM clamp). */
  allowedReflectDecisions(observed: ObserveSignal): ReflectDecision[] {
    if (observed.errorCount === 0) {
      const ok: ReflectDecision[] = ["continue"];
      // Semantic mismatch may still ask for a soft retry when budget remains.
      if (this.stepRetries < this.maxStepRetries) ok.push("retry");
      if (this.replanCount < this.maxReplans) ok.push("replan");
      return ok;
    }
    const et = observed.primaryErrorType ?? "unknown";
    if (et === "permission") return ["abort"];
    const allowed: ReflectDecision[] = [];
    if (observed.successCount > 0) allowed.push("continue");
    if (this.stepRetries < this.maxStepRetries) allowed.push("retry");
    if (this.replanCount < this.maxReplans) allowed.push("replan");
    allowed.push("abort");
    return allowed;
  }

  /** Apply counters + working-memory for a chosen Reflect decision. */
  commitReflect(
    decision: ReflectDecision,
    observed: ObserveSignal,
  ): ReflectDecision {
    this.enter("reflect");
    if (decision === "continue") {
      this.stepRetries = 0;
    } else if (decision === "retry") {
      this.stepRetries += 1;
    } else if (decision === "replan") {
      this.replanCount += 1;
      this.stepRetries = 0;
    }
    this.lastDecision = decision;
    this.pushMemory(
      "reflect",
      `decision=${decision}`,
      decision,
      observed.primaryErrorType,
    );
    return decision;
  }

  /**
   * Rule-based Reflect (structured decision, not prose).
   * Prefer {@link peekReflect} + optional LLM + {@link commitReflect} for
   * LLM-backed Reflect; this remains the default single-call path.
   */
  reflect(input: ReflectInput): ReflectDecision {
    const decision = this.peekReflect(input);
    return this.commitReflect(decision, input.observed);
  }

  canRetryStep(): boolean {
    return this.stepRetries <= this.maxStepRetries;
  }

  canReplan(): boolean {
    return this.replanCount <= this.maxReplans;
  }

  /** Format working memory for injection (token-budgeted by caller). */
  formatWorkingMemory(maxChars = 4_000): string {
    const lines: string[] = [];
    if (this.workingMemoryDigest) {
      lines.push(`Earlier: ${this.workingMemoryDigest}`);
    }
    for (const step of this.workingMemory) {
      const d = step.decision ? ` → ${step.decision}` : "";
      lines.push(`[${step.phase}] ${step.summary}${d}`);
    }
    const text = lines.join("\n");
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}\n…(working memory truncated)`;
  }

  private pushMemory(
    phase: AgentPhase,
    summary: string,
    decision?: ReflectDecision,
    errorType?: ToolErrorType,
  ): void {
    this.workingMemory.push({
      phase,
      at: Date.now(),
      summary,
      decision,
      errorType,
    });
  }

  private compressWorkingMemoryIfNeeded(): void {
    if (this.workingMemory.length < this.workingMemoryCompressAt) return;
    const drop = this.workingMemory.length - this.workingMemoryKeepRecent;
    if (drop <= 0) return;
    const early = this.workingMemory.slice(0, drop);
    const kept = this.workingMemory.slice(drop);
    const compressed = early
      .map((s) => `${s.phase}:${s.summary.slice(0, 80)}`)
      .join("; ");
    this.workingMemoryDigest = [this.workingMemoryDigest, compressed]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 1_200);
    this.workingMemory = kept;
  }
}

/** Observe a tool batch into a structured signal (also usable without the controller). */
export function observeToolBatch(
  items: Array<{ tool: string; result: ToolResult }>,
): ObserveSignal {
  return new AgentLoopController().recordToolResults(items);
}

/**
 * Build a Reflect nudge for the model when decision is retry/replan/abort.
 * Structured guidance — not an open-ended "check your work".
 */
export function buildReflectNudge(args: {
  decision: ReflectDecision;
  observed: ObserveSignal;
  expectedOutcome?: string;
  locale?: "zh" | "en";
}): string {
  const zh = (args.locale ?? "zh") === "zh";
  const et = args.observed.primaryErrorType ?? "unknown";
  const expected = args.expectedOutcome?.trim();
  const expectedLine = expected
    ? zh
      ? `本步预期：${expected}`
      : `Expected outcome: ${expected}`
    : zh
      ? "本步预期：完成用户目标所需的下一步工具调用"
      : "Expected outcome: the next tool call required by the user goal";

  if (args.decision === "retry") {
    return zh
      ? `【Reflect：retry】对照预期自评未通过。\n${expectedLine}\n主要错误类型：${et}\n观察摘要：\n${args.observed.digest}\n请修正参数后重试同一目标（不要换无关工具）。`
      : `[Reflect: retry] Outcome did not match expectation.\n${expectedLine}\nPrimary error: ${et}\nObserve:\n${args.observed.digest}\nFix parameters and retry the same goal (do not switch to unrelated tools).`;
  }
  if (args.decision === "replan") {
    return zh
      ? `【Reflect：replan】同一步重试已达上限。\n${expectedLine}\n主要错误类型：${et}\n观察摘要：\n${args.observed.digest}\n请改用另一种方式达成同一用户目标（重新分解步骤），不要死循环同一失败调用。`
      : `[Reflect: replan] Step retries exhausted.\n${expectedLine}\nPrimary error: ${et}\nObserve:\n${args.observed.digest}\nChoose a different approach for the same user goal; do not loop the same failing call.`;
  }
  if (args.decision === "abort") {
    return zh
      ? `【Reflect：abort】无法继续自动修复（${et}）。\n${expectedLine}\n观察摘要：\n${args.observed.digest}\n请向用户清晰说明失败原因与需要的人工介入；不要假装成功。`
      : `[Reflect: abort] Cannot auto-recover (${et}).\n${expectedLine}\nObserve:\n${args.observed.digest}\nTell the user clearly what failed and what human action is needed; do not claim success.`;
  }
  return zh
    ? `【Reflect：continue】观察通过，继续下一步。\n${expectedLine}`
    : `[Reflect: continue] Observation looks good; proceed.\n${expectedLine}`;
}

/**
 * Parse light-weight structured hints from plan prose:
 * lines like `tool: read_file` / `expected: …` under a numbered step.
 */
export function parseStructuredPlanHints(
  _planText: string,
  steps: string[],
): StructuredPlanStep[] {
  return steps.map((description, i) => {
    const id = `step_${i + 1}`;
    const toolMatch = description.match(
      /(?:^|[\s（(])(?:tool|工具)\s*[:：]\s*([a-z_]+)/i,
    );
    const expectedMatch = description.match(
      /(?:^|[\s（(])(?:expected|预期|期望结果)\s*[:：]\s*(.+)$/i,
    );
    return {
      id,
      description,
      tool: toolMatch?.[1]?.trim(),
      expectedOutcome: expectedMatch?.[1]?.trim(),
    };
  });
}
