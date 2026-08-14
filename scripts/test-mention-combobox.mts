/**
 * Probe #368: @file mention menu implements the ARIA combobox pattern.
 *
 * Usage: npx tsx scripts/test-mention-combobox.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { t } from "../src/lib/i18n.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src/components/ChatComposer.tsx"), "utf8");

assert.match(src, /role="combobox"/);
assert.match(src, /aria-autocomplete="list"/);
assert.match(src, /aria-expanded=\{mentionOpen\}/);
assert.match(src, /aria-controls=\{mentionOpen \? listboxId/);
assert.match(src, /aria-activedescendant=\{activeOptionId\}/);
assert.match(src, /aria-haspopup="listbox"/);
assert.match(src, /role="listbox"/);
assert.match(src, /role="option"/);
assert.match(src, /aria-selected=\{selected\}/);
assert.match(src, /composer\.mentionListAria/);
assert.match(src, /e\.key === "Home"/);
assert.match(src, /e\.key === "End"/);
assert.doesNotMatch(
  src,
  /role="listbox"[\s\S]*?<button[\s\S]*?fn-at-option/,
  "options should be role=option elements, not nested buttons",
);

assert.ok(t("composer.mentionListAria", undefined, "en").trim());
assert.ok(t("composer.mentionListAria", undefined, "zh").trim());

console.log("[PASS] mention ARIA combobox pattern");
console.log("test-mention-combobox: ok");
