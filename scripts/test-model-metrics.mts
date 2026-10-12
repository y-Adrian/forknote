import assert from "node:assert/strict";
import { streamChat } from "../src/lib/openai.ts";
import { accumulateModelMetrics, parseTokenUsage, isSessionModelMetrics } from "../src/lib/modelMetrics.ts";
import { parseSessionStoreImport } from "../src/lib/storage.ts";
assert.equal(parseTokenUsage({ prompt_tokens: -1, completion_tokens: 2 }), null);
assert.equal(parseTokenUsage({ prompt_tokens: "3", completion_tokens: 2 }), null);
const original = globalThis.fetch;
let attempts = 0;
globalThis.fetch = async (_, init) => {
  const body = JSON.parse(String(init?.body));
  attempts++;
  if (attempts === 1) {
    assert.equal(body.stream_options.include_usage, true);
    return new Response("stream_options unsupported", { status: 400 });
  }
  assert.equal(body.stream_options, undefined);
  return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3,"total_tokens":15}}\n\ndata: [DONE]\n\n');
};
try {
  const result = await streamChat({ baseUrl: "https://mock.test/v1", apiKey: "", model: "mock", useProxy: false }, [], () => {});
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 3, totalTokens: 15 });
  assert.equal(result.content, "ok");
  const first = accumulateModelMetrics(undefined, { model: "mock", phase: "plan", usage: result.usage, durationMs: 10 });
  const second = accumulateModelMetrics(first, { model: "mock", phase: "reflect", usage: null, durationMs: 20 });
  assert.equal(second.totalTokens, 15);
  assert.equal(second.unknownCalls, 1);
  assert.equal(second.durationMs, 30);
  assert.equal(first.calls, 1);
  assert.equal(second.byPhase.plan?.totalTokens, 15);
  assert.equal(isSessionModelMetrics(second), true);
  assert.equal(isSessionModelMetrics({ ...second, unknownCalls: 100 }), false);
  assert.equal(isSessionModelMetrics({ ...second, byPhase: null }), false);
  assert.throws(() => parseSessionStoreImport(JSON.stringify({ sessions: [{
    id: "test", title: "test", thread: null, createdAt: 1, updatedAt: 1, modelMetrics: { calls: -1 },
  }], activeSessionId: "test" })), /modelMetrics is invalid/);
  console.log("test-model-metrics: ok");
} finally { globalThis.fetch = original; }
