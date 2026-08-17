/**
 * Probe #456: composer textarea height is user-resizable with a persisted floor
 * that coexists with auto-grow, plus localized resize aria.
 *
 * Usage: npx tsx scripts/test-composer-resizable-height.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPOSER_HEIGHT_MAX_PX,
  COMPOSER_HEIGHT_MIN_COMPACT,
  COMPOSER_HEIGHT_MIN_HERO,
  COMPOSER_HEIGHT_STORAGE_KEY,
  clampComposerHeight,
  composerHeightMax,
  composerHeightMin,
  resolveComposerHeight,
} from "../src/lib/composerHeight.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

// --- Pure helpers ---
assert.equal(composerHeightMin(true), COMPOSER_HEIGHT_MIN_COMPACT);
assert.equal(composerHeightMin(false), COMPOSER_HEIGHT_MIN_HERO);
assert.ok(composerHeightMax(800) <= COMPOSER_HEIGHT_MAX_PX);
assert.equal(
  clampComposerHeight(10, false),
  COMPOSER_HEIGHT_MIN_HERO,
  "below-min clamps up",
);
assert.equal(
  clampComposerHeight(9999, true, 800),
  composerHeightMax(800),
  "above-max clamps down",
);

// Floor wins when content is shorter.
assert.equal(
  resolveComposerHeight({
    contentHeight: 40,
    floorHeight: 160,
    compact: false,
    viewportHeight: 900,
  }),
  160,
);

// Content can grow above the floor up to max.
assert.equal(
  resolveComposerHeight({
    contentHeight: 200,
    floorHeight: 80,
    compact: false,
    viewportHeight: 900,
  }),
  200,
);

// Null floor → content (clamped to min).
assert.equal(
  resolveComposerHeight({
    contentHeight: 20,
    floorHeight: null,
    compact: true,
    viewportHeight: 900,
  }),
  COMPOSER_HEIGHT_MIN_COMPACT,
);

assert.equal(COMPOSER_HEIGHT_STORAGE_KEY, "forknote-composer-height");

// --- Wiring ---
const composer = read("src/components/ChatComposer.tsx");
assert.match(composer, /fn-composer-resize/);
assert.match(composer, /composer\.resizeAria/);
assert.match(composer, /writeStoredComposerHeight/);
assert.match(composer, /readStoredComposerHeight/);
assert.match(composer, /resolveComposerHeight/);
assert.match(composer, /role="separator"/);
assert.match(composer, /aria-orientation="horizontal"/);
assert.match(composer, /onPointerDown=\{onResizePointerDown\}/);

const css = read("src/index.css");
assert.match(css, /\.fn-composer-resize\b/);
assert.match(css, /cursor:\s*ns-resize/);
assert.match(css, /\.fn-composer\.is-resizing\b/);

const i18n = read("src/lib/i18n.ts");
assert.match(i18n, /"composer\.resizeAria":\s*"Drag to resize input height"/);
assert.match(i18n, /"composer\.resizeAria":\s*"拖动调节输入框高度"/);

const storage = read("src/lib/storage.ts");
assert.match(storage, /composerHeight:\s*"forknote-composer-height"/);

console.log("ok: composer height resize + persist + auto-grow floor");
