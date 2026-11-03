/**
 * Probe (#492): the session "…" menu and the delete confirmation open below
 * their trigger, and must flip above it when they would run off the bottom
 * of the window (sessions near the bottom of the sidebar).
 *
 * Usage: npx tsx scripts/test-session-menu-in-view.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/components/SessionSidebar.tsx", "utf8");

assert.match(src, /type MenuPos = \{[^}]*anchorTop: number/, "positions remember the trigger's top edge");
assert.match(src, /anchorTop: rect\.top/, "opening the menu records the trigger's top edge");
const hook = src.slice(src.indexOf("function usePopupTop"), src.indexOf("return pos ? (top ?? pos.top) : undefined;"));
assert.ok(hook.length > 0, "usePopupTop exists");
assert.match(hook, /pos\.top \+ height <= window\.innerHeight - POPUP_EDGE/, "checks the popup fits below");
assert.match(hook, /pos\.anchorTop - 4 - height/, "otherwise places it above the trigger");
assert.match(src, /ref=\{menuRef\}[\s\S]*?style=\{\{ top: menuTop,/, "the session menu uses the adjusted top");
assert.match(src, /ref=\{confirmRef\}[\s\S]*?top: confirmTop,/, "the delete confirmation uses the adjusted top");

console.log("test-session-menu-in-view: ok");
