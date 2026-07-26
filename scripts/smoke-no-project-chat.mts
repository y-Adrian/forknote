/**
 * Smoke: unbound (no projectRoot) chat routing stays plain Q&A.
 */
import assert from "node:assert/strict";
import {
  buildConversationMessages,
  CHAT_SYSTEM,
  conversationBaseSystem,
  PROJECT_CHAT_SYSTEM,
} from "../src/lib/contextBuilder.ts";
import { inferExploreIntent } from "../src/lib/agentTools.ts";
import type { ThreadRoot } from "../src/types.ts";

for (const q of [
  "随便给我写一段代码",
  "写一个 hello.py",
  "帮我写段 Python 打印 hello",
  "what is 2+2?",
]) {
  assert.equal(
    inferExploreIntent(q),
    null,
    `explore should be null for casual Q&A: ${q}`,
  );
}

const unboundSystem = conversationBaseSystem({
  projectRoot: null,
  codingToolsSystem: null,
});
assert.ok(unboundSystem.includes("无本地项目工具"));
assert.ok(!unboundSystem.includes("必须使用函数工具"));
assert.ok(CHAT_SYSTEM.includes("无本地项目工具"));

const boundSystem = conversationBaseSystem({
  projectRoot: "/tmp/demo",
  codingToolsSystem: "\n[tools]",
});
assert.ok(boundSystem.includes(PROJECT_CHAT_SYSTEM.slice(0, 8)));

const thread: ThreadRoot = {
  id: "t1",
  createdAt: 1,
  messages: [
    {
      id: "u1",
      role: "user",
      content: "随便给我写一段代码",
      children: [],
      createdAt: 1,
    },
    {
      id: "a1",
      role: "assistant",
      content: "",
      children: [],
      createdAt: 2,
    },
  ],
};

const msgs = buildConversationMessages(thread, {
  projectRoot: null,
  codingToolsSystem: null,
});
assert.equal(msgs[0]?.role, "system");
assert.ok(String(msgs[0]?.content).includes("无本地项目工具"));
assert.ok(
  String(msgs[0]?.content).includes("不要调用或假装调用"),
  "must forbid pretending to use tools when unbound",
);
assert.ok(
  !String(msgs[0]?.content).includes("必须使用函数工具"),
  "must not require project tools when unbound",
);

console.log("smoke-no-project-chat: ok");
