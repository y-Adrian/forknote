import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CLARIFICATION_MEMORY_MAX_ENTRIES,
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

const updated = clarificationMemoryEntryFromBranch(
  {
    ...branch,
    adoptedAt: 20,
    replies: [
      ...(branch.replies ?? []),
      {
        userQuestion: "最终结论？",
        assistantMessage: "以最新澄清为准，并标记为已并入主线。",
        createdAt: 3,
      },
    ],
  },
  20,
);
assert.ok(updated);
const replaced = upsertClarificationMemory(memory, updated);
assert.equal(replaced.length, 1, "same branch replaces its previous summary");
assert.equal(replaced[0].adopted, true);
assert.match(replaced[0].summary, /最终结论/);

let capped = replaced;
for (let index = 0; index < CLARIFICATION_MEMORY_MAX_ENTRIES + 2; index += 1) {
  capped = upsertClarificationMemory(capped, {
    branchId: `branch-${index + 2}`,
    anchor: `anchor-${index + 2}`,
    summary: `summary-${index + 2}`,
    adopted: false,
    updatedAt: 30 + index,
  });
}
assert.equal(capped.length, CLARIFICATION_MEMORY_MAX_ENTRIES);
assert.equal(capped.at(-1)?.branchId, "branch-11");
assert.equal(capped.some((item) => item.branchId === branch.id), false);

const store = readFileSync("src/store/useAppStore.ts", "utf8");
assert.match(store, /syncSessionClarificationMemory/);
assert.match(store, /outcome === "completed"/);
const context = readFileSync("src/lib/contextMemory.ts", "utf8");
assert.match(context, /session\?\.clarificationMemory/);
assert.match(context, /kind: "working", text: clarifications/);

console.log("[PASS] clarification knowledge is shared across session turns");
console.log("test-clarification-shared-memory: ok");
