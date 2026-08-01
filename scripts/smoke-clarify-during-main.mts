/**
 * Clarify gate: parallel with main, queue when branch busy.
 */
import assert from "node:assert/strict";
import {
  canStartAskBranch,
  shouldClearPendingPlanForClarify,
  shouldQueueClarify,
} from "../src/lib/clarifyGate.ts";

assert.equal(
  canStartAskBranch({ loadingMain: true, loadingBranch: false }),
  true,
);
assert.equal(
  canStartAskBranch({ loadingMain: false, loadingBranch: true }),
  false,
);

assert.equal(
  shouldQueueClarify({ loadingMain: false, loadingBranch: true }),
  true,
);
assert.equal(
  shouldQueueClarify({ loadingMain: true, loadingBranch: false }),
  false,
);
assert.equal(
  shouldQueueClarify({ loadingMain: true, loadingBranch: true }),
  true,
);

assert.equal(
  shouldClearPendingPlanForClarify({
    loadingMain: true,
    pendingBranchId: null,
  }),
  false,
);
assert.equal(
  shouldClearPendingPlanForClarify({
    loadingMain: true,
    pendingBranchId: "b1",
  }),
  true,
);

console.log("smoke-clarify-during-main: ok");
