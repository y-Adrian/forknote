/**
 * Probe #347: shared modals must portal above branch float stacking.
 *
 * Usage: npx tsx scripts/test-modal-above-floats.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FLOAT_Z_ASK_OFFSET,
  FLOAT_Z_BASE,
  FLOAT_Z_TOOLBAR_OFFSET,
  MODAL_Z_INDEX,
} from "../src/lib/branchFloat.ts";

const css = readFileSync("src/index.css", "utf8");
assert.ok(css.includes("--fn-z-modal:"), "CSS must define --fn-z-modal");
assert.ok(
  /\.modal-backdrop\s*\{[^}]*z-index:\s*var\(--fn-z-modal\)/s.test(css),
  ".modal-backdrop must use --fn-z-modal",
);

const modalVar = css.match(/--fn-z-modal:\s*(\d+)/);
assert.ok(modalVar, "parse --fn-z-modal");
const cssModalZ = Number(modalVar![1]);
assert.equal(cssModalZ, MODAL_Z_INDEX, "CSS and TS modal z-index must match");

const floatCeiling =
  FLOAT_Z_BASE + FLOAT_Z_TOOLBAR_OFFSET + FLOAT_Z_ASK_OFFSET + 50;
assert.ok(
  MODAL_Z_INDEX > floatCeiling,
  `modal z-index ${MODAL_Z_INDEX} must clear float overlays (~${floatCeiling})`,
);
assert.ok(MODAL_Z_INDEX < 1200, "modals stay below session menus (~1200)");
console.log("[PASS] modal stacking clears branch floats");

const primitive = readFileSync("src/components/AccessibleModal.tsx", "utf8");
assert.ok(primitive.includes("createPortal"), "AccessibleModal must use createPortal");
assert.ok(primitive.includes("document.body"), "AccessibleModal must portal to body");
assert.ok(
  primitive.includes('backdropClassName = "modal-backdrop"'),
  "AccessibleModal must default to the shared modal backdrop",
);

for (const [file, label] of [
  ["src/components/SettingsPanel.tsx", "Settings"],
  ["src/components/ProjectPanel.tsx", "Project"],
  ["src/components/ArchivePanel.tsx", "Archive"],
] as const) {
  const source = readFileSync(file, "utf8");
  assert.ok(
    source.includes("AccessibleModal"),
    `${label} must use AccessibleModal`,
  );
  assert.ok(
    !source.includes("createPortal"),
    `${label} should delegate portal behavior to AccessibleModal`,
  );
  console.log(`[PASS] ${label} uses shared accessible modal above floats`);
}

console.log("test-modal-above-floats: ok");
