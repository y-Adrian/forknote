/**
 * Tests for tool_selection decision logging + unsure clarify routing.
 */
import assert from "node:assert/strict";
import { toToolResult } from "../src/lib/agentResult.ts";
import {
  buildToolSelectionDecisionEvents,
  formatPendingUnsureAddendum,
  formatUnsureCautionAddendum,
  isDecisionClarified,
  listPendingUnsureEvents,
} from "../src/lib/decisionFeedback.ts";
import { applyFeedbackToPolicy, emptyFeedbackPolicy } from "../src/lib/policy.ts";
import { createFeedbackEvent } from "../src/lib/feedback.ts";
import { applyFeedbackToUserModel, emptyUserModel } from "../src/lib/userModel.ts";

function testToolSelectionEvents() {
  const ok = toToolResult({ ok: true, resultText: "file contents" });
  const err = toToolResult({
    ok: false,
    resultText: "Error: path is required",
  });
  const events = buildToolSelectionDecisionEvents({
    targetId: "session1",
    turnId: "turn1",
    batchId: "batch_a",
    items: [
      { tool: "read_file", result: ok },
      { tool: "write_file", result: err },
    ],
  });
  assert.equal(events.length, 2);
  assert.equal(events[0]!.decisionType, "tool_selection");
  assert.equal(events[0]!.signal, "accept");
  assert.equal(events[0]!.contextSnapshot, "read_file");
  assert.equal(events[1]!.signal, "reject");
  assert.match(events[1]!.note ?? "", /invalid_input/);

  // Auto tool observe does not move bandit weights.
  const policy = applyFeedbackToPolicy(
    emptyFeedbackPolicy(),
    events[0]!,
    "default",
  );
  assert.deepEqual(policy.weights, {});

  // User Model does learn tool preference from accept.
  let model = emptyUserModel();
  model = applyFeedbackToUserModel(model, events[0]!);
  assert.ok(model.preferences["tool_selection.read_file"]);
  assert.equal(model.preferences["tool_selection.read_file"]!.prefer, "read_file");
  console.log("ok tool selection events");
}

function testUnsureDoesNotMovePolicy() {
  const event = createFeedbackEvent({
    targetId: "m1",
    pointIndex: 2,
    signal: "unsure",
    decisionType: "point_verdict",
    decisionId: "m1:2",
  });
  const policy = applyFeedbackToPolicy(emptyFeedbackPolicy(), event, "goal_mismatch");
  assert.deepEqual(policy.weights, {});
  assert.deepEqual(policy.confidence, {});

  let model = emptyUserModel();
  model = applyFeedbackToUserModel(model, event);
  assert.deepEqual(model.preferences, {});
  console.log("ok unsure no policy move");
}

function testPendingUnsureQueue() {
  const unsure = createFeedbackEvent({
    targetId: "msg_a",
    pointIndex: 1,
    signal: "unsure",
    decisionType: "point_verdict",
    note: "边界不清",
  });
  const log = [unsure];
  assert.equal(listPendingUnsureEvents(log).length, 1);
  assert.match(formatPendingUnsureAddendum(log, "zh") ?? "", /待澄清/);

  const confirmed = createFeedbackEvent({
    targetId: "msg_a",
    pointIndex: 1,
    signal: "unsure",
    source: "hypothesis_confirm",
    attribution: "goal_mismatch",
  });
  // Force later timestamp
  confirmed.at = unsure.at + 10;
  const resolved = [...log, confirmed];
  assert.equal(isDecisionClarified(resolved, unsure), true);
  assert.equal(listPendingUnsureEvents(resolved).length, 0);
  console.log("ok pending unsure queue");
}

function testUnsureCaution() {
  const events = Array.from({ length: 10 }, (_, i) =>
    createFeedbackEvent({
      targetId: "t",
      pointIndex: i,
      signal: i < 5 ? "unsure" : "accept",
      decisionType: "point_verdict",
    }),
  );
  const caution = formatUnsureCautionAddendum(events, "point_verdict", {
    locale: "zh",
  });
  assert.ok(caution);
  assert.match(caution!, /存疑偏高/);
  console.log("ok unsure caution");
}

testToolSelectionEvents();
testUnsureDoesNotMovePolicy();
testPendingUnsureQueue();
testUnsureCaution();
console.log("all decision-feedback / unsure-route tests passed");
