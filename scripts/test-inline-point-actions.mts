import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const component = readFileSync(
  resolve(root, "src/components/PointizedAnswer.tsx"),
  "utf8",
);
const css = readFileSync(resolve(root, "src/index.css"), "utf8");

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

assert(
  component.includes("function canInlineVerdictActions"),
  "PointizedAnswer should keep a conservative inline-action eligibility guard.",
);

assert(
  component.includes("can-inline-actions"),
  "PointizedAnswer should tag eligible point blocks for inline actions.",
);

assert(
  component.includes("!truncated && !needsHypo && canInlineVerdictActions(point.content)"),
  "Inline actions should not apply to truncated or hypothesis/editor point states.",
);

assert(
  css.includes(".point-block.can-inline-actions .point-content"),
  "Inline-action CSS should allow point content to share the final text line.",
);

assert(
  css.includes(".point-block.can-inline-actions .point-verdict-group"),
  "Inline-action CSS should place verdict controls in the same inline flow.",
);

assert(
  css.includes("display: inline-flex"),
  "Verdict controls should remain clickable controls while flowing inline.",
);

assert(
  css.includes("float: right"),
  "Inline verdict controls should stay aligned to the right edge.",
);

assert(
  css.includes("clear: both"),
  "Inline verdict controls should be cleared when they wrap to their own line.",
);

console.log("inline point actions layout guard passed");
