/**
 * Probe #348: Clarify selection toolbar must open from touch/pen as well as mouse.
 *
 * Usage: npx tsx scripts/test-touch-clarify-selection.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/components/SelectableMarkdown.tsx", "utf8");

assert.ok(
  source.includes("syncToolbarFromSelection"),
  "selection sync helper must exist",
);
assert.ok(source.includes("onMouseUp={handleMouseUp}"), "mouse path kept");
assert.ok(
  source.includes("onPointerUp={handlePointerUp}"),
  "pointer/touch path must be wired",
);
assert.ok(
  source.includes('e.pointerType === "mouse"'),
  "pointer handler must skip mouse (mouseup owns that path)",
);
assert.ok(
  source.includes("touchSelectGraceUntilRef"),
  "touch grace window for delayed selectionchange",
);
assert.ok(
  /selectionchange[\s\S]*syncToolbarFromSelection/.test(source) ||
    /syncToolbarFromSelection[\s\S]*selectionchange/.test(source),
  "selectionchange must sync toolbar during touch grace",
);

console.log("[PASS] touch/pen selection opens Clarify toolbar");
console.log("test-touch-clarify-selection: ok");
