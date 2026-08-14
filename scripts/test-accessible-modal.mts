/**
 * Probe #353: shared AccessibleModal provides Escape (topmost), focus helpers,
 * and migrated chrome dialogs use the primitive.
 *
 * Usage: npx tsx scripts/test-accessible-modal.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isEscapeKey,
  modalEscapeStackDepth,
  pushModalEscapeHandler,
  topModalEscapeHandler,
} from "../src/lib/modalFocus.ts";

assert.equal(isEscapeKey("Escape"), true);
assert.equal(isEscapeKey("Esc"), true);
assert.equal(isEscapeKey("Enter"), false);

const closes: string[] = [];
const popOuter = pushModalEscapeHandler(() => closes.push("outer"));
const popInner = pushModalEscapeHandler(() => closes.push("inner"));
assert.equal(modalEscapeStackDepth(), 2);
topModalEscapeHandler()?.();
assert.deepEqual(closes, ["inner"], "Escape must close the topmost modal only");
popInner();
assert.equal(modalEscapeStackDepth(), 1);
topModalEscapeHandler()?.();
assert.deepEqual(closes, ["inner", "outer"]);
popOuter();
assert.equal(modalEscapeStackDepth(), 0);

const modalSrc = readFileSync("src/components/AccessibleModal.tsx", "utf8");
assert.ok(modalSrc.includes('aria-modal="true"'));
assert.ok(modalSrc.includes("pushModalEscapeHandler"));
assert.ok(modalSrc.includes("trapFocusKeydown"));
assert.ok(modalSrc.includes("createPortal"));
assert.ok(modalSrc.includes("listFocusable"));
assert.ok(modalSrc.includes("restoreRef"));
assert.ok(modalSrc.includes("initialFocusRef") || modalSrc.includes("focusInitial"));

for (const file of [
  "src/components/SettingsPanel.tsx",
  "src/components/ProjectPanel.tsx",
  "src/components/ArchivePanel.tsx",
  "src/components/ForkHistoryMap.tsx",
  "src/components/ShareSessionDialog.tsx",
]) {
  const src = readFileSync(file, "utf8");
  assert.ok(
    src.includes("AccessibleModal"),
    `${file} must use AccessibleModal`,
  );
  assert.ok(
    !src.includes("createPortal("),
    `${file} should not hand-roll createPortal chrome`,
  );
}

console.log("[PASS] accessible modal primitive + migrations");
console.log("test-accessible-modal: ok");
