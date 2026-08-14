/**
 * Probe #369: UI honors prefers-reduced-motion (message / float / typing / brand).
 *
 * Usage: npx tsx scripts/test-reduced-motion.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "src/index.css"), "utf8");

// Prove the failure mode existed before the media query block.
assert.match(css, /animation:\s*msgIn\b/);
assert.match(css, /animation:\s*floatIn\b/);
assert.match(css, /animation:\s*dotBounce\b/);
assert.match(css, /animation:\s*brandFloat\b/);

const reduceIdx = css.indexOf("@media (prefers-reduced-motion: reduce)");
assert.ok(reduceIdx >= 0, "missing prefers-reduced-motion media query");

const reduceBlock = css.slice(reduceIdx);
const nextMedia = reduceBlock.indexOf("@media", 1);
const block = nextMedia >= 0 ? reduceBlock.slice(0, nextMedia) : reduceBlock;

assert.match(block, /--dur-fast:\s*0\.01ms/);
assert.match(block, /--dur-base:\s*0\.01ms/);
assert.match(block, /--dur-slow:\s*0\.01ms/);
assert.match(block, /animation-duration:\s*0\.01ms\s*!important/);
assert.match(block, /animation-iteration-count:\s*1\s*!important/);
assert.match(block, /transition-duration:\s*0\.01ms\s*!important/);

assert.match(block, /\.ds-typing span[\s\S]*?animation:\s*none\s*!important/);
assert.match(block, /\.fn-empty-logo \.fn-brand-icon[\s\S]*?animation:\s*none\s*!important/);
assert.match(block, /\.ds-empty-brand \.ds-brand-icon-svg[\s\S]*?animation:\s*none\s*!important/);
assert.match(block, /\.ds-send-spinner[\s\S]*?animation:\s*none\s*!important/);
assert.match(block, /\.fn-turn-busy-spinner[\s\S]*?animation:\s*none\s*!important/);

console.log("[PASS] prefers-reduced-motion honored for msg/float/typing/brand");
console.log("test-reduced-motion: ok");
