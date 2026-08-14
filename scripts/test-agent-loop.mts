/**
 * Unit tests for agent loop foundation: Result / Observe / Reflect / User Model / budgets.
 */
import assert from "node:assert/strict";
import {
  classifyToolError,
  normalizeObserveOutput,
  normalizeWebFetchOutput,
  normalizeWebSearchOutput,
  toToolResult,
} from "../src/lib/agentResult.ts";
import {
  AgentLoopController,
  buildReflectNudge,
  observeBatchHasWebTools,
  parseStructuredPlanHints,
} from "../src/lib/agentLoop.ts";
import { shouldAskLlmReflect } from "../src/lib/llmReflect.ts";
import { assembleMemoryLayers, MEMORY_CHAR_BUDGETS } from "../src/lib/memoryBudget.ts";
import {
  applyFeedbackToUserModel,
  buildUserModelFromFeedbackLog,
  emptyUserModel,
  formatUserModelForAgent,
  shouldClarifyUnsure,
} from "../src/lib/userModel.ts";
import { createFeedbackEvent } from "../src/lib/feedback.ts";

function testClassify() {
  assert.equal(classifyToolError("Error: timed out after 60s"), "timeout");
  assert.equal(classifyToolError("permission denied"), "permission");
  assert.equal(classifyToolError("ENOENT: no such file"), "not_found");
  assert.equal(classifyToolError("Error: path is required"), "invalid_input");
  assert.equal(classifyToolError("something weird"), "unknown");
  console.log("ok classifyToolError");
}

function testToToolResult() {
  const ok = toToolResult({ ok: true, resultText: "hello\n\n\nworld" });
  assert.equal(ok.status, "success");
  assert.equal(ok.ok, true);
  assert.match(ok.resultText, /hello/);
  assert.doesNotMatch(ok.resultText, /\n{3}/);

  const err = toToolResult({
    ok: false,
    resultText: "Error: path is required",
  });
  assert.equal(err.status, "error");
  assert.equal(err.errorType, "invalid_input");
  console.log("ok toToolResult");
}

function testObserveNormalize() {
  const long = "a".repeat(20_000);
  const n = normalizeObserveOutput(long, { maxChars: 1000 });
  assert.ok(n.length <= 1100);
  assert.match(n, /observe truncated/);
  console.log("ok normalizeObserveOutput");
}

function testWebObserveNormalize() {
  const rawSearch = [
    "1. Cookie Privacy Policy All Rights Reserved Mega Title That Goes On Forever And Should Be Clipped",
    "   https://example.com/a",
    "   We use cookies. Real snippet about the release notes for the product update this week.",
    "",
    "2. Second Hit",
    "   https://example.com/b",
    "   " + "x".repeat(500),
  ].join("\n");
  const search = normalizeWebSearchOutput(rawSearch);
  assert.match(search, /1\. /);
  assert.match(search, /https:\/\/example\.com\/a/);
  assert.doesNotMatch(search, /We use cookies/i);
  assert.ok(!search.includes("x".repeat(300)));
  assert.ok(search.length < rawSearch.length);

  const rawFetch = [
    "URL: https://example.com/doc",
    "HTTP: 200",
    "Type: text/html",
    "",
    "Accept all cookies. Privacy policy. " + "body ".repeat(3000),
  ].join("\n");
  const fetchOut = normalizeWebFetchOutput(rawFetch);
  assert.match(fetchOut, /URL: https:\/\/example\.com\/doc/);
  assert.match(fetchOut, /HTTP: 200/);
  assert.ok(fetchOut.length < rawFetch.length);
  assert.doesNotMatch(fetchOut, /Accept all cookies/i);

  const asResult = toToolResult({
    ok: true,
    resultText: rawSearch,
    tool: "web_search",
  });
  assert.equal(asResult.ok, true);
  assert.ok(asResult.resultText.length < asResult.rawOutput.length);
  console.log("ok web observe normalize");
}

function testWebReflectNudge() {
  const loop = new AgentLoopController();
  const ok = toToolResult({
    ok: true,
    resultText: "1. Title\n   https://ex.com\n   snippet",
    tool: "web_search",
  });
  const observed = loop.recordToolResults([
    { tool: "web_search", result: ok },
  ]);
  assert.equal(observeBatchHasWebTools(observed), true);
  assert.equal(
    shouldAskLlmReflect({ observed }, "continue"),
    false,
    "clean successful web batches must not trigger LLM Reflect",
  );
  assert.equal(
    shouldAskLlmReflect(
      { observed, expectedOutcome: "enough sources for the answer" },
      "continue",
    ),
    true,
    "expected-outcome checks may still ask the LLM after web tools",
  );
  const retry = buildReflectNudge({
    decision: "retry",
    observed,
    locale: "en",
  });
  assert.match(retry, /different query/i);
  const replan = buildReflectNudge({
    decision: "replan",
    observed,
    locale: "zh",
  });
  assert.match(replan, /换检索|web_search/);
  console.log("ok web reflect nudge");
}

