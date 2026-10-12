import assert from "node:assert/strict";
import { askLlmReflectDecision } from "../src/lib/llmReflect.ts";
const original = globalThis.fetch;
globalThis.fetch = () => new Promise(() => {});
try {
  const start = Date.now();
  const result = await askLlmReflectDecision({
    llm: { baseUrl: "https://mock.test/v1", apiKey: "", model: "mock", useProxy: false },
    observed: { batchOk: false, errorCount: 1, successCount: 0, summaries: [], digest: "failed" },
    ruleDecision: "retry", allowed: ["retry", "abort"], timeoutMs: 20,
  });
  assert.equal(result, null);
  assert.ok(Date.now() - start < 1000);
  console.log("test-reflect-timeout: ok (transport ignoring cancellation still returns)");
} finally { globalThis.fetch = original; }
