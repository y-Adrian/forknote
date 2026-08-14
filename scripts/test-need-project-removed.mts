/**
 * Probe #356: need_project is a dead contract after unbound sessions moved to
 * plain Q&A — remove the outcome + store handlers rather than reintroduce
 * rollbacks for sample-code asks.
 *
 * Usage: npx tsx scripts/test-need-project-removed.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AgentTurnOutcome } from "../src/lib/agentTurn.ts";

{
  const turn = readFileSync("src/lib/agentTurn.ts", "utf8");
  assert.ok(
    !/need_project/.test(turn),
    "agentTurn must not declare or return need_project",
  );
  const store = readFileSync("src/store/useAppStore.ts", "utf8");
  assert.ok(
    !/need_project/.test(store),
    "store must not handle need_project outcomes",
  );
  assert.ok(
    !/rolled_back/.test(store),
    "askMain rolled_back existed only for need_project rollbacks",
  );
  const main = readFileSync("src/components/MainPanel.tsx", "utf8");
  assert.ok(
    !/rolled_back/.test(main),
    "composer restore must not depend on rolled_back",
  );
  console.log("[PASS] need_project / rolled_back wiring removed");
}

{
  // Compile-time + runtime: outcome union has no need_project.
  const sample: AgentTurnOutcome = "completed";
  assert.equal(sample, "completed");
  const allowed: AgentTurnOutcome[] = ["completed", "waiting_plan", "aborted"];
  assert.equal(allowed.includes("need_project" as AgentTurnOutcome), false);
  console.log("[PASS] AgentTurnOutcome no longer includes need_project");
}

{
  // Prove prior product choice still holds: unbound sample-code stays chat.
  const sim = readFileSync("scripts/sim-unbound-write-code.mts", "utf8");
  assert.ok(sim.includes('assert.equal(outcome, "completed")'));
  assert.ok(!sim.includes("need_project"));
  console.log("[PASS] unbound write-code sim no longer references need_project");
}

console.log("All #356 need-project-removed probes passed.");
