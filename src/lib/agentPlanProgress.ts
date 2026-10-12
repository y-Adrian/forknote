import {
  parseApprovedPlanStep, pathsMatch,
  type AgentToolCall,
} from "./agentTools";
import { parseStructuredPlanHints } from "./agentLoop";

export class AgentPlanProgress {
  readonly steps: Array<{
    description: string;
    call: AgentToolCall | null;
    expectedOutcome?: string;
    status: "pending" | "failed" | "succeeded";
  }>;

  constructor(descriptions: string[], private readonly projectRoot: string | null) {
    const hints = parseStructuredPlanHints("", descriptions);
    this.steps = descriptions.map((description, i) => ({
      description,
      call: parseApprovedPlanStep(description),
      expectedOutcome: hints[i]?.expectedOutcome,
      status: "pending",
    }));
  }

  private matches(expected: AgentToolCall, actual: AgentToolCall): boolean {
    if (expected.tool !== actual.tool) return false;
    if (expected.path && !pathsMatch(expected.path, actual.path, this.projectRoot)) return false;
    if (expected.command && expected.command.trim() !== actual.command?.trim()) return false;
    if (expected.query && expected.query !== actual.query) return false;
    if (expected.old_string != null && expected.old_string !== actual.old_string) return false;
    if (expected.new_string != null && expected.new_string !== actual.new_string) return false;
    return true;
  }

  record(call: AgentToolCall, ok: boolean): void {
    // One result satisfies one step; repeated operations require separate evidence.
    const step = this.steps.find(s => s.status !== "succeeded" && s.call && this.matches(s.call, call));
    if (step) step.status = ok ? "succeeded" : "failed";
  }

  expectedFor(calls: AgentToolCall[]): string | undefined {
    return this.steps.filter(s => s.call && calls.some(c => this.matches(s.call!, c)))
      .map(s => s.expectedOutcome).filter(Boolean).join("\n") || undefined;
  }

  get complete(): boolean {
    return this.steps.length > 0 && this.steps.every(s => s.status === "succeeded");
  }

  get remaining(): string[] {
    return this.steps.filter(s => s.status !== "succeeded").map(s => s.description);
  }
}
