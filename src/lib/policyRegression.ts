/**
 * Offline Policy regression helpers.
 * Small fixture-driven checks so Policy Update cannot silently regress.
 */
import { createFeedbackEvent } from "./feedback";
import {
  applyFeedbackToPolicy,
  emptyFeedbackPolicy,
  type StrategyId,
} from "./policy";
import type { FeedbackEvent, SessionFeedbackPolicy } from "../types";

export type WeightExpect = {
  op: "lt" | "lte" | "gt" | "gte" | "eq" | "approx";
  value: number;
  /** abs tolerance for approx (default 0.02). */
  eps?: number;
};

export type PolicyRegressionCase = {
  id: string;
  description?: string;
  /** Optional starting policy (defaults to empty). */
  seedPolicy?: {
    weights?: Record<string, number>;
    confidence?: Record<string, number>;
  };
  /** Events applied in order (factory-friendly plain objects). */
  events: Array<{
    signal: FeedbackEvent["signal"];
    source?: FeedbackEvent["source"];
    decisionType?: FeedbackEvent["decisionType"];
    strategyId?: string;
    attribution?: FeedbackEvent["attribution"];
    contextSnapshot?: string;
    note?: string;
    /** Content used for inferStrategyId when strategyId omitted. */
    content?: string;
  }>;
  expect: {
    weights?: Record<string, WeightExpect>;
    /** Strategies that must not drop below seed (regression guard). */
    mustNotRegress?: Array<{ strategyId: string; minWeight: number }>;
  };
};

export type PolicyRegressionResult = {
  id: string;
  ok: boolean;
  failures: string[];
  finalPolicy: SessionFeedbackPolicy;
};

function cmp(actual: number, expect: WeightExpect): boolean {
  const eps = expect.eps ?? 0.02;
  switch (expect.op) {
    case "lt":
      return actual < expect.value;
    case "lte":
      return actual <= expect.value;
    case "gt":
      return actual > expect.value;
    case "gte":
      return actual >= expect.value;
    case "eq":
      return actual === expect.value;
    case "approx":
      return Math.abs(actual - expect.value) <= eps;
    default:
      return false;
  }
}

export function runPolicyRegressionCase(
  testCase: PolicyRegressionCase,
): PolicyRegressionResult {
  let policy: SessionFeedbackPolicy = emptyFeedbackPolicy();
  if (testCase.seedPolicy) {
    policy = {
      weights: { ...(testCase.seedPolicy.weights ?? {}) },
      confidence: { ...(testCase.seedPolicy.confidence ?? {}) },
      updatedAt: Date.now(),
    };
  }

  let t = Date.now() - testCase.events.length * 1000;
  for (const raw of testCase.events) {
    const event = createFeedbackEvent({
      targetId: `reg_${testCase.id}`,
      pointIndex: 0,
      signal: raw.signal,
      source: raw.source,
      decisionType: raw.decisionType,
      attribution: raw.attribution,
      contextSnapshot: raw.contextSnapshot,
      note: raw.note,
      strategyId: raw.strategyId,
    });
    event.at = t;
    t += 1000;
    const sid = (raw.strategyId ?? "default") as StrategyId;
    policy = applyFeedbackToPolicy(policy, event, sid);
  }

  const failures: string[] = [];
  for (const [sid, expect] of Object.entries(testCase.expect.weights ?? {})) {
    const actual = policy.weights[sid] ?? 0.5;
    if (!cmp(actual, expect)) {
      failures.push(
        `weight[${sid}]=${actual.toFixed(3)} failed ${expect.op} ${expect.value}`,
      );
    }
  }
  for (const row of testCase.expect.mustNotRegress ?? []) {
    const actual = policy.weights[row.strategyId] ?? 0.5;
    if (actual < row.minWeight) {
      failures.push(
        `regressed ${row.strategyId}: ${actual.toFixed(3)} < min ${row.minWeight}`,
      );
    }
  }

  return {
    id: testCase.id,
    ok: failures.length === 0,
    failures,
    finalPolicy: policy,
  };
}

export function runPolicyRegressionSuite(cases: PolicyRegressionCase[]): {
  passed: number;
  failed: number;
  results: PolicyRegressionResult[];
} {
  const results = cases.map(runPolicyRegressionCase);
  const passed = results.filter((r) => r.ok).length;
  return { passed, failed: results.length - passed, results };
}

/** Built-in minimal suite (also mirrored by scripts/fixtures). */
export const BUILTIN_POLICY_REGRESSION_CASES: PolicyRegressionCase[] = [
  {
    id: "reject-lowers-weight",
    description: "Explicit reject lowers the strategy weight",
    events: [
      {
        signal: "reject",
        source: "explicit",
        decisionType: "point_verdict",
        strategyId: "unfamiliar_approach",
      },
    ],
    expect: {
      weights: {
        unfamiliar_approach: { op: "lt", value: 0.5 },
      },
    },
  },
  {
    id: "accept-raises-weight",
    description: "Explicit accept raises the strategy weight",
    events: [
      {
        signal: "accept",
        source: "explicit",
        decisionType: "point_verdict",
        strategyId: "goal_mismatch",
      },
    ],
    expect: {
      weights: {
        goal_mismatch: { op: "gt", value: 0.5 },
      },
    },
  },
  {
    id: "unsure-no-move",
    description: "Unsure must not change weights",
    seedPolicy: { weights: { style_dislike: 0.7 } },
    events: [
      {
        signal: "unsure",
        source: "explicit",
        decisionType: "point_verdict",
        strategyId: "style_dislike",
      },
    ],
    expect: {
      weights: {
        style_dislike: { op: "approx", value: 0.7 },
      },
      mustNotRegress: [{ strategyId: "style_dislike", minWeight: 0.7 }],
    },
  },
  {
    id: "tool-observe-skips-bandit",
    description: "Auto tool_selection observe does not touch strategy bandit",
    seedPolicy: { weights: { user_expertise: 0.8 } },
    events: [
      {
        signal: "reject",
        source: "agent_decision",
        decisionType: "tool_selection",
        contextSnapshot: "run_terminal",
        strategyId: "user_expertise",
      },
    ],
    expect: {
      weights: {
        user_expertise: { op: "approx", value: 0.8 },
      },
      mustNotRegress: [{ strategyId: "user_expertise", minWeight: 0.78 }],
    },
  },
  {
    id: "good-strategy-not-regressed",
    description: "Rejecting strategy A must not tank unrelated strategy B",
    seedPolicy: { weights: { style_dislike: 0.82, constraint_conflict: 0.55 } },
    events: [
      {
        signal: "reject",
        source: "explicit",
        decisionType: "point_verdict",
        strategyId: "constraint_conflict",
        attribution: "constraint_conflict",
      },
    ],
    expect: {
      weights: {
        constraint_conflict: { op: "lt", value: 0.55 },
      },
      mustNotRegress: [{ strategyId: "style_dislike", minWeight: 0.8 }],
    },
  },
  {
    id: "hypothesis-confirm-reject-nudge",
    description: "Confirmed reject attribution nudges that failure-mode key down",
    events: [
      {
        signal: "reject",
        source: "hypothesis_confirm",
        decisionType: "point_verdict",
        strategyId: "unfamiliar_approach",
        attribution: "unfamiliar_approach",
      },
    ],
    expect: {
      weights: {
        unfamiliar_approach: { op: "lt", value: 0.5 },
      },
    },
  },
];
