/**
 * Unit tests for agent loop foundation: Result / Observe / Reflect / User Model / budgets.
 */
import assert from "node:assert/strict";
import {
  classifyToolError,
  normalizeObserveOutput,
  toToolResult,
} from "../src/lib/agentResult.ts";
import {
  AgentLoopController,
  buildReflectNudge,
  parseStructuredPlanHints,
} from "../src/lib/agentLoop.ts";
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
testReflectCircuit();
testStructuredPlanHints();
testMemoryBudget();
testUserModel();
console.log("all agent-loop foundation tests passed");
