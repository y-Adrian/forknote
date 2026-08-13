/**
 * Tests: cross-session User Model persistence + LLM Reflect parse/clamp.
 */
import assert from "node:assert/strict";
import { createFeedbackEvent } from "../src/lib/feedback.ts";
import {
  AgentLoopController,
} from "../src/lib/agentLoop.ts";
import { toToolResult } from "../src/lib/agentResult.ts";
import {
  clampReflectDecision,
  parseReflectDecision,
  shouldAskLlmReflect,
} from "../src/lib/llmReflect.ts";
import {
  applyFeedbackToUserModel,
  buildUserModelFromFeedbackLog,
  emptyUserModel,
  formatUserModelForAgent,
} from "../src/lib/userModel.ts";
import {
  loadPersistedUserModel,
  mergeUserModels,
  persistFeedbackIntoUserModel,
  savePersistedUserModel,
  seedPersistedUserModelFromSessions,
  USER_MODEL_STORAGE_KEY,
  resolveUserModelForAgent,
} from "../src/lib/userModelStore.ts";

/** Minimal localStorage for Node. */
function installMemoryStorage() {
  const map = new Map<string, string>();
  const storage = {
    getItem(k: string) {
      return map.has(k) ? map.get(k)! : null;
    },
    setItem(k: string, v: string) {
      map.set(k, String(v));
    },
    removeItem(k: string) {
      map.delete(k);
    },
    clear() {
      map.clear();
    },
  };
  (globalThis as { localStorage?: typeof storage }).localStorage = storage;
  return storage;
}

function testPersistAndResolve() {
  const store = installMemoryStorage();
  store.clear();

  const accept = createFeedbackEvent({
    targetId: "m1",
    pointIndex: 1,
    signal: "accept",
    decisionType: "tool_selection",
    contextSnapshot: "read_file",
    source: "explicit",
  });
  persistFeedbackIntoUserModel(accept);
  const loaded = loadPersistedUserModel();
  assert.ok(loaded.preferences["tool_selection.read_file"]);
  assert.equal(
    loaded.preferences["tool_selection.read_file"]!.prefer,
    "read_file",
  );

  // New "session" with empty log still sees global confidence after enough boosts.
  let model = emptyUserModel();
  for (let i = 0; i < 4; i++) {
    model = applyFeedbackToUserModel(model, {
      ...accept,
      id: `e${i}`,
      at: Date.now() + i,
    });
  }
  savePersistedUserModel(model);
  const text = formatUserModelForAgent(resolveUserModelForAgent([]));
  assert.ok(text);
  assert.match(text!, /cross-session|read_file/);

  console.log("ok persist and resolve");
}

function testMergeConflictDampens() {
  installMemoryStorage().clear();
  const global = emptyUserModel();
  global.preferences["strategy.goal_mismatch"] = {
    prefer: "goal_mismatch",
    confidence: 0.8,
    samples: 5,
    updatedAt: 100,
  };
  const session = emptyUserModel();
  session.preferences["strategy.goal_mismatch"] = {
    prefer: "constraint_violation",
    confidence: 0.9,
    samples: 1,
    updatedAt: 200,
  };
  const merged = mergeUserModels(global, session);
  assert.equal(
    merged.preferences["strategy.goal_mismatch"]!.prefer,
    "constraint_violation",
  );
  assert.ok(merged.preferences["strategy.goal_mismatch"]!.confidence <= 0.65);
  console.log("ok merge conflict dampens");
}

function testSeedFromSessions() {
  const store = installMemoryStorage();
  store.clear();
  const ev = createFeedbackEvent({
    targetId: "old",
    pointIndex: 0,
    signal: "accept",
    decisionType: "plan_approval",
    contextSnapshot: "step1",
  });
  // Boost enough for inject threshold.
  const log = [ev, ev, ev, ev].map((e, i) => ({
    ...e,
    id: `s${i}`,
    at: Date.now() + i,
  }));
  let boosted = emptyUserModel();
  for (const e of log) boosted = applyFeedbackToUserModel(boosted, e);
  // seed only when empty
  seedPersistedUserModelFromSessions([log]);
  const seeded = loadPersistedUserModel();
  assert.ok(Object.keys(seeded.preferences).length > 0);

  // Second seed is no-op (does not wipe)
  seedPersistedUserModelFromSessions([[]]);
  assert.deepEqual(
    Object.keys(loadPersistedUserModel().preferences),
    Object.keys(seeded.preferences),
  );
  assert.ok(USER_MODEL_STORAGE_KEY);
  console.log("ok seed from sessions");
}

function testParseReflect() {
  assert.equal(
    parseReflectDecision('{"decision":"replan","reason":"params wrong"}'),
    "replan",
  );
  assert.equal(parseReflectDecision("retry"), "retry");
  assert.equal(parseReflectDecision("nope"), null);
  assert.equal(
    clampReflectDecision("abort", ["retry", "replan"], "retry"),
    "retry",
  );
  assert.equal(
    clampReflectDecision("replan", ["retry", "replan", "abort"], "retry"),
    "replan",
  );
  console.log("ok parse/clamp reflect");
}

function testShouldAskLlm() {
  const fail = toToolResult({
    ok: false,
    resultText: "Error: something weird happened",
  });
  const loop = new AgentLoopController();
  const observed = loop.recordToolResults([{ tool: "read_file", result: fail }]);
  assert.equal(
    shouldAskLlmReflect(
      { observed, expectedOutcome: "file contents loaded" },
      "retry",
    ),
    true,
  );
  assert.equal(
    shouldAskLlmReflect({ observed }, "abort"),
    false,
  );
  assert.equal(
    shouldAskLlmReflect({ observed }, "retry"),
    observed.primaryErrorType === "unknown",
  );
  console.log("ok shouldAskLlmReflect");
}

function testPeekCommitParity() {
  const loop = new AgentLoopController({ maxStepRetries: 2, maxReplans: 1 });
  const fail = toToolResult({
    ok: false,
    resultText: "Error: path is required",
  });
  const observed = loop.recordToolResults([{ tool: "x", result: fail }]);
  const peeked = loop.peekReflect({ observed });
  assert.equal(peeked, "retry");
  assert.equal(loop.stepRetries, 0); // peek does not mutate
  loop.commitReflect(peeked, observed);
  assert.equal(loop.stepRetries, 1);
  console.log("ok peek/commit parity");
}

function testBuildFromSessionStillWorks() {
  installMemoryStorage().clear();
  const ev = createFeedbackEvent({
    targetId: "m",
    pointIndex: 1,
    signal: "reject",
    decisionType: "point_verdict",
    strategyId: "goal_mismatch",
  });
  const model = buildUserModelFromFeedbackLog([ev]);
  assert.ok(model.preferences["strategy.goal_mismatch"]);
  console.log("ok session rebuild");
}

testPersistAndResolve();
testMergeConflictDampens();
testSeedFromSessions();
testParseReflect();
testShouldAskLlm();
testPeekCommitParity();
testBuildFromSessionStillWorks();
console.log("all user-model / llm-reflect tests passed");
