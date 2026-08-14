/**
 * Probe #366: PlantUML SVG is sanitized and must not rely on raw innerHTML.
 *
 * Usage: npx tsx scripts/test-plantuml-svg-sanitize.mts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  plantumlSvgToObjectUrl,
  sanitizePlantumlSvg,
} from "../src/lib/sanitizePlantumlSvg.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fenceSrc = fs.readFileSync(
  path.join(ROOT, "src/components/DiagramFence.tsx"),
  "utf8",
);

const plantumlBlock = fenceSrc.slice(
  fenceSrc.indexOf("const PlantumlDiagram"),
  fenceSrc.indexOf("export const DiagramFence"),
);

assert.match(
  plantumlBlock,
  /plantumlSvgToObjectUrl/,
  "PlantUML path must convert SVG to an object URL",
);
assert.doesNotMatch(
  plantumlBlock,
  /dangerouslySetInnerHTML/,
  "PlantUML must not inject SVG via dangerouslySetInnerHTML",
);
assert.match(
  plantumlBlock,
  /<img\s+src=\{visual\.src\}/,
  "PlantUML must render through an inert img boundary",
);

const dirty = `
<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">
  <!-- payload -->
  <script>alert(1)</script>
  <rect width="10" height="10" onclick="alert(2)" />
  <a href="javascript:alert(3)" xlink:href="javascript:alert(4)">x</a>
  <foreignObject width="10" height="10"><body xmlns="http://www.w3.org/1999/xhtml"><script>alert(5)</script></body></foreignObject>
</svg>
`;

const clean = sanitizePlantumlSvg(dirty);
assert.match(clean, /<svg[\s>]/i);
assert.doesNotMatch(clean, /<script/i);
assert.doesNotMatch(clean, /foreignObject/i);
assert.doesNotMatch(clean, /\sonclick=/i);
assert.doesNotMatch(clean, /javascript:/i);

assert.throws(
  () => sanitizePlantumlSvg("<div>not svg</div>"),
  /did not return SVG/,
);

const url = plantumlSvgToObjectUrl(
  `<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>`,
);
assert.match(url, /^blob:/);
URL.revokeObjectURL(url);

console.log("[PASS] plantuml svg sanitize + inert img boundary");
console.log("test-plantuml-svg-sanitize: ok");
