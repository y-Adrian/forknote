import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  clarificationMemoryEntryFromBranch,
  formatClarificationMemoryAddendum,
  upsertClarificationMemory,
} from "../src/lib/clarificationMemory.ts";
import type { BranchNode } from "../src/types.ts";

const branch: BranchNode = {
  id: "branch-1",
  parentId: "message-1",
  anchor: { startOffset: 0, endOffset: 4, quotedText: "共享记忆" },
  userQuestion: "这是什么意思？",
  assistantMessage: "它表示同一会话内的主线和澄清共享补充信息。",
  children: [],
  createdAt: 1,
  replies: [
    {
      userQuestion: "主线也能看到吗？",
      assistantMessage: "能，下一轮主线会收到这条简短的澄清摘要。",
      createdAt: 2,
    },
  ],
};

const entry = clarificationMemoryEntryFromBranch(branch, 10);
assert.ok(entry);
assert.match(entry.summary, /主线也能看到吗/);
const memory = upsertClarificationMemory([], entry);
const addendum = formatClarificationMemoryAddendum(memory, "zh");
assert.match(addendum ?? "", /本会话共享澄清/);
assert.match(addendum ?? "", /下一轮主线/);

const store = readFileSync("src/store/useAppStore.ts", "utf8");
assert.match(store, /syncSessionClarificationMemory/);
assert.match(store, /outcome === "completed"/);
const context = readFileSync("src/lib/contextMemory.ts", "utf8");
assert.match(context, /session\?\.clarificationMemory/);
assert.match(context, /kind: "working", text: clarifications/);

console.log("[PASS] clarification knowledge is shared across session turns");
console.log("test-clarification-shared-memory: ok");
