/**
 * Strip truncated tool markup + peel Chinese meta-CoT (#104 follow-ups).
 */
import assert from "node:assert/strict";
import { stripToolCalls } from "../src/lib/agentTools.ts";
import {
  mergeReasoningChannels,
  peelUntaggedChineseMetaReasoning,
} from "../src/lib/reasoning.ts";

// Truncated tool_call left in the bubble
const truncated = [
  "我会先读取文件。",
  "",
  '<tool_call> {"name": "read_file", "arguments": {"path": "math.js"}',
].join("\n");
assert.equal(stripToolCalls(truncated).trim(), "我会先读取文件。");

const toolCallsPlural = [
  "开始执行。",
  "<tool_calls>",
  '<invoke name="run_terminal">',
  "<parameter name=\"command\">pwd</parameter>",
  "</invoke>",
  "</tool_calls>",
  "完成。",
].join("\n");
const strippedPlural = stripToolCalls(toolCallsPlural);
assert.ok(!/tool_calls|invoke|parameter/i.test(strippedPlural));
assert.match(strippedPlural, /开始执行/);
assert.match(strippedPlural, /完成/);

const bareJson =
  '说明一下。\n{"name":"search_replace","arguments":{"path":"math.js","old_string":"a","new_string":"b"}}\n好了。';
assert.equal(stripToolCalls(bareJson).replace(/\s+/g, " ").trim(), "说明一下。 好了。");

// Chinese meta-CoT before a real answer
const zhMeta = [
  "我们需要遵循规则。用户最新一条消息要求运行 pwd。",
  "需要调用 run_terminal。计划阶段禁止声称已读写文件。",
  "让我们仔细阅读系统提示后再决定。",
  "",
  "已按要求执行 run_terminal，完整输出如下：",
  "",
  "/tmp/forknote-cap-sandbox",
].join("\n");

const zhPeeled = peelUntaggedChineseMetaReasoning(zhMeta, {
  expectChineseAnswer: true,
});
assert.equal(zhPeeled.peeled, true);
assert.match(zhPeeled.reasoning, /我们需要遵循规则/);
assert.match(zhPeeled.content, /已按要求执行/);
assert.ok(!/我们需要遵循规则/.test(zhPeeled.content));

const zhMerged = mergeReasoningChannels("", zhMeta, {
  expectChineseAnswer: true,
});
assert.match(zhMerged.reasoning, /计划阶段/);
assert.match(zhMerged.content, /完整输出如下/);

// Pure Chinese answer without meta openers — no peel
const cleanZh = "项目根目录下有 math.js 与 README.md。";
assert.equal(
  peelUntaggedChineseMetaReasoning(cleanZh, { expectChineseAnswer: true })
    .peeled,
  false,
);

// en UI — no Chinese peel
assert.equal(
  peelUntaggedChineseMetaReasoning(zhMeta, { expectChineseAnswer: false })
    .peeled,
  false,
);

console.log("smoke-tool-markup-zh-meta: ok");
