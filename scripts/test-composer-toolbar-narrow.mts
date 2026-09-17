/**
 * Probe #350: composer toolbar must not clip controls on narrow screens.
 *
 * Usage: npx tsx scripts/test-composer-toolbar-narrow.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync("src/index.css", "utf8");
const block = css.slice(
  css.indexOf(".fn-composer-toolbar-row {"),
  css.indexOf(".fn-composer-toolbar-sep {"),
);

assert.ok(block.includes("flex-wrap: wrap"), "toolbar row must wrap");
assert.ok(
  !block.includes("flex-wrap: nowrap"),
  "toolbar row must not force nowrap",
);
assert.ok(
  !/overflow:\s*hidden/.test(block),
  "toolbar row must not clip with overflow:hidden",
);
assert.ok(
  block.includes("overflow-x: auto") || block.includes("overflow-x:auto"),
  "toolbar row keeps horizontal scroll as a safety net",
);

const main = readFileSync("src/components/MainPanel.tsx", "utf8");
assert.ok(main.includes("fn-composer-toolbar-row"));
assert.ok(main.includes("fn-composer-memory-actions") || main.includes("Memory"));

const phoneComposer = css.slice(
  css.indexOf("@media (max-width: 560px) {", css.indexOf(".fn-composer-actions")),
  css.indexOf(".fn-send-btn,", css.indexOf("@media (max-width: 560px) {", css.indexOf(".fn-composer-actions"))),
);
assert.match(
  phoneComposer,
  /\.fn-composer-hint\s*\{[^}]*display:\s*none/s,
  "phone composer must hide guidance that would squeeze controls",
);
assert.match(
  phoneComposer,
  /\.fn-session-api-btn\s*\{[^}]*flex:\s*1 1 auto[^}]*max-width:\s*none/s,
  "phone API control must shrink within the available action row",
);
console.log("[PASS] composer toolbar remains reachable on narrow screens");
console.log("test-composer-toolbar-narrow: ok");