function testReflectCircuit() {
  const loop = new AgentLoopController({ maxStepRetries: 2, maxReplans: 2 });
  const fail = toToolResult({
    ok: false,
    resultText: "Error: path is required",
  });

  const decide = () =>
    loop.reflect({
      observed: loop.recordToolResults([{ tool: "read_file", result: fail }]),
    });

  assert.equal(decide(), "retry"); // retries 1/2
  assert.equal(decide(), "retry"); // retries 2/2
  assert.equal(decide(), "replan"); // replan 1/2, retries reset
  assert.equal(decide(), "retry");
  assert.equal(decide(), "retry");
  assert.equal(decide(), "replan"); // replan 2/2
  assert.equal(decide(), "retry");
  assert.equal(decide(), "retry");
  assert.equal(decide(), "abort"); // replans exhausted

  const perm = toToolResult({
    ok: false,
    resultText: "Error: permission denied outside project",
  });
  const loop2 = new AgentLoopController();
  const d = loop2.reflect({
    observed: loop2.recordToolResults([{ tool: "run_terminal", result: perm }]),
  });
  assert.equal(d, "abort");

  const nudge = buildReflectNudge({
    decision: "retry",
    observed: loop2.lastObserve!,
    expectedOutcome: "file contents",
    locale: "zh",
  });
  assert.match(nudge, /Reflect：retry/);
  assert.match(nudge, /预期/);
  console.log("ok reflect circuit");
}

function testStructuredPlanHints() {
  const steps = [
    "Read config 工具: read_file 预期: 返回 JSON 字段",
    "Write output",
  ];
  const structured = parseStructuredPlanHints("## Plan\n1. …", steps);
  assert.equal(structured[0]?.tool, "read_file");
  assert.match(structured[0]?.expectedOutcome ?? "", /JSON/);
  assert.equal(structured[1]?.tool, undefined);
  console.log("ok parseStructuredPlanHints");
}

function testMemoryBudget() {
  const huge = "X".repeat(MEMORY_CHAR_BUDGETS.longTerm + 5000);
  const out = assembleMemoryLayers([
    { kind: "preferences", text: "prefs-ok" },
    { kind: "longTerm", text: huge },
    { kind: "session", text: "session-tail" },
  ]);
  assert.ok(out);
  assert.ok(out!.length <= MEMORY_CHAR_BUDGETS.total);
  assert.match(out!, /session-tail/);
  console.log("ok memory budget");
}

function testUserModel() {
  let model = emptyUserModel();
  const accept = createFeedbackEvent({
    targetId: "m1",
    pointIndex: 1,
    signal: "accept",
    source: "agent_decision",
    decisionType: "plan_approval",
    decisionId: "plan_1",
    contextSnapshot: "step one",
  });
  model = applyFeedbackToUserModel(model, accept);
  assert.ok(model.preferences["plan_approval.default"]);
  assert.ok(model.preferences["plan_approval.default"]!.confidence > 0.5);

  const unsure = createFeedbackEvent({
    targetId: "m1",
    pointIndex: 1,
    signal: "unsure",
    source: "agent_decision",
    decisionType: "plan_approval",
    decisionId: "plan_2",
  });
  const before = model.preferences["plan_approval.default"]!.confidence;
  model = applyFeedbackToUserModel(model, unsure);
  assert.equal(model.preferences["plan_approval.default"]!.confidence, before);

  const events = Array.from({ length: 10 }, (_, i) =>
    createFeedbackEvent({
      targetId: "t",
      pointIndex: i,
      signal: i < 5 ? "unsure" : "accept",
      source: "agent_decision",
      decisionType: "tool_selection",
      contextSnapshot: "ripgrep",
    }),
  );
  assert.equal(shouldClarifyUnsure(events, "tool_selection", 0.4), true);

  const built = buildUserModelFromFeedbackLog([accept]);
  const text = formatUserModelForAgent(built, 0.5);
  assert.ok(text && /User Model/.test(text));
  console.log("ok userModel");
}

testClassify();
testToToolResult();
testObserveNormalize();
testWebObserveNormalize();
testWebReflectNudge();
testReflectCircuit();
testStructuredPlanHints();
testMemoryBudget();
testUserModel();
console.log("all agent-loop foundation tests passed");
