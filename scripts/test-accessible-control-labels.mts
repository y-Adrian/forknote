/**
 * Probe #386: verdict / theme / network / source / share controls expose
 * localized accessible names and pressed/checked state.
 *
 * Usage: npx tsx scripts/test-accessible-control-labels.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(rel: string) {
  return readFileSync(rel, "utf8");
}

const point = read("src/components/PointizedAnswer.tsx");
const settings = read("src/components/SettingsPanel.tsx");
const sidebar = read("src/components/SessionSidebar.tsx");
const network = read("src/components/NetworkAccessToggle.tsx");
const main = read("src/components/MainPanel.tsx");
const i18n = read("src/lib/i18n.ts");

// --- Prove prior gaps ---
assert.match(
  point,
  /aria-label=\{t\(opt\.titleKey\)\}/,
  "verdict icon buttons need localized aria-label (not title-only)",
);
assert.match(point, /aria-pressed=\{verdict === opt\.value\}/);
assert.match(
  point,
  /<span aria-hidden>\{\s*opt\.icon\s*\}<\/span>/,
  "verdict glyphs should be aria-hidden so the label is the accessible name",
);

assert.match(
  settings,
  /aria-pressed=\{preference === opt\.value\}/,
  "theme segment buttons need aria-pressed",
);
assert.match(settings, /aria-label=\{t\(opt\.labelKey\)\}/);

assert.match(sidebar, /aria-pressed=\{theme === "dark"\}/);
assert.match(sidebar, /aria-label=\{toLight \? toLightLabel : toDarkLabel\}/);
assert.match(sidebar, /ariaLabel=\{t\("sidebar\.shareMemory"\)\}/);
assert.match(sidebar, /ariaLabel=\{t\("sidebar\.share"\)\}/);
assert.match(sidebar, /role="menuitemcheckbox"/);
assert.match(sidebar, /aria-checked=\{checked\}/);

assert.match(network, /aria-pressed=\{wanted\}/);
assert.match(
  network,
  /aria-label=\{`\$\{t\("network\.toggleAria"\)\} \(\$\{stateLabel\}\)`\}/,
  "network toggle aria-label must include live state",
);

assert.match(main, /aria-pressed=\{sourceMode\}/);
assert.match(
  main,
  /aria-label=\{\s*sourceMode\s*\?\s*t\("main\.viewMode\.toReadingTitle"\)\s*:\s*t\("main\.viewMode\.toSourceTitle"\)\s*\}/,
);

for (const key of [
  "verdict.accept",
  "verdict.doubt",
  "verdict.reject",
  "general.theme.light",
  "general.theme.dark",
  "general.theme.system",
  "network.toggleAria",
  "main.viewMode.toReadingTitle",
  "main.viewMode.toSourceTitle",
  "sidebar.share",
  "sidebar.shareMemory",
  "sidebar.toLight",
  "sidebar.toDark",
]) {
  assert.ok(i18n.includes(`"${key}"`), `missing i18n key ${key}`);
}

console.log("[PASS] accessible labels for verdict/theme/network/source/share");
console.log("test-accessible-control-labels: ok");
