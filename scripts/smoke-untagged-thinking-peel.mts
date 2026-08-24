/**
 * Untagged bilingual thinking peel (#thinking-leak).
 */
import assert from "node:assert/strict";
import {
  mergeReasoningChannels,
  peelWholeChineseMetaReasoning,
  peelUntaggedBilingualReasoning,
} from "../src/lib/reasoning.ts";

const leaked = [
  "The user asked me to run pwd && ls -la and paste the full output.",
  "I need to use the run_terminal tool to execute this.",
  "Let me call the tool now.",
  "",
  "任务已完成。以下是 pwd && ls -la 的完整输出：",
  "",
  "- 工作目录：/tmp/forknote-cap-sandbox",
].join("\n");

const peeled = peelUntaggedBilingualReasoning(leaked, {
  expectChineseAnswer: true,
});
assert.equal(peeled.peeled, true);
assert.match(peeled.reasoning, /The user asked/);
assert.match(peeled.content, /任务已完成/);
assert.ok(!/The user asked/.test(peeled.content));

const merged = mergeReasoningChannels("", leaked, {
  expectChineseAnswer: true,
});
assert.match(merged.reasoning, /Let me call/);
assert.match(merged.content, /任务已完成/);
assert.ok(!/^The user asked/m.test(merged.content));

// English-only answer must stay intact
const enOnly =
  "Here is a short explanation of how the tool loop works.\n\nFirst, I outline the plan. Then I execute tools.";
assert.deepEqual(
  peelUntaggedBilingualReasoning(enOnly, { expectChineseAnswer: true }),
  { content: enOnly, reasoning: "", peeled: false },
);
assert.equal(
  mergeReasoningChannels("", enOnly, { expectChineseAnswer: false }).content,
  enOnly,
);

// Chinese answer with English API names only — no peel
const apiNames =
  "请调用 `search_replace` 与 `read_file` 完成修改。\n\n完成后告诉我结果。";
assert.equal(
  peelUntaggedBilingualReasoning(apiNames, { expectChineseAnswer: true })
    .peeled,
  false,
);

// Tagged think path unchanged
const tagged =
  "<think>The user asked for ls.</think>\n\n已列出当前目录。";
const taggedMerged = mergeReasoningChannels("", tagged, {
  expectChineseAnswer: true,
});
assert.match(taggedMerged.reasoning, /The user asked for ls/);
assert.match(taggedMerged.content, /已列出当前目录/);
assert.ok(!/<think>/.test(taggedMerged.content));

const zhMetaOnly = [
  "我们需要理解用户的问题：用户最新消息是“根据当前项目的现状，你有什么建议”。",
  "这是在要求给建议，属于B类（偏求助/指导/决策），应该用【N】分点给出可独立取舍的建议。",
  "注意结构：偏求助/指导/决策，所以用【1】、【2】等分点，行首【N】。",
  "不要提及工具不可用等内容，不要提及 web_search 等工具。",
  "用户想要的是项目层面的建议，不是工具层面的。",
].join("\n\n");

const zhMetaOnlyPeeled = peelWholeChineseMetaReasoning(zhMetaOnly, {
  expectChineseAnswer: true,
});
assert.equal(zhMetaOnlyPeeled.peeled, true);
assert.equal(zhMetaOnlyPeeled.content, "");
assert.match(zhMetaOnlyPeeled.reasoning, /我们需要理解用户的问题/);

const zhMetaOnlyMerged = mergeReasoningChannels("", zhMetaOnly, {
  expectChineseAnswer: true,
  hidePeeledReasoning: true,
});
assert.equal(zhMetaOnlyMerged.content, "");
assert.equal(zhMetaOnlyMerged.reasoning, "");

// expectChineseAnswer false → no peel even if mixed
assert.equal(
  peelUntaggedBilingualReasoning(leaked, { expectChineseAnswer: false })
    .peeled,
  false,
);

console.log("smoke-untagged-thinking-peel: ok");
