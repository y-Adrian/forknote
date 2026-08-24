/**
 * Probe: auto-discovered code context is compact and clearly marked as hints.
 *
 * Usage: npx tsx scripts/test-auto-discovered-code-addendum.mts
 */
import assert from "node:assert/strict";
import { formatDiscoveredCodeAddendum } from "../src/lib/repoContext.ts";
import type { SemanticHit } from "../src/lib/sidecar.ts";

const hits: SemanticHit[] = Array.from({ length: 4 }, (_, i) => ({
  path: `src/file${i}.ts`,
  startLine: i + 1,
  endLine: i + 10,
  title: `function f${i}`,
  score: 10 - i,
  preview: `export function f${i}() { return ${i}; }`,
}));

const addendum = formatDiscoveredCodeAddendum(hits);
assert.ok(addendum?.includes("仓库相关代码"));
assert.ok(addendum?.includes("编辑前仍需读取源文件确认"));
assert.ok(addendum?.includes("src/file0.ts:1-10"));
assert.ok(addendum?.includes("src/file2.ts:3-12"));
assert.ok(!addendum?.includes("src/file3.ts"));
assert.equal(formatDiscoveredCodeAddendum([]), null);

console.log("[PASS] auto discovered code addendum");
console.log("test-auto-discovered-code-addendum: ok");
