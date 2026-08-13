/**
 * Offline Policy regression + session immediate-correction checks.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createFeedbackEvent } from "../src/lib/feedback.ts";
import {
  BUILTIN_POLICY_REGRESSION_CASES,
  runPolicyRegressionSuite,
  type PolicyRegressionCase,
} from "../src/lib/policyRegression.ts";
import {
  deriveSessionCorrections,
  formatSessionCorrectionAddendum,
} from "../src/lib/sessionCorrection.ts";

const here = dirname(fileURLToPath(import.meta.url));

function testBuiltinSuite() {
  const { passed, failed, results } = runPolicyRegressionSuite(
    BUILTIN_POLICY_REGRESSION_CASES,
  );
  for (const r of results) {
    if (!r.ok) {
      console.error(`FAIL ${r.id}:`, r.failures.join("; "));
    } else {
      console.log(`ok policy case ${r.id}`);
    }
  }
  assert.equal(failed, 0, `${failed} builtin policy cases failed`);
  assert.equal(passed, BUILTIN_POLICY_REGRESSION_CASES.length);
  console.log(`ok builtin policy regression (${passed}/${passed})`);
}

function testFixtureFile() {
  const raw = readFileSync(
    join(here, "fixtures/policy-regression.json"),
    "utf8",
  );
  const parsed = JSON.parse(raw) as { cases: PolicyRegressionCase[] };
  const { passed, failed, results } = runPolicyRegressionSuite(parsed.cases);
  for (const r of results) {
    if (!r.ok) console.error(`FAIL fixture ${r.id}:`, r.failures.join("; "));
  }
  assert.equal(failed, 0);
  assert.ok(passed >= 6);
  console.log(`ok fixture policy regression (${passed} cases)`);
}

function testSessionCorrection() {
  const now = Date.now();
  const rejectTool = createFeedbackEvent({
    targetId: "s1",
    pointIndex: 0,
    signal: "reject",
    source: "agent_decision",
    decisionType: "tool_selection",
    contextSnapshot: "run_terminal",
  });
  rejectTool.at = now - 5000;

  const rejectPoint = createFeedbackEvent({
    targetId: "msg1",
    pointIndex: 2,
    signal: "reject",
    source: "explicit",
    decisionType: "point_verdict",
    strategyId: "unfamiliar_approach",
    attribution: "unfamiliar_approach",
  });
  rejectPoint.at = now - 4000;

  const rejectPlan = createFeedbackEvent({
    targetId: "plan1",
    pointIndex: 0,
    signal: "reject",
    source: "agent_decision",
    decisionType: "plan_approval",
  });
  rejectPlan.at = now - 3000;

  const log = [rejectTool, rejectPoint, rejectPlan];
  const c = deriveSessionCorrections(log, { now });
  assert.ok(c.avoidTools.includes("run_terminal"));
  assert.ok(c.avoidStrategies.includes("unfamiliar_approach"));
  assert.ok(c.notes.some((n) => /plan/i.test(n)));

  const text = formatSessionCorrectionAddendum(log, "zh");
  assert.ok(text);
  assert.match(text!, /本会话即时纠偏/);
  assert.match(text!, /run_terminal/);

  // Later successful observe clears avoid for that tool.
  const okTool = createFeedbackEvent({
    targetId: "s1",
    pointIndex: 1,
    signal: "accept",
    source: "agent_decision",
    decisionType: "tool_selection",
    contextSnapshot: "run_terminal",
  });
  okTool.at = now - 1000;
  const cleared = deriveSessionCorrections([...log, okTool], { now });
  assert.ok(!cleared.avoidTools.includes("run_terminal"));

  // Explicit accept flips strategy avoid → prefer.
  const acceptPoint = createFeedbackEvent({
    targetId: "msg1",
    pointIndex: 2,
    signal: "accept",
    source: "explicit",
    decisionType: "point_verdict",
    strategyId: "unfamiliar_approach",
  });
  acceptPoint.at = now - 500;
  const flipped = deriveSessionCorrections([...log, acceptPoint], { now });
  assert.ok(!flipped.avoidStrategies.includes("unfamiliar_approach"));
  assert.ok(flipped.preferStrategies.includes("unfamiliar_approach"));

  console.log("ok session correction");
}

testBuiltinSuite();
testFixtureFile();
testSessionCorrection();
console.log("all session-correction / policy-regression tests passed");
