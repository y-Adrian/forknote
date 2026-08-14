/**
 * Probe #361: agent activity / file-change arrays must be keyed by session so
 * switching notes neither clears in-flight work nor mixes events across sessions.
 *
 * Usage: npx tsx scripts/test-agent-activity-by-session.mts
 */
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import type { AgentActivity, AgentFileChange } from "../src/lib/agentTools.ts";
import {
  appendSessionAgentActivity,
  appendSessionAgentChange,
  clearSessionAgentUiMaps,
  projectAgentSessionUi,
} from "../src/lib/agentSessionActivity.ts";
import type { ChatSession } from "../src/types.ts";

Object.defineProperty(globalThis, "crypto", {
  configurable: true,
  value: webcrypto,
});

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  },
});

const activityA: AgentActivity = {
  id: "act-a",
  kind: "read",
  message: "read src/a.ts",
  at: 1,
};
const activityB: AgentActivity = {
  id: "act-b",
  kind: "write",
  message: "wrote src/b.ts",
  at: 2,
};
const changeA: AgentFileChange = { path: "src/a.ts", size: 10, at: 1 };

{
  let byActivity: Record<string, AgentActivity[]> = {};
  let byChanges: Record<string, AgentFileChange[]> = {};

  byActivity = appendSessionAgentActivity(byActivity, "s-a", activityA);
  byChanges = appendSessionAgentChange(byChanges, "s-a", changeA);
  byActivity = appendSessionAgentActivity(byActivity, "s-b", activityB);

  const projectedA = projectAgentSessionUi("s-a", byActivity, byChanges);
  assert.deepEqual(projectedA.agentActivity, [activityA]);
  assert.deepEqual(projectedA.agentChanges, [changeA]);

  const projectedB = projectAgentSessionUi("s-b", byActivity, byChanges);
  assert.deepEqual(projectedB.agentActivity, [activityB]);
  assert.deepEqual(projectedB.agentChanges, []);

  // Clearing B must not wipe A's in-flight log.
  const cleared = clearSessionAgentUiMaps(byActivity, byChanges, "s-b");
  assert.deepEqual(cleared.agentActivityBySession["s-a"], [activityA]);
  assert.equal(cleared.agentActivityBySession["s-b"], undefined);
  assert.deepEqual(cleared.agentChangesBySession["s-a"], [changeA]);
  console.log("[PASS] pure helpers isolate activity/changes per session");
}

{
  const sessionA: ChatSession = {
    id: "s-a",
    title: "Session A",
    createdAt: 1,
    updatedAt: 1,
    thread: null,
  };
  const sessionB: ChatSession = {
    id: "s-b",
    title: "Session B",
    createdAt: 2,
    updatedAt: 2,
    thread: null,
  };
  values.set(
    "forknote-sessions-v1",
    JSON.stringify({
      sessions: [sessionA, sessionB],
      activeSessionId: "s-a",
    }),
  );

  const { useAppStore } = await import("../src/store/useAppStore.ts");
  useAppStore.getState().init();
  assert.equal(useAppStore.getState().activeSessionId, "s-a");

  // Simulate mid-turn activity on A (as onAgentActivity would).
  useAppStore.setState((s) => {
    const agentActivityBySession = appendSessionAgentActivity(
      s.agentActivityBySession,
      "s-a",
      activityA,
    );
    const agentChangesBySession = appendSessionAgentChange(
      s.agentChangesBySession,
      "s-a",
      changeA,
    );
    return {
      agentActivityBySession,
      agentChangesBySession,
      ...projectAgentSessionUi(
        s.activeSessionId,
        agentActivityBySession,
        agentChangesBySession,
      ),
      loadingMainBySession: { ...s.loadingMainBySession, "s-a": true },
    };
  });

  assert.equal(useAppStore.getState().agentActivity.length, 1);
  assert.equal(useAppStore.getState().agentChanges.length, 1);

  // Background append while viewing B must land on A's bucket only.
  useAppStore.getState().switchSession("s-b");
  assert.equal(useAppStore.getState().activeSessionId, "s-b");
  assert.deepEqual(useAppStore.getState().agentActivity, []);
  assert.deepEqual(useAppStore.getState().agentChanges, []);
  assert.deepEqual(useAppStore.getState().agentActivityBySession["s-a"], [
    activityA,
  ]);

  useAppStore.setState((s) => {
    const agentActivityBySession = appendSessionAgentActivity(
      s.agentActivityBySession,
      "s-a",
      activityB,
    );
    return {
      agentActivityBySession,
      ...projectAgentSessionUi(
        s.activeSessionId,
        agentActivityBySession,
        s.agentChangesBySession,
      ),
    };
  });

  // Still on B: projected UI stays empty; A's map grew.
  assert.deepEqual(useAppStore.getState().agentActivity, []);
  assert.deepEqual(useAppStore.getState().agentActivityBySession["s-a"], [
    activityA,
    activityB,
  ]);

  useAppStore.getState().switchSession("s-a");
  assert.deepEqual(useAppStore.getState().agentActivity, [
    activityA,
    activityB,
  ]);
  assert.deepEqual(useAppStore.getState().agentChanges, [changeA]);
  console.log(
    "[PASS] switchSession preserves per-session activity and projects correctly",
  );
}

console.log("All #361 agent-activity-by-session probes passed.");
