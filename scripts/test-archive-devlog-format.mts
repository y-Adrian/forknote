/**
 * Probe: archive 开发日志 prompt/template encodes required structure + principles.
 * Usage: npx tsx scripts/test-archive-devlog-format.mts
 */
import assert from "node:assert/strict";
import {
  ARCHIVE_SECTION_MARKERS,
  ARCHIVE_SYSTEM,
  INCREMENTAL_ARCHIVE_SYSTEM,
  archiveSystemPrompt,
  archiveUserPrompt,
  incrementalArchiveSystemPrompt,
  incrementalArchiveUserPrompt,
} from "../src/lib/archive.ts";

for (const marker of ARCHIVE_SECTION_MARKERS) {
  assert.ok(
    ARCHIVE_SYSTEM.includes(marker),
    `ARCHIVE_SYSTEM must include ${marker}`,
  );
  assert.ok(
    INCREMENTAL_ARCHIVE_SYSTEM.includes(marker),
    `INCREMENTAL_ARCHIVE_SYSTEM must include ${marker}`,
  );
}

assert.ok(
  ARCHIVE_SYSTEM.includes("## YYYY-MM-DD · [tag/area]"),
  "dated entry heading template",
);
assert.ok(
  ARCHIVE_SYSTEM.includes("三个月后的自己") ||
    ARCHIVE_SYSTEM.includes("5 分钟"),
  "written for future self / recover context",
);
assert.ok(
  ARCHIVE_SYSTEM.includes("为什么排除") || ARCHIVE_SYSTEM.includes("为何排除"),
  "why-ruled-out principle",
);
assert.ok(
  /verbatim|原文/.test(ARCHIVE_SYSTEM),
  "verbatim error logs",
);
assert.ok(
  ARCHIVE_SYSTEM.includes("不要把无关问题") ||
    ARCHIVE_SYSTEM.includes("勿合并无关问题"),
  "one entry per session / no merge unrelated",
);
assert.ok(ARCHIVE_SYSTEM.includes("纯排障"), "debug scene variant");
assert.ok(ARCHIVE_SYSTEM.includes("设计决策"), "design scene variant");
assert.ok(ARCHIVE_SYSTEM.includes("进度跟踪"), "progress scene variant");
assert.ok(
  ARCHIVE_SYSTEM.includes("周报") || ARCHIVE_SYSTEM.includes("死胡同"),
  "anti polished weekly-report / keep dead ends",
);

assert.ok(
  INCREMENTAL_ARCHIVE_SYSTEM.includes("追加"),
  "incremental: append new session entry",
);
assert.ok(
  INCREMENTAL_ARCHIVE_SYSTEM.includes("同题") ||
    INCREMENTAL_ARCHIVE_SYSTEM.includes("同一问题"),
  "incremental: update same-problem entry",
);

const zhUser = archiveUserPrompt("SRC", "zh");
assert.ok(zhUser.includes("### 背景/目标"), zhUser);
assert.ok(zhUser.includes("### 尝试过程"), zhUser);
assert.ok(zhUser.includes("### 结论/结果"), zhUser);
assert.ok(zhUser.includes("### 参考"), zhUser);
assert.ok(zhUser.includes("SRC"));

const enUser = archiveUserPrompt("SRC", "en");
assert.ok(enUser.includes("### 背景/目标"), enUser);
assert.ok(enUser.includes("SRC"));

const incrZh = incrementalArchiveUserPrompt("SRC", "zh");
assert.ok(incrZh.includes("尝试过程"), incrZh);
assert.ok(incrZh.includes("追加") || incrZh.includes("同题"), incrZh);

const sysZh = archiveSystemPrompt("zh");
const sysEn = archiveSystemPrompt("en");
assert.ok(sysZh.includes("### 背景/目标"));
assert.ok(sysEn.includes("### 背景/目标"));
assert.ok(incrementalArchiveSystemPrompt("zh").includes("增量归档"));

console.log("test-archive-devlog-format: ok");
