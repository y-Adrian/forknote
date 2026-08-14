/**
 * Probe #354: dirty Settings drafts (API / Memory / PlantUML) must confirm
 * before backdrop/Escape/close discards them.
 *
 * Usage: npx tsx scripts/test-dirty-settings-close.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  apiSettingsEqual,
  normalizeApiSettings,
} from "../src/lib/settings.ts";

const base = normalizeApiSettings({});
assert.equal(apiSettingsEqual(base, {}), true, "defaults equal empty partial");
assert.equal(
  apiSettingsEqual(base, { ...base, model: base.model }),
  true,
  "identical models stay clean",
);
assert.equal(
  apiSettingsEqual(base, { ...base, model: `${base.model}-dirty` }),
  false,
  "model edit is dirty",
);
assert.equal(
  apiSettingsEqual(base, {
    ...base,
    plantumlRenderMode: base.plantumlRenderMode === "off" ? "server" : "off",
  }),
  false,
  "PlantUML mode edit is dirty",
);
assert.equal(
  apiSettingsEqual(base, {
    ...base,
    memoryLayerSession: !(base.memoryLayerSession ?? false),
  }),
  false,
  "Memory layer edit is dirty",
);
console.log("[PASS] apiSettingsEqual detects API / Memory / PlantUML dirtiness");

const panel = readFileSync("src/components/SettingsPanel.tsx", "utf8");
assert.ok(panel.includes("apiSettingsEqual"), "SettingsPanel must compare draft");
assert.ok(panel.includes("requestClose"), "SettingsPanel must gate close");
assert.ok(
  panel.includes("settings.discardConfirmTitle"),
  "SettingsPanel must show discard confirm copy",
);
assert.ok(
  panel.includes("onClose={requestClose}"),
  "AccessibleModal close must use requestClose (backdrop + Escape)",
);
assert.ok(
  panel.includes("onClick={requestClose}"),
  "header close button must use requestClose",
);
assert.ok(
  /ApiPanel[\s\S]*onClose=\{requestClose\}/.test(panel),
  "API Cancel must use requestClose",
);
console.log("[PASS] SettingsPanel wires dirty close confirmation");

const i18n = readFileSync("src/lib/i18n.ts", "utf8");
for (const key of [
  "settings.discardConfirmAria",
  "settings.discardConfirmTitle",
  "settings.discardConfirmBody",
  "common.discard",
]) {
  const en = i18n.includes(`"${key}":`);
  assert.ok(en, `i18n must define ${key}`);
  const occurrences = i18n.split(`"${key}":`).length - 1;
  assert.equal(occurrences, 2, `${key} must exist for en and zh`);
}
console.log("[PASS] discard confirm i18n keys present in en + zh");

console.log("All #354 dirty-settings-close probes passed.");
