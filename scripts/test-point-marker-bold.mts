/**
 * Point marker strip must not break Markdown bold titles.
 * Usage: npx tsx scripts/test-point-marker-bold.mts
 */
import assert from "node:assert/strict";
import {
  matchPointStartLine,
  parseAnswerPoints,
} from "../src/lib/points.ts";

assert.deepEqual(matchPointStartLine("【1】**检索业界有名的共识算法**"), {
  index: 1,
  rest: "**检索业界有名的共识算法**",
});
assert.deepEqual(matchPointStartLine("**【1】**检索业界有名的共识算法"), {
  index: 1,
  rest: "检索业界有名的共识算法",
});
assert.deepEqual(matchPointStartLine("**【1】分析这个项目是做什么的**"), {
  index: 1,
  rest: "**分析这个项目是做什么的**",
});
assert.deepEqual(matchPointStartLine("- 【2】下一步"), {
  index: 2,
  rest: "下一步",
});
assert.deepEqual(matchPointStartLine("【3】普通标题"), {
  index: 3,
  rest: "普通标题",
});

const parsed = parseAnswerPoints(`会话内已处理的需求

【1】**检索业界有名的共识算法**

Paxos/Raft

【2】**分析这个项目是做什么的**

Milk-V

【3】**构建部分如何完善**

CMake
`);
assert.equal(parsed.preamble, "会话内已处理的需求");
assert.equal(parsed.points.length, 3);
assert.equal(parsed.points[0]?.content, "**检索业界有名的共识算法**\n\nPaxos/Raft");
assert.ok(
  parsed.points.every((p) => {
    const first = p.content.split("\n")[0] ?? "";
    // No dangling closing bold without opener on the title line
    return !(/^[^*\n].*\*\*$/.test(first));
  }),
);

console.log("test-point-marker-bold: ok");
