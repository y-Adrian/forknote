/**
 * Probe: archive/compress source sizing — shrink tool dumps, tiered caps,
 * previous-log cap, hard max, archive-aware compress source.
 * Usage: npx tsx scripts/test-archive-source-sizing.mts
 */
import assert from "node:assert/strict";
import {
  ARCHIVE_SOURCE_HARD_MAX,
  PREV_ARCHIVE_CONTENT_MAX,
  buildArchiveSource,
  buildCompressDeltaAfterArchive,
  buildIncrementalArchiveSource,
  capArchiveSource,
  shrinkTextForArchive,
} from "../src/lib/archive.ts";
import {
  formatArchiveDraftAsCompressSource,
} from "../src/lib/contextMemory.ts";
import { buildCompressSource } from "../src/lib/contextCompressSource.ts";
import type {
  ArchiveSnapshot,
  ChatMessage,
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
  return { id: "t1", createdAt: 1, messages };
}

const toolDump = `【工具结果：read_file path="big.ts"】\n${"x".repeat(8000)}\n\nDone.`;
const shrunk = shrinkTextForArchive(toolDump);
assert.ok(shrunk.includes("工具输出已省略"), "tool dump collapsed");
assert.ok(shrunk.length < 500, `shrunk length ${shrunk.length}`);

const fence = "```ts\n" + "const a = 1;\n".repeat(200) + "```";
const fenceShrunk = shrinkTextForArchive(fence);
assert.ok(fenceShrunk.includes("…"), "code fence truncated");
assert.ok(fenceShrunk.length < fence.length, "fence shorter");

const bloatedAssistant =
  `【1】plan\n\n【工具结果：run_terminal command="ls"】\n` +
  "line\n".repeat(2000) +
  "\n```\n" +
  "code\n".repeat(400) +
  "```";

const longThread = thread([
  msg({ id: "u1", role: "user", content: "old topic " + "A".repeat(3000) }),
  msg({ id: "a1", role: "assistant", content: bloatedAssistant }),
  msg({ id: "u2", role: "user", content: "mid " + "B".repeat(3000) }),
  msg({ id: "a2", role: "assistant", content: "【1】mid ok" }),
  msg({ id: "u3", role: "user", content: "recent ask" }),
  msg({
    id: "a3",
    role: "assistant",
    content: "【1】recent answer with detail",
  }),
]);

const full = buildArchiveSource(longThread);
assert.ok(!full.includes("line\n".repeat(50)), "raw tool lines not kept");
assert.ok(full.includes("工具输出已省略") || full.length < 20_000, "sized down");
assert.ok(full.includes("recent ask"), "keeps recent user turn");
assert.ok(full.length <= ARCHIVE_SOURCE_HARD_MAX, "hard max respected");

// Older turns should be capped harder than a naive 4k*6 dump
const naiveCeiling = 4000 * 6;
assert.ok(
  full.length < naiveCeiling,
  `full ${full.length} should beat naive ${naiveCeiling}`,
);

const hugePrev =
  "UNIQUE_HEAD_MARKER_SHOULD_DROP\n" + "ENTRY\n".repeat(5000) + "\nUNIQUE_TAIL_KEEP";
assert.ok(hugePrev.length > PREV_ARCHIVE_CONTENT_MAX);
const archive: ArchiveSnapshot = {
  id: "arch1",
  createdAt: 1000,
  title: "Log v1",
  content: hugePrev,
  throughMessageId: "a2",
};
const incr = buildIncrementalArchiveSource(archive, longThread, {});
assert.ok(incr.includes("较早日志条目已截断"), "previous log capped");
assert.ok(incr.includes("recent ask"), "incremental keeps new turns");
assert.ok(
  incr.length < hugePrev.length,
  `incremental ${incr.length} < raw previous ${hugePrev.length}`,
);
assert.ok(
  !incr.includes("UNIQUE_HEAD_MARKER_SHOULD_DROP"),
  "drops earliest previous log bytes",
);
assert.ok(incr.includes("UNIQUE_TAIL_KEEP"), "keeps recent previous log tail");

const capped = capArchiveSource("H".repeat(ARCHIVE_SOURCE_HARD_MAX + 5000));
assert.ok(capped.includes("中间材料已截断"), "hard cap marker");
assert.ok(capped.length <= ARCHIVE_SOURCE_HARD_MAX + 40, "near hard max");

const compressFromArchive = buildCompressSource(longThread, { archive });
assert.ok(
  /归档草稿/.test(compressFromArchive),
  "compress reuses archive draft framing",
);
assert.ok(
  compressFromArchive.includes("recent ask"),
  "compress includes post-archive delta",
);
assert.ok(
  !compressFromArchive.includes("old topic"),
  "compress does not re-dump pre-archive raw turns",
);

const deltaOnly = buildCompressDeltaAfterArchive(archive, longThread, {});
assert.ok(deltaOnly.includes("归档之后的新对话"), "delta section");
assert.ok(!deltaOnly.includes("上一版开发日志"), "delta has no previous log");

const draftOnly = formatArchiveDraftAsCompressSource("## 2026-08-14 · [test] t\n");
assert.ok(draftOnly.includes("归档草稿"));

console.log("test-archive-source-sizing: ok");
