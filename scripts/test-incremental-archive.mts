/**
 * Probe: incremental archive helpers (skip / delta / first archive).
 * Usage: npx tsx scripts/test-incremental-archive.mts
 */
import assert from "node:assert/strict";
import {
  archiveHasNewMaterial,
  buildIncrementalArchiveSource,
  messagesAfterArchive,
  resolveBaseArchive,
} from "../src/lib/archive.ts";
import type {
  ArchiveSnapshot,
  ChatMessage,
  FeedbackEvent,
  ThreadRoot,
} from "../src/types.ts";

function msg(
  partial: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role" | "content">,
): ChatMessage {
  return {
    children: [],
    createdAt: 1,
    ...partial,
  };
}

function thread(messages: ChatMessage[]): ThreadRoot {
  return {
    id: "t1",
    createdAt: 1,
    messages,
  };
}

const m1 = msg({ id: "u1", role: "user", content: "hello" });
const m2 = msg({ id: "a1", role: "assistant", content: "【1】world" });
const m3 = msg({ id: "u2", role: "user", content: "more" });
const m4 = msg({ id: "a2", role: "assistant", content: "【1】ok" });

const archive: ArchiveSnapshot = {
  id: "arch1",
  createdAt: 1000,
  title: "Log v1",
  content: "# Log v1\n\nDone hello/world",
  throughMessageId: "a1",
};

assert.equal(resolveBaseArchive([], null), null);
assert.equal(resolveBaseArchive([archive], "arch1")?.id, "arch1");
assert.equal(
  resolveBaseArchive(
    [archive, { ...archive, id: "arch2", throughMessageId: "a2" }],
    null,
  )?.id,
  "arch2",
);

const tCovered = thread([m1, m2]);
assert.equal(messagesAfterArchive(tCovered, archive).length, 0);
assert.equal(
  archiveHasNewMaterial(tCovered, archive, []),
  false,
  "no new material when cutoff is last message",
);

const tLater = thread([m1, m2, m3, m4]);
assert.equal(messagesAfterArchive(tLater, archive).length, 2);
assert.equal(archiveHasNewMaterial(tLater, archive, []), true);

const feedback: FeedbackEvent[] = [
  {
    id: "f1",
    targetId: "a1",
    pointIndex: 1,
    signal: "accept",
    explicit: true,
    weight: 1,
    at: 2000,
  },
];
assert.equal(
  archiveHasNewMaterial(tCovered, archive, feedback),
  true,
  "feedback after archive counts as new material",
);

const withClarify = thread([
  m1,
  {
    ...m2,
    children: [
      {
        id: "c1",
        parentId: "a1",
        anchor: {
          startOffset: 0,
          endOffset: 5,
          quotedText: "world",
          pointIndex: 1,
        },
        userQuestion: "why?",
        assistantMessage: "because",
        children: [],
        createdAt: 2500,
      },
    ],
  },
]);
assert.equal(
  archiveHasNewMaterial(withClarify, archive, []),
  true,
  "new clarification under covered message counts",
);

const incr = buildIncrementalArchiveSource(archive, tLater, {});
assert.ok(incr.includes("上一版开发日志"), "incremental has previous log");
assert.ok(incr.includes("Log v1"), "incremental embeds previous title");
assert.ok(incr.includes("归档之后的新对话"), "incremental has new turns");
assert.ok(incr.includes("more"), "incremental includes new user text");
assert.ok(!incr.includes("hello") || incr.indexOf("底座") < incr.indexOf("more"), "structure ok");

const incrFb = buildIncrementalArchiveSource(archive, tCovered, {
  feedbackLog: feedback,
});
assert.ok(
  incrFb.includes("自上一版以来的反馈") || incrFb.includes("反馈事件"),
  "incremental includes fresh feedback",
);

console.log("test-incremental-archive: ok");
