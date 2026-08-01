/**
 * Clarify may run during main generation; not during another branch turn.
 */
import assert from "node:assert/strict";
import {
  canStartAskBranch,
  shouldClearPendingPlanForClarify,
} from "../src/lib/clarifyGate.ts";

assert.equal(
  canStartAskBranch({ loadingMain: true, loadingBranch: false }),
  true,
);
assert.equal(
  canStartAskBranch({ loadingMain: false, loadingBranch: false }),
  true,
);
assert.equal(
  canStartAskBranch({ loadingMain: true, loadingBranch: true }),
  false,
);
assert.equal(
  canStartAskBranch({ loadingMain: false, loadingBranch: true }),
  false,
);

assert.equal(
  shouldClearPendingPlanForClarify({
    loadingMain: true,
    pendingBranchId: null,
  }),
  false,
  "do not clear main pending plan while main is loading",
);
assert.equal(
  shouldClearPendingPlanForClarify({
    loadingMain: true,
    pendingBranchId: "b1",
  }),
  true,
);
assert.equal(
  shouldClearPendingPlanForClarify({
    loadingMain: false,
    pendingBranchId: null,
  }),
  true,
);

console.log("smoke-clarify-during-main: ok");
