/**
 * Probe #352: branch rail SVG must stay viewport-sized and only paint
 * nearby messages — never an element as tall as the full chat scrollHeight.
 *
 * Usage: npx tsx scripts/test-branch-rail-virtual.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { BranchNode } from "../src/types.ts";
import {
  filterMsgsForRailViewport,
  messageRailSpan,
  railVisibleWindow,
} from "../src/lib/branchRailVirtual.ts";

function leaf(id: string): BranchNode {
  return {
    id,
    parentMessageId: "m",
    userQuestion: `q-${id}`,
    assistantAnswer: "",
    anchor: { start: 0, end: 0, quotedText: "" },
    children: [],
    createdAt: 0,
  } as BranchNode;
}

// Prove the old failure: a 50k-tall thread would force a 50k SVG if we keyed
// height to scrollHeight. Virtualization keeps height === viewport.
const viewportH = 800;
const scrollHeight = 50_000;
const scrollTop = 12_000;

const msgs = Array.from({ length: 80 }, (_, i) => ({
  msgId: `a${i}`,
  y: i * 600,
  branches: i % 7 === 0 ? [leaf(`b${i}`)] : [],
}));

const visible = filterMsgsForRailViewport(msgs, scrollTop, viewportH);
assert.ok(
  visible.length < msgs.length,
  "long threads must cull messages outside the viewport window",
);
assert.ok(visible.length >= 1, "viewport must still include nearby messages");

const win = railVisibleWindow(scrollTop, viewportH);
for (const m of visible) {
  const span = messageRailSpan(m.y, m.branches);
  assert.ok(
    span.maxY >= win.minY && span.minY <= win.maxY,
    `visible msg ${m.msgId} must intersect the window`,
  );
}
for (const m of msgs) {
  if (visible.includes(m)) continue;
  const span = messageRailSpan(m.y, m.branches);
  assert.ok(
    span.maxY < win.minY || span.minY > win.maxY,
    `culled msg ${m.msgId} must lie outside the window`,
  );
}

assert.ok(
  viewportH < scrollHeight,
  "sanity: viewport is far smaller than full scroll height",
);
assert.ok(
  visible.length <= 8,
  `expected a small visible set near y≈${scrollTop}, got ${visible.length}`,
);

const rail = readFileSync("src/components/BranchRail.tsx", "utf8");
assert.ok(
  rail.includes("filterMsgsForRailViewport"),
  "BranchRail must filter to the viewport",
);
assert.ok(
  !/height=\{totalH\}/.test(rail),
  "BranchRail must not size the SVG to full scrollHeight",
);
assert.ok(
  !/translateY\(\$\{-scrollTop\}px\)/.test(rail),
  "BranchRail must not translate a full-document SVG",
);
assert.ok(
  /height=\{svgH\}/.test(rail) || /height=\{viewportH/.test(rail),
  "BranchRail SVG height must follow the viewport",
);
assert.ok(
  rail.includes("data-fn-rail-virtual"),
  "virtualized rail marks itself for probes",
);

console.log(
  `[PASS] rail virtualizes ${visible.length}/${msgs.length} msgs @ scrollTop=${scrollTop} (scrollHeight=${scrollHeight})`,
);
console.log("test-branch-rail-virtual: ok");
