import assert from "node:assert/strict";
import { jevEndpointFromSettings, parseJevReflectResponse } from "../src/lib/jev";
import type { ApiSettings } from "../src/types";
import { normalizeApiSettings } from "../src/lib/settings";
import { reflectWithOptionalLlm } from "../src/lib/llmReflect";
import { AgentLoopController } from "../src/lib/agentLoop";
import type { ModelMetrics } from "../src/lib/modelMetrics";

const allowed = ["continue", "retry", "replan"] as const;

const parsed = parseJevReflectResponse(
  {
    answers: {
      decision: {
        type: "choice",
        choice: "retry",
        confidence: 0.82,
        probabilities: { continue: 0.12, retry: 0.82, replan: 0.06 },
      },
    },
  },
  [...allowed],
);
assert.deepEqual(parsed, {
  decision: "retry",
  confidence: 0.82,
  probabilities: { continue: 0.12, retry: 0.82, replan: 0.06 },
});

assert.equal(
  parseJevReflectResponse(
    { answers: { decision: { choice: "abort", confidence: 0.99 } } },
    [...allowed],
  ),
  null,
  "decisions outside the local allow-list must be rejected",
);

assert.equal(
  jevEndpointFromSettings({
    jevProvider: "official",
    jevBaseUrl: "https://api.typesafe.ai",
  } as ApiSettings),
  "https://api.typesafe.ai/v1/systemone",
);
assert.equal(
  jevEndpointFromSettings({
    jevProvider: "hosted",
    jevBaseUrl: "https://jevtypesafeai.com",
  } as ApiSettings),
  "https://jevtypesafeai.com/api/v1/decide",
);
assert.equal(
  jevEndpointFromSettings({
    jevApiKey: "jv_live_test",
    jevBaseUrl: "",
  } as ApiSettings),
  "https://jevtypesafeai.com/api/v1/decide",
  "legacy settings should infer the hosted provider from its key prefix",
);
const migrated = normalizeApiSettings({
  jevApiKey: "jv_live_test",
  jevBaseUrl: "https://api.typesafe.ai",
});
assert.equal(migrated.jevProvider, "hosted");
assert.equal(migrated.jevBaseUrl, "https://jevtypesafeai.com");

assert.equal(
  parseJevReflectResponse(
    { answers: { decision: { choice: "continue", confidence: 8 } } },
    [...allowed],
  )?.confidence,
  0,
  "invalid confidence values must not pass a positive threshold",
);

const originalFetch = globalThis.fetch;
const metrics: Array<Omit<ModelMetrics, "phase">> = [];
globalThis.fetch = async (url) => {
  assert.equal(String(url), "https://jevtypesafeai.com/api/v1/decide");
  return Response.json({ model: "jev-fixture", answers: { decision: {
    choice: "retry", confidence: 0.9,
  } }, usage: { input_tokens: 10, output_tokens: 0 } });
};
try {
  const result = await reflectWithOptionalLlm({
    loop: new AgentLoopController(),
    input: { observed: { batchOk: false, successCount: 0, errorCount: 1, primaryErrorType: "unknown", summaries: [], digest: "test error" } },
    llm: normalizeApiSettings({ jevReflectEnabled: true, jevProvider: "hosted", jevApiKey: "fixture", useProxy: false }),
    onMetrics: m => metrics.push(m),
  });
  assert.equal(result.source, "jev");
  assert.equal(result.decision, "retry");
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0]?.model, "jev-fixture");
  assert.equal(metrics[0]?.usage?.totalTokens, 10);
} finally { globalThis.fetch = originalFetch; }

console.log("[PASS] Jev Reflect responses and metrics preserve the provider fallback chain");
console.log("test-jev-reflect: ok");
