/**
 * Probe: findBranchHostMessageId
 * Usage: npx tsx scripts/test-branch-host.mts
 */
import assert from "node:assert/strict";
import { findBranchHostMessageId } from "../src/lib/branches.ts";
import type { ThreadRoot } from "../src/types.ts";

const thread = {
  id: "t1",
  createdAt: 1,
  messages: [
    {
      id: "u1",
      role: "user",
      content: "q",
      children: [],
      createdAt: 1,
    },
    {
      id: "a1",
      role: "assistant",
      content: "ans",
      createdAt: 2,
      children: [
        {
          id: "b1",
          parentId: "a1",
          anchor: { startOffset: 0, endOffset: 1, quotedText: "x" },
          userQuestion: "clarify",
          assistantMessage: "c-ans",
          children: [
            {
              id: "b2",
              parentId: "b1",
              anchor: { startOffset: 0, endOffset: 1, quotedText: "y" },
              userQuestion: "nested",
              assistantMessage: "n-ans",
              children: [],
              createdAt: 4,
            },
          ],
          createdAt: 3,
        },
      ],
    },
  ],
} as ThreadRoot;

assert.equal(findBranchHostMessageId(thread, "b1"), "a1");
assert.equal(findBranchHostMessageId(thread, "b2"), "a1");
assert.equal(findBranchHostMessageId(thread, "missing"), null);

console.log("test-branch-host: ok");
