/**
 * Probe #376: point answers defer heavy Markdown/diagram mounts until visible.
 *
 * Usage: npx tsx scripts/test-lazy-point-markdown.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deferredMarkdownPreview,
  shouldMountHeavyMarkdown,
} from "../src/lib/lazyMarkdown.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

assert.equal(shouldMountHeavyMarkdown({ visible: false }), false);
assert.equal(shouldMountHeavyMarkdown({ visible: true }), true);
assert.equal(
  shouldMountHeavyMarkdown({ visible: false, force: true }),
  true,
);

assert.equal(deferredMarkdownPreview("short"), "short");
assert.equal(
  deferredMarkdownPreview("x".repeat(300)).endsWith("…"),
  true,
);
assert.ok(deferredMarkdownPreview("x".repeat(300)).length <= 281);

const pointized = readFileSync(
  join(root, "src/components/PointizedAnswer.tsx"),
  "utf8",
);
assert.match(pointized, /LazyMarkdownBody/);
assert.match(
  pointized,
  /parsed\.points\.map[\s\S]*LazyMarkdownBody[\s\S]*point\.content/,
);
// Verdict anchors must stay on the row wrapper, not inside deferred markdown.
assert.match(pointized, /data-point-index=\{point\.index\}/);
assert.match(
  pointized,
  /data-point-index=\{point\.index\}[\s\S]*LazyMarkdownBody/,
);

const lazy = readFileSync(
  join(root, "src/components/LazyMarkdownBody.tsx"),
  "utf8",
);
assert.match(lazy, /IntersectionObserver/);
assert.match(lazy, /fn-markdown-deferred/);
assert.match(lazy, /shouldMountHeavyMarkdown/);

console.log("ok: point Markdown lazy-mounts until visible");
