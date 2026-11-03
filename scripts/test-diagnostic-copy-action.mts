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

// Diagnose and Save Agent trace live in one labelled "Report a problem" menu
// instead of two unlabelled icons; every icon gets an instant name label.
assert.ok(/aria-haspopup="menu"/.test(actions), "report button opens a menu");
assert.equal((actions.match(/role="menuitem"/g) ?? []).length, 2, "menu has diagnose + save trace items");
assert.ok(/onClick=\{\(\) => void diagnose\(\)\}[\s\S]*chat\.diagnose[\s\S]*chat\.diagnoseTitle/.test(actions),
  "diagnose item shows its name and a hint");
assert.ok(/disabled=\{traceDisabled\}[\s\S]*chat\.saveTrace[\s\S]*chat\.traceMissing/.test(actions),
  "save trace item is greyed out with a reason when the reply has no trace");
assert.ok(!/\btitle=\{/.test(actions), "icons use the instant data-tip label, not the slow native title");
assert.equal((actions.match(/data-tip=/g) ?? []).length, 3, "copy, edit and report all have labels");
const css = readFileSync("src/index.css", "utf8");
assert.ok(/\.fn-msg-action\[data-tip\]:hover::after/.test(css), "label shows on hover without delay");
assert.ok(/const hasMessageTrace = useCallback[\s\S]*getAgentTrace/.test(panel), "menu asks whether a trace exists");

console.log("[PASS] diagnostic copy action");
console.log("test-diagnostic-copy-action: ok");
