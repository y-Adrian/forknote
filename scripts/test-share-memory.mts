/**
 * Probe: per-session shareMemory helpers.
 * Usage: npx tsx scripts/test-share-memory.mts
 */
import assert from "node:assert/strict";
import {
  isSessionShareMemoryEnabled,
  resolveMemoryDir,
  shouldUseSharedProjectMemory,
} from "../src/lib/contextMemory.ts";
import type { ApiSettings, ChatSession } from "../src/types.ts";

const base = {
  id: "s1-abc",
  title: "t",
  thread: null,
  createdAt: 1,
  updatedAt: 1,
} as ChatSession;

const settings = { memoryDir: ".forknote/memory" } as ApiSettings;

assert.equal(isSessionShareMemoryEnabled(undefined), true);
assert.equal(isSessionShareMemoryEnabled(base), true);
assert.equal(isSessionShareMemoryEnabled({ ...base, shareMemory: true }), true);
assert.equal(isSessionShareMemoryEnabled({ ...base, shareMemory: false }), false);

assert.equal(resolveMemoryDir(settings), ".forknote/memory");
assert.equal(resolveMemoryDir(settings, base), ".forknote/memory");
assert.equal(
  resolveMemoryDir(settings, { ...base, shareMemory: false }),
  ".forknote/memory/sessions/s1-abc",
);

assert.equal(shouldUseSharedProjectMemory(base, "/proj"), true);
assert.equal(shouldUseSharedProjectMemory(base, null), false);
assert.equal(
  shouldUseSharedProjectMemory({ ...base, shareMemory: false }, "/proj"),
  false,
);

console.log("test-share-memory: ok");
