/**
 * Probe (#463): in an empty session the composer must sit in a non-shrinking
 * bottom footer, not inside the vertically centred intro group — otherwise
 * resizing it from the top handle moves its bottom edge too.
 *
 * Usage: npx tsx scripts/test-empty-composer-footer.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync("src/components/MainPanel.tsx", "utf8");
const emptyStart = panel.indexOf('<main className="ds-main ds-main-empty fn-main-empty">');
const emptyEnd = panel.indexOf("</main>", emptyStart);
assert.ok(emptyStart >= 0 && emptyEnd > emptyStart, "empty-session layout found");
const empty = panel.slice(emptyStart, emptyEnd);

const introStart = empty.indexOf('<div className="fn-empty">');
const footerStart = empty.indexOf('<footer className="ds-chat-footer fn-empty-footer">');
const composerAt = empty.indexOf("<ChatComposer");
assert.ok(footerStart > introStart, "empty session has a bottom footer after the intro");
assert.ok(composerAt > footerStart, "the composer is inside the footer");
const intro = empty.slice(introStart, footerStart);
assert.ok(!intro.includes("<ChatComposer"), "the composer is not inside the centred intro group");

const css = readFileSync("src/index.css", "utf8");
assert.match(css, /\.ds-chat-footer \{[^}]*flex-shrink: 0/, "the footer does not shrink");
assert.match(css, /\.fn-empty \{[^}]*min-height: 0;[^}]*overflow-y: auto/, "the intro scrolls instead of pushing the footer");

console.log("test-empty-composer-footer: ok");
