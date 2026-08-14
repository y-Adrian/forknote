/**
 * Probe #346: mutation requests must not complete on a "no tools needed" plan.
 *
 * Usage: npx tsx scripts/test-mutation-plan-tools.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  looksLikeMutationRequest,
  mutationPlanNoToolsAction,
  planNeedsToolApproval,
} from "../src/lib/agentTools.ts";

{
  const source = readFileSync("src/lib/agentTurn.ts", "utf8");
  assert.ok(source.includes("mutationPlanNoToolsAction"));
  assert.ok(source.includes("replan_or_execute"));
  assert.ok(
    source.includes("requireToolBatch: true"),
    "forced mutation execution must require a tool batch",
  );
  console.log("[PASS] agentTurn wires mutationPlanNoToolsAction");
}

const noToolsPlan = "无需工具。任务已完成，无需修改任何文件。";
assert.equal(planNeedsToolApproval(noToolsPlan, []), false);

assert.equal(
  mutationPlanNoToolsAction({
    planNeedsTools: false,
    userText: "What is a gossip protocol?",
  }),
  "complete",
);
assert.equal(
  mutationPlanNoToolsAction({
    planNeedsTools: false,
    userText: "创建一个 hello.ts",
    createPath: "hello.ts",
  }),
  "force_execute",
);
assert.equal(
  mutationPlanNoToolsAction({
    planNeedsTools: false,
    userText: "改一下 README.md",
  }),
  "replan_or_execute",
);
assert.ok(looksLikeMutationRequest("改一下 README.md"));
assert.equal(
  mutationPlanNoToolsAction({
    planNeedsTools: false,
    userText: "run npm install",
    shellIntent: { readOnly: false },
  }),
  "replan_or_execute",
);
assert.equal(
  mutationPlanNoToolsAction({
    planNeedsTools: true,
    userText: "改一下 README.md",
  }),
  "complete",
);
assert.equal(
  mutationPlanNoToolsAction({
    planNeedsTools: false,
    userText: "ls src",
    shellIntent: { readOnly: true },
  }),
  "complete",
);

console.log("[PASS] mutation no-tools plans force execute/replan");
console.log("test-mutation-plan-tools: ok");
