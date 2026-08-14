/**
 * Probe #367: rendered Mermaid/PlantUML diagrams expose accessible names
 * and source relationships.
 *
 * Usage: npx tsx scripts/test-diagram-a11y.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { t } from "../src/lib/i18n.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fenceSrc = readFileSync(join(root, "src/components/DiagramFence.tsx"), "utf8");

assert.match(fenceSrc, /function DiagramAccessibleFrame/);
assert.match(fenceSrc, /aria-labelledby=\{labelId\}/);
assert.match(fenceSrc, /aria-describedby=\{descId\}/);
assert.match(fenceSrc, /chat\.diagram\.mermaidLabel/);
assert.match(fenceSrc, /chat\.diagram\.plantumlLabel/);
assert.match(fenceSrc, /chat\.diagram\.sourceDescription/);
assert.match(fenceSrc, /className="sr-only"/);
assert.match(
  fenceSrc,
  /kind="mermaid"[\s\S]*dangerouslySetInnerHTML/,
  "Mermaid visual stays inside accessible frame",
);
assert.match(
  fenceSrc,
  /kind="plantuml"[\s\S]*<img src=\{visual\.src\} alt=""/,
  "PlantUML img is decorative under the figure caption",
);

assert.equal(t("chat.diagram.mermaidLabel", undefined, "en"), "Mermaid diagram");
assert.equal(t("chat.diagram.plantumlLabel", undefined, "zh"), "PlantUML 图示");
assert.match(
  t("chat.diagram.sourceDescription", { source: "A-->B" }, "en"),
  /A-->B/,
);

console.log("[PASS] diagram accessible descriptions");
console.log("test-diagram-a11y: ok");
