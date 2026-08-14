/**
 * Probe #387: compress suggestion banner must not stay mounted as a hidden
 * layout placeholder when suppressed (e.g. archive mode).
 *
 * Usage: npx tsx scripts/test-compress-suggest-no-placeholder.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync("src/components/MainPanel.tsx", "utf8");
const css = readFileSync("src/index.css", "utf8");

// Gate on the visible banner flag — not the broader showCompressSuggest alone.
assert.match(
  main,
  /\{showCompressSuggestBanner && \(/,
  "compress banner must mount only when showCompressSuggestBanner is true",
);

// Old failure mode: mount on showCompressSuggest then hide with is-placeholder.
assert.doesNotMatch(
  main,
  /showCompressSuggest && \([\s\S]*?is-placeholder/,
  "must not mount compress banner as is-placeholder when suppressed",
);
assert.doesNotMatch(
  main,
  /fn-context-banner-footer\$\{[^}]*is-placeholder/,
  "compress banner className must not toggle is-placeholder",
);

assert.doesNotMatch(
  css,
  /\.fn-context-banner-footer\.is-placeholder/,
  "unused footer placeholder CSS should be removed",
);

// Footer hint may still use placeholder for archive/live stability — scoped leave.
assert.match(
  css,
  /\.fn-context-composer-hint\.is-placeholder/,
  "composer hint placeholder for archive mode may remain",
);

console.log("[PASS] compress suggestion has no hidden placeholder layout");
console.log("test-compress-suggest-no-placeholder: ok");
