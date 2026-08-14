/**
 * Probe #388: attached files use a distinct memory budget; assemble order
 * follows the documented hierarchy (preferences → longTerm → session → working → files).
 *
 * Usage: npx tsx scripts/test-attached-files-memory-budget.mts
 */
import assert from "node:assert/strict";
import {
  assembleMemoryLayers,
  MEMORY_CHAR_BUDGETS,
  MEMORY_LAYER_ORDER,
  memoryLayerRank,
} from "../src/lib/memoryBudget.ts";

// --- Prove prior failure modes ---
assert.ok(
  "files" in MEMORY_CHAR_BUDGETS,
  "files must have its own budget key (not borrow longTerm)",
);
assert.notEqual(
  MEMORY_CHAR_BUDGETS.files,
  undefined,
  "files budget must be defined",
);
assert.deepEqual(
  [...MEMORY_LAYER_ORDER],
  ["preferences", "longTerm", "session", "working", "files"],
);

assert.ok(memoryLayerRank("preferences") < memoryLayerRank("longTerm"));
assert.ok(memoryLayerRank("longTerm") < memoryLayerRank("session"));
assert.ok(memoryLayerRank("session") < memoryLayerRank("working"));
assert.ok(memoryLayerRank("working") < memoryLayerRank("files"));

// Distinct caps: fill longTerm and files independently without sharing one bucket.
const longBody = "L".repeat(MEMORY_CHAR_BUDGETS.longTerm);
const fileBody = "F".repeat(MEMORY_CHAR_BUDGETS.files);
const dual = assembleMemoryLayers([
  { kind: "longTerm", text: longBody },
  { kind: "files", text: fileBody },
]);
assert.ok(dual);
assert.match(dual!, /L{100}/);
assert.match(dual!, /F{100}/);
assert.ok(
  dual!.includes("…(memory budget)") ||
    dual!.length <= MEMORY_CHAR_BUDGETS.longTerm + MEMORY_CHAR_BUDGETS.files + 10,
);

// Per-layer files cap is independent of longTerm (previously files used longTerm).
const oversizedFiles = assembleMemoryLayers([
  { kind: "files", text: "Z".repeat(MEMORY_CHAR_BUDGETS.files + 4_000) },
]);
assert.ok(oversizedFiles);
assert.ok(oversizedFiles!.length <= MEMORY_CHAR_BUDGETS.files + 40);
assert.match(oversizedFiles!, /\(memory budget\)/);

// Caller push order must not invert hierarchy: working pushed before prefs still
// yields prefs → working in the joined output; total trim prefers later kinds.
const shuffled = assembleMemoryLayers([
  { kind: "working", text: "WORKING_MARKER_" + "w".repeat(200) },
  { kind: "files", text: "FILES_MARKER_" + "f".repeat(200) },
  { kind: "preferences", text: "PREFS_MARKER_" + "p".repeat(200) },
  { kind: "longTerm", text: "LONG_MARKER_" + "l".repeat(200) },
  { kind: "session", text: "SESSION_MARKER_" + "s".repeat(200) },
]);
assert.ok(shuffled);
const prefsAt = shuffled!.indexOf("PREFS_MARKER_");
const longAt = shuffled!.indexOf("LONG_MARKER_");
const sessionAt = shuffled!.indexOf("SESSION_MARKER_");
const workingAt = shuffled!.indexOf("WORKING_MARKER_");
const filesAt = shuffled!.indexOf("FILES_MARKER_");
assert.ok(prefsAt >= 0 && longAt > prefsAt);
assert.ok(sessionAt > longAt);
assert.ok(workingAt > sessionAt);
assert.ok(filesAt > workingAt);

// Over total: earlier layers degrade first — files (and working) survive.
const totalPressure = assembleMemoryLayers([
  {
    kind: "preferences",
    text: "PREFS_DROP_" + "P".repeat(MEMORY_CHAR_BUDGETS.preferences),
  },
  {
    kind: "longTerm",
    text: "LONG_DROP_" + "L".repeat(MEMORY_CHAR_BUDGETS.longTerm),
  },
  {
    kind: "session",
    text: "SESSION_DROP_" + "S".repeat(MEMORY_CHAR_BUDGETS.session),
  },
  {
    kind: "working",
    text: "WORKING_KEEP_" + "W".repeat(MEMORY_CHAR_BUDGETS.working),
  },
  {
    kind: "files",
    text: "FILES_KEEP_" + "F".repeat(MEMORY_CHAR_BUDGETS.files),
  },
]);
assert.ok(totalPressure);
assert.ok(totalPressure!.length <= MEMORY_CHAR_BUDGETS.total);
assert.match(totalPressure!, /FILES_KEEP_/);
assert.match(totalPressure!, /WORKING_KEEP_/);

console.log("[PASS] distinct attached-files memory budget + hierarchy order");
console.log("test-attached-files-memory-budget: ok");
