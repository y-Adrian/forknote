/**
 * Probe: CODING.md append governance dedupes repeated lessons and caps growth.
 *
 * Usage: npx tsx scripts/test-coding-memory-governance.mts
 */
import assert from "node:assert/strict";
import {
  mergeCodingMemoryNote,
  normalizeCodingMemoryNote,
} from "../src/lib/contextMemory.ts";

assert.equal(
  normalizeCodingMemoryNote("- [2026-08-24 10:00:00] Prefer search_replace for small edits."),
  "prefer search_replace for small edits.",
);

const first = mergeCodingMemoryNote(
  "",
  "Prefer search_replace for small edits.",
  Date.parse("2026-08-24T00:00:00.000Z"),
);
assert.match(first, /\[2026-08-24 00:00:00\]/);
assert.match(first, /Prefer search_replace/);

const duplicate = mergeCodingMemoryNote(
  first,
  "  Prefer   search_replace for small edits. ",
  Date.parse("2026-08-25T00:00:00.000Z"),
);
assert.equal(duplicate, first, "duplicate normalized note is not appended");

let many = "";
for (let i = 0; i < 85; i++) {
  many = mergeCodingMemoryNote(many, `lesson ${i}`, Date.parse("2026-08-24T00:00:00.000Z") + i);
}
const entries = many.split(/\n{2,}/).filter(Boolean);
assert.equal(entries.length, 80, "coding memory keeps the newest capped entries");
assert.ok(!many.includes("lesson 0"));
assert.ok(many.includes("lesson 84"));

console.log("[PASS] coding memory governance");
console.log("test-coding-memory-governance: ok");
