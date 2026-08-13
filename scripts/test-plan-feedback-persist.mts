import assert from "node:assert/strict";
import { createFeedbackEvent } from "../src/lib/feedback.ts";
import {
  commitSessionFeedbackSnapshot,
  type SessionFeedbackSnapshot,
} from "../src/lib/sessionFeedbackCommit.ts";
import { loadSessionStore, saveSessionStore } from "../src/lib/storage.ts";
import {
  loadPersistedUserModel,
  persistFeedbackIntoUserModel,
} from "../src/lib/userModelStore.ts";
import type { ChatSession, FeedbackEvent } from "../src/types.ts";

function installMemoryStorage() {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, String(value));
    },
    removeItem(key: string) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
  };
  (globalThis as { localStorage?: typeof storage }).localStorage = storage;
  return storage;
}

function session(id: string): ChatSession {
  return {
    id,
    title: id,
    thread: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

const storage = installMemoryStorage();
storage.clear();

let sessionWrites = 0;
let userModelWrites = 0;
const effects = {
  persistSessions(sessions: ChatSession[], activeSessionId: string | null) {
    sessionWrites += 1;
    saveSessionStore({ sessions, activeSessionId });
  },
  persistUserModel(event: FeedbackEvent) {
    userModelWrites += 1;
    persistFeedbackIntoUserModel(event);
  },
};

let snapshot: SessionFeedbackSnapshot = {
  sessions: [session("background"), session("active")],
  activeSessionId: "active",
};

const approve = createFeedbackEvent({
  targetId: "assistant-approve",
  pointIndex: 0,
  signal: "accept",
  source: "agent_decision",
  decisionId: "plan_approve",
  decisionType: "plan_approval",
  phase: "await_approval",
});
let result = commitSessionFeedbackSnapshot(
  snapshot,
  "background",
  approve,
  effects,
);
assert.equal(result.committed, true);
snapshot = result;

let reloaded = loadSessionStore();
assert.equal(reloaded.activeSessionId, "active");
assert.deepEqual(
  reloaded.sessions.find((item) => item.id === "background")?.feedbackLog?.map(
    (event) => event.signal,
  ),
  ["accept"],
);
assert.equal(
  reloaded.sessions.find((item) => item.id === "active")?.feedbackLog,
  undefined,
);
assert.equal(
  loadPersistedUserModel().preferences["plan_approval.default"]?.samples,
  1,
);

// A second dispatch for the same plan is ignored even if it has a fresh event id.
const duplicate = createFeedbackEvent({
  targetId: "assistant-approve",
  pointIndex: 0,
  signal: "accept",
  source: "agent_decision",
  decisionId: "plan_approve",
  decisionType: "plan_approval",
  phase: "await_approval",
});
result = commitSessionFeedbackSnapshot(
  snapshot,
  "background",
  duplicate,
  effects,
);
assert.equal(result.committed, false);
assert.equal(sessionWrites, 1);
assert.equal(userModelWrites, 1);
assert.equal(
  loadPersistedUserModel().preferences["plan_approval.default"]?.samples,
  1,
);

const reject = createFeedbackEvent({
  targetId: "assistant-reject",
  pointIndex: 0,
  signal: "reject",
  source: "agent_decision",
  decisionId: "plan_reject",
  decisionType: "plan_approval",
  phase: "await_approval",
});
result = commitSessionFeedbackSnapshot(
  snapshot,
  "background",
  reject,
  effects,
);
assert.equal(result.committed, true);
snapshot = result;
reloaded = loadSessionStore();
assert.deepEqual(
  reloaded.sessions.find((item) => item.id === "background")?.feedbackLog?.map(
    (event) => event.signal,
  ),
  ["accept", "reject"],
);
assert.equal(reloaded.activeSessionId, "active");
assert.equal(
  loadPersistedUserModel().preferences["plan_approval.default"]?.samples,
  2,
);
assert.equal(sessionWrites, 2);
assert.equal(userModelWrites, 2);

// Normal point verdicts still persist through the same commit primitive.
const pointVerdict = createFeedbackEvent({
  targetId: "message-1",
  pointIndex: 1,
  signal: "accept",
  decisionId: "message-1:1",
  decisionType: "point_verdict",
  phase: "reflect",
  contextSnapshot: "point:1",
});
result = commitSessionFeedbackSnapshot(
  snapshot,
  "active",
  pointVerdict,
  effects,
);
assert.equal(result.committed, true);
reloaded = loadSessionStore();
assert.equal(
  reloaded.sessions.find((item) => item.id === "active")?.feedbackLog?.[0]
    ?.decisionType,
  "point_verdict",
);
assert.equal(reloaded.activeSessionId, "active");
assert.equal(sessionWrites, 3);
assert.equal(userModelWrites, 3);

console.log("all plan-feedback persistence tests passed");
