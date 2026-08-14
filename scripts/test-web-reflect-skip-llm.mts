/**
 * Probe #362: clean successful web batches must use deterministic Reflect
 * (no LLM round-trip). LLM Reflect remains for expected-outcome checks,
 * ambiguous errors, and mixed success+error batches.
 *
 * Usage: npx tsx scripts/test-web-reflect-skip-llm.mts
 */
import assert from "node:assert/strict";
import { toToolResult } from "../src/lib/agentResult.ts";
import {
  AgentLoopController,
  observeBatchHasWebTools,
} from "../src/lib/agentLoop.ts";
import { shouldAskLlmReflect } from "../src/lib/llmReflect.ts";

{
  const loop = new AgentLoopController();
  const observed = loop.recordToolResults([
    {
      tool: "web_search",
      result: toToolResult({
        ok: true,
        resultText: "1. Solid hit\n   https://example.com\n   snippet",
        tool: "web_search",
      }),
    },
  ]);
  assert.equal(observeBatchHasWebTools(observed), true);
  assert.equal(observed.batchOk, true);
  assert.equal(
    shouldAskLlmReflect({ observed }, "continue"),
    false,
    "prove prior failure mode is fixed: clean web no longer forces LLM",
  );
}

{
  const loop = new AgentLoopController();
  const observed = loop.recordToolResults([
    {
      tool: "web_search",
      result: toToolResult({
        ok: true,
        resultText: "ok",
        tool: "web_search",
      }),
    },
    {
      tool: "web_fetch",
      result: toToolResult({
        ok: false,
        resultText: "Error: something weird",
        tool: "web_fetch",
      }),
    },
  ]);
  assert.equal(observeBatchHasWebTools(observed), true);
  assert.equal(observed.batchOk, false);
  assert.equal(
    shouldAskLlmReflect({ observed }, "retry"),
    true,
    "mixed / ambiguous web batches may still ask LLM Reflect",
  );
}

{
  const loop = new AgentLoopController();
  const observed = loop.recordToolResults([
    {
      tool: "web_fetch",
      result: toToolResult({
        ok: true,
        resultText: "page body",
        tool: "web_fetch",
      }),
    },
  ]);
  assert.equal(
    shouldAskLlmReflect(
      { observed, expectedOutcome: "authoritative docs text" },
      "continue",
    ),
    true,
    "expected outcome still triggers LLM Reflect",
  );
}

console.log("[PASS] clean web batches skip LLM Reflect");
console.log("test-web-reflect-skip-llm: ok");
