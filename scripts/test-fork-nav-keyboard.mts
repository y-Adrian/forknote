/**
 * Probe #349: fork rail / map / highlights are keyboard-activatable, and
 * narrow viewports keep a compact fork map entry when the rail is hidden.
 *
 * Usage: npx tsx scripts/test-fork-nav-keyboard.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isActivationKey } from "../src/lib/keyboard.ts";

assert.equal(isActivationKey("Enter"), true);
assert.equal(isActivationKey(" "), true);
assert.equal(isActivationKey("Spacebar"), true);
assert.equal(isActivationKey("Tab"), false);
console.log("[PASS] activation key helper");

{
  const highlight = readFileSync("src/lib/domHighlight.ts", "utf8");
  assert.ok(highlight.includes('role", "button"') || highlight.includes("role\", \"button\""));
  assert.ok(highlight.includes("tabIndex = 0"));
  assert.ok(highlight.includes("aria-label"));
  console.log("[PASS] highlight marks expose button semantics");
}

{
  const selectable = readFileSync("src/components/SelectableMarkdown.tsx", "utf8");
  assert.ok(selectable.includes("onKeyDown={handleContentKeyDown}"));
  assert.ok(selectable.includes("isActivationKey"));
  console.log("[PASS] SelectableMarkdown handles Enter/Space on highlights");
}

{
  const rail = readFileSync("src/components/BranchRail.tsx", "utf8");
  assert.ok(rail.includes('role="button"'));
  assert.ok(rail.includes("tabIndex={0}"));
  assert.ok(rail.includes("onKeyDown"));
  assert.ok(rail.includes("fork.openNodeAria"));
  console.log("[PASS] BranchRail nodes are keyboard buttons");
}

{
  const map = readFileSync("src/components/ForkHistoryMap.tsx", "utf8");
  assert.ok(map.includes('role="button"'));
  assert.ok(map.includes("tabIndex={0}"));
  assert.ok(map.includes("isActivationKey"));
  assert.ok(map.includes("fork.mapMainStepAria"));
  console.log("[PASS] ForkHistoryMap nodes are keyboard buttons");
}

{
  const css = readFileSync("src/index.css", "utf8");
  assert.ok(css.includes(".ds-branch-rail") && /@media \(max-width: 900px\)[\s\S]*\.ds-branch-rail\s*\{\s*display:\s*none/.test(css));
  assert.ok(
    /@media \(max-width: 900px\)[\s\S]*\.fn-fork-chip/.test(css),
    "narrow viewport must emphasize the compact fork chip entry",
  );
  const main = readFileSync("src/components/MainPanel.tsx", "utf8");
  assert.ok(main.includes('aria-label={t("main.forksTitle")}'));
  console.log("[PASS] compact mobile fork entry remains labeled");
}

console.log("test-fork-nav-keyboard: ok");
