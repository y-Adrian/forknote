/**
 * Factual asks → plain answers; guidance asks → 【N】 adopt structure.
 */
import assert from "node:assert/strict";
import {
  answerStructureHintForLatestUser,
  answerStructureModeForQuery,
  buildConversationMessages,
  looksLikeFactualRequest,
  looksLikeGuidanceRequest,
  POINT_ANSWER_FORMAT,
} from "../src/lib/contextBuilder.ts";
import type { ThreadRoot } from "../src/types.ts";

assert.equal(looksLikeFactualRequest("什么是 useEffect？"), true);
assert.equal(looksLikeFactualRequest("What is a closure?"), true);
assert.equal(looksLikeGuidanceRequest("什么是 useEffect？"), false);
assert.equal(answerStructureModeForQuery("什么是 useEffect？"), "factual");

assert.equal(looksLikeGuidanceRequest("帮我优化这段登录流程，怎么改比较好？"), true);
assert.equal(looksLikeGuidanceRequest("How should I structure this API?"), true);
assert.equal(looksLikeFactualRequest("帮我优化这段登录流程"), false);
assert.equal(
  answerStructureModeForQuery("帮我设计一下权限模型，该怎么做？"),
  "guidance",
);

const factualHint = answerStructureHintForLatestUser("什么是 Redis？", "zh");
assert.match(factualHint ?? "", /禁止使用【N】/);

const guidanceHint = answerStructureHintForLatestUser("怎么部署到生产环境？", "zh");
assert.match(guidanceHint ?? "", /【N】分点/);

assert.ok(POINT_ANSWER_FORMAT.includes("偏事实"));
assert.ok(POINT_ANSWER_FORMAT.includes("偏求助"));

const thread: ThreadRoot = {
  id: "t1",
  messages: [
    {
      id: "u1",
      role: "user",
      content: "什么是闭包？",
      createdAt: 1,
    },
  ],
  createdAt: 1,
  updatedAt: 1,
};
const msgs = buildConversationMessages(thread, { locale: "zh" });
const system = msgs.find((m) => m.role === "system")?.content ?? "";
assert.match(system, /本轮结构/);
assert.match(system, /禁止使用【N】/);

console.log("test-answer-structure-mode: ok");
