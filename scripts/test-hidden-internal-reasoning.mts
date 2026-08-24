/**
 * Probe: leaked internal formatting / instruction reasoning is not streamed
 * as visible assistant content.
 *
 * Usage: npx tsx scripts/test-hidden-internal-reasoning.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const reasoning = readFileSync("src/lib/reasoning.ts", "utf8");
assert.ok(
  /peelWholeChineseMetaReasoning/.test(reasoning),
  "reasoning layer must detect whole-message Chinese meta leaks",
);
assert.ok(
  /hidePeeledReasoning/.test(reasoning),
  "mergeReasoningChannels must support hiding peeled meta from display",
);

const agentTurn = readFileSync("src/lib/agentTurn.ts", "utf8");
assert.ok(
  /hidePeeledReasoning:\s*true/.test(agentTurn),
  "agent streaming/final patches must hide peeled meta reasoning",
);
assert.ok(
  /hiddenInternalReasoningFallback/.test(agentTurn),
  "agent must show a short fallback when only internal reasoning was generated",
);
assert.ok(
  /本次生成只包含内部思考，已隐藏/.test(agentTurn),
  "Chinese fallback should explain hidden internal reasoning without leaking it",
);

console.log("[PASS] hidden internal reasoning");
console.log("test-hidden-internal-reasoning: ok");
