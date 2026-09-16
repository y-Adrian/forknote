/**
 * Probe: diagnostic copy is a separate action from answer-copy/passive-use.
 *
 * Usage: npx tsx scripts/test-diagnostic-copy-action.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const actions = readFileSync("src/components/MessageActions.tsx", "utf8");
const diagnoseFn = actions.slice(
  actions.indexOf("const diagnose = async"),
  actions.indexOf("const label ="),
);

assert.ok(diagnoseFn.includes("onDiagnose"), "diagnose uses onDiagnose callback");
assert.ok(!diagnoseFn.includes("onCopy"), "diagnose must not emit passive copy feedback");
assert.ok(
  actions.includes("chat.diagnoseCopied") &&
    actions.includes("chat.diagnoseTitle"),
  "diagnostic action has distinct labels",
);

const panel = readFileSync("src/components/MainPanel.tsx", "utf8");
assert.ok(
  /const copyMessage = useCallback[\s\S]*recordPassiveCopy/.test(panel),
  "normal copy still records passive copy",
);
assert.ok(
  /const diagnoseMessage = useCallback[\s\S]*buildTurnDiagnosticPacket/.test(panel),
  "diagnostic copy builds a packet through its own callback",
);
assert.ok(
  /const diagnoseMessage = useCallback[\s\S]*import\(\s*["']\.\.\/lib\/conversationDiagnostic["']\s*\)/.test(panel),
  "diagnostic module loads only when diagnostic copy is requested",
);
assert.ok(
  !/import \{ buildTurnDiagnosticPacket \} from ["']\.\.\/lib\/conversationDiagnostic["']/.test(panel),
  "diagnostic module must not be imported into the main panel entry",
);
assert.ok(
  !/const diagnoseMessage = useCallback[\s\S]*recordPassiveCopy/.test(panel),
  "diagnostic copy must not record passive copy",
);

console.log("[PASS] diagnostic copy action");
console.log("test-diagnostic-copy-action: ok");
