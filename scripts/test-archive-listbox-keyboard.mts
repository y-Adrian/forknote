/**
 * Probe #372: archive history listbox supports arrow-key movement, activation,
 * and focus restoration.
 *
 * Usage: npx tsx scripts/test-archive-listbox-keyboard.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isActivationKey } from "../src/lib/keyboard.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const main = readFileSync(join(root, "src/components/MainPanel.tsx"), "utf8");

assert.equal(isActivationKey("Enter"), true);
assert.equal(isActivationKey(" "), true);

assert.match(main, /role="listbox"/);
assert.match(main, /role="option"/);
assert.match(main, /aria-activedescendant=\{/);
assert.match(main, /onArchiveHistoryListKeyDown/);
assert.match(main, /e\.key === "ArrowDown"/);
assert.match(main, /e\.key === "ArrowUp"/);
assert.match(main, /e\.key === "Home"/);
assert.match(main, /e\.key === "End"/);
assert.match(main, /isActivationKey\(e\.key\)/);
assert.match(main, /archiveHistoryBtnRef\.current\?\.focus\(\)/);
assert.match(main, /archiveHistoryListRef\.current\?\.focus\(\)/);
assert.match(main, /tabIndex=\{0\}/);
assert.match(main, /tabIndex=\{-1\}/);
assert.match(main, /aria-controls=\{/);
assert.match(main, /closeArchiveHistory\(true\)/);

console.log("[PASS] archive history listbox keyboard pattern");
console.log("test-archive-listbox-keyboard: ok");
