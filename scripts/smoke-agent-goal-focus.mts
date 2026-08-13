/**
 * Guardrails: agent stays on the user's goal, avoids digression, keeps replies lean.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHAT_SYSTEM,
  GOAL_FOCUS_RULE,
  MARKDOWN_INLINE_IMAGE_RULE,
  POINT_ANSWER_FORMAT,
  PROJECT_CHAT_SYSTEM,
} from "../src/lib/contextBuilder.ts";
import { buildCodingToolsSystem } from "../src/lib/agentTools.ts";
import { formatLocalMemoryAddendum } from "../src/lib/contextMemory.ts";
import type { ContextMemoryPack } from "../src/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const agentTurnSrc = readFileSync(join(root, "src/lib/agentTurn.ts"), "utf8");

assert.ok(
  GOAL_FOCUS_RULE.includes("核心目标") && GOAL_FOCUS_RULE.includes("凝练"),
  "GOAL_FOCUS_RULE states goal + concision",
);
assert.ok(CHAT_SYSTEM.includes(GOAL_FOCUS_RULE), "CHAT_SYSTEM includes goal focus");
assert.ok(
  PROJECT_CHAT_SYSTEM.includes(GOAL_FOCUS_RULE),
  "PROJECT_CHAT_SYSTEM includes goal focus",
);
assert.ok(
  CHAT_SYSTEM.includes(MARKDOWN_INLINE_IMAGE_RULE) &&
    PROJECT_CHAT_SYSTEM.includes(MARKDOWN_INLINE_IMAGE_RULE),
  "chat systems teach Markdown inline images",
);
assert.ok(
  MARKDOWN_INLINE_IMAGE_RULE.includes("无法显示图片") &&
    MARKDOWN_INLINE_IMAGE_RULE.includes("ForkNote"),
  "must correct the false cannot-show-images claim",
);

assert.ok(
  !POINT_ANSWER_FORMAT.includes("一般 3～8"),
  "point format must not push 3–8 points by default",
);
assert.ok(
  POINT_ANSWER_FORMAT.includes("偏事实") &&
    POINT_ANSWER_FORMAT.includes("不要**使用「【N】」"),
  "factual asks must skip 【N】 adopt structure",
);
assert.ok(
  POINT_ANSWER_FORMAT.includes("偏求助") && /2～5/.test(POINT_ANSWER_FORMAT),
  "guidance asks may use a few 【N】 points",
);

assert.ok(
  !/继续后续步骤（如 read_file package\.json、修改 README）/.test(agentTurnSrc),
  "list_dir prefetch must not nudge package.json / README digression",
);
assert.ok(
  /不要自行扩展到 package\.json、README/.test(agentTurnSrc),
  "list_dir prefetch forbids unsolicited follow-on files",
);
assert.ok(
  /凝练/.test(agentTurnSrc),
  "agentTurn nudges concise replies",
);

const coding = buildCodingToolsSystem("/tmp/proj");
assert.ok(/凝练收束|对准用户目标/.test(coding), "coding tools system stays concise");
assert.ok(/不要发散/.test(coding), "coding tools system forbids digression");

const pack: ContextMemoryPack = {
  summary: "旧任务：继续 CMake 构建验证".repeat(20),
  tasks: "- [ ] 验证 CMake\n- [ ] 跑全量测试\n- [ ] 改无关模块",
  decisions: "曾决定用 CMake",
  coding: "Prefer TypeScript",
  updatedAt: Date.now(),
  storage: "project",
  dir: ".forknote/memory",
};
const mem = formatLocalMemoryAddendum(pack, "如果我想成为科技博主我可以做什么");
assert.ok(mem, "memory addendum formats");
assert.ok(
  mem!.includes("对准用户最新目标"),
  "memory tells model not to expand old tasks",
);
assert.ok(
  mem!.length <= 1600,
  `memory injection stays lean (got ${mem!.length})`,
);

console.log("smoke-agent-goal-focus: ok");
