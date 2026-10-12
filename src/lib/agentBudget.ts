import type { AgentToolCall } from "./agentTools";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  }
  return value;
}

/** One instance survives every approval/chunk of a single user turn. */
export class AgentBudget {
  rounds = 0;
  private failures = new Map<string, number>();
  constructor(readonly maxRounds: number, readonly maxIdenticalFailures = 3) {}
  get exhausted(): boolean { return this.rounds >= this.maxRounds; }
  reserveRound(): boolean {
    if (this.exhausted) return false;
    this.rounds++;
    return true;
  }
  canRun(call: AgentToolCall): boolean {
    return (this.failures.get(JSON.stringify(canonical(call))) ?? 0) < this.maxIdenticalFailures;
  }
  record(call: AgentToolCall, ok: boolean): void {
    const key = JSON.stringify(canonical(call));
    if (ok) this.failures.delete(key);
    else this.failures.set(key, (this.failures.get(key) ?? 0) + 1);
  }
}
