/**
 * Regression: AgentActivityPanels must not select with `?? []` / `: []`.
 * Fresh empty arrays each getSnapshot trip React useSyncExternalStore and
 * crash the app with "Maximum update depth exceeded" / React error #185.
 *
 * Usage: npx tsx scripts/test-agent-activity-snapshot-stable.mts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EMPTY_AGENT_ACTIVITY,
  EMPTY_AGENT_CHANGES,
  projectAgentSessionUi,
} from "../src/lib/agentSessionActivity.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const statusBar = fs.readFileSync(
  path.join(root, "src/components/ProjectStatusBar.tsx"),
  "utf8",
);

assert.match(
  statusBar,
  /useAppStore\(\(s\) => s\.agentActivity\)/,
  "AgentActivityPanels must select stable store.agentActivity",
);
assert.match(
  statusBar,
  /useAppStore\(\(s\) => s\.agentChanges\)/,
  "AgentActivityPanels must select stable store.agentChanges",
);
assert.equal(
  /agentActivityBySession\[s\.activeSessionId\]\s*\?\?\s*\[\]/.test(statusBar),
  false,
  "must not use ?? [] inside Zustand selectors (unstable getSnapshot)",
);
assert.equal(
  /agentChangesBySession\[s\.activeSessionId\]\s*\?\?\s*\[\]/.test(statusBar),
  false,
  "must not use ?? [] inside Zustand selectors (unstable getSnapshot)",
);
console.log("[PASS] ProjectStatusBar selectors avoid fresh [] snapshots");

{
  const a = projectAgentSessionUi(null, {}, {});
  const b = projectAgentSessionUi(null, {}, {});
  assert.equal(a.agentActivity, EMPTY_AGENT_ACTIVITY);
  assert.equal(a.agentChanges, EMPTY_AGENT_CHANGES);
  assert.equal(a.agentActivity, b.agentActivity);
  assert.equal(a.agentChanges, b.agentChanges);

  const missing = projectAgentSessionUi("s-missing", {}, {});
  assert.equal(missing.agentActivity, EMPTY_AGENT_ACTIVITY);
  assert.equal(missing.agentChanges, EMPTY_AGENT_CHANGES);
  console.log("[PASS] projectAgentSessionUi reuses stable empty arrays");
}

console.log("All agent-activity snapshot stability checks passed.");
