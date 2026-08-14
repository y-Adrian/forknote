/**
 * Probe #374: editing a user message must focus the composer and place the
 * caret at the end of the restored text.
 *
 * Usage: npx tsx scripts/test-composer-focus-after-edit.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  selectionRangeForCaret,
} from "../src/lib/composerFocus.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Prove caret placement helper (end is the edit UX).
assert.deepEqual(selectionRangeForCaret(0, "end"), { start: 0, end: 0 });
assert.deepEqual(selectionRangeForCaret(12, "end"), { start: 12, end: 12 });
assert.deepEqual(selectionRangeForCaret(12, "start"), { start: 0, end: 0 });
assert.deepEqual(selectionRangeForCaret(-3, "end"), { start: 0, end: 0 });

const composer = readFileSync(
  join(root, "src/components/ChatComposer.tsx"),
  "utf8",
);
assert.match(composer, /useImperativeHandle/);
assert.match(composer, /forwardRef/);
assert.match(composer, /ChatComposerHandle/);
assert.match(composer, /selectionRangeForCaret/);
assert.match(composer, /opts\?\.caret \?\? "end"/);

const main = readFileSync(join(root, "src/components/MainPanel.tsx"), "utf8");
assert.match(main, /composerRef/);
assert.match(main, /focusComposerAfterEditRef/);
assert.match(
  main,
  /editUserMessage[\s\S]*?focusComposerAfterEditRef\.current = true/,
);
assert.match(main, /composerRef\.current\?\.focus\(\{\s*caret:\s*"end"\s*\}\)/);
assert.match(main, /<ChatComposer[\s\S]*?ref=\{composerRef\}/);

console.log("ok: composer focuses after edit with end caret");
