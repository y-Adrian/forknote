/**
 * Soft heuristics: sample-code asks do not force write_file / shell / explore,
 * but also do not imply a hard zero-tools gate. Explicit create/save uses tools.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hasExplicitRepoActionSignal,
  inferCreateFilePath,
  inferExploreIntent,
  inferOfficeCreateIntent,
  isAnswerOnlySampleCodeRequest,
  isChatOnlyDiagramAsk,
  looksLikeAnswerOnlyRequest,
  looksLikeChatDiagramRequest,
  looksLikeMutationRequest,
  looksLikeProjectGroundedAsk,
  resolveShellIntent,
} from "../src/lib/agentTools.ts";

const agentTurnSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/lib/agentTurn.ts"),
  "utf8",
);
assert.ok(
  !/if\s*\(\s*isAnswerOnlySampleCodeRequest\s*\(\s*trimmed\s*\)\s*\)/.test(
    agentTurnSrc,
  ),
  "no hard isAnswerOnlySampleCodeRequest early-return in runAgentTurn",
);
assert.ok(
  /isChatOnlyDiagramAsk\s*\(\s*trimmed\s*\)/.test(agentTurnSrc),
  "runAgentTurn gates chat-only diagram asks",
);
assert.ok(
  /omitProjectPack:\s*chatOnlyDiagramAsk/.test(agentTurnSrc),
  "chat-only diagram omits project memory pack",
);
assert.ok(
  /codingToolsSystem\s*=\s*\n?\s*projectRoot\s*&&\s*!chatOnlyDiagramAsk/.test(
    agentTurnSrc,
  ) ||
    /projectRoot\s*&&\s*!chatOnlyDiagramAsk\s*\n?\s*\?\s*buildCodingToolsSystem/.test(
      agentTurnSrc,
    ),
  "chat-only diagram must not inject coding-tools system",
);
assert.ok(
  /if\s*\(\s*chatOnlyDiagramAsk\s*\)\s*\{[\s\S]*?streamPlainChatAnswer/.test(
    agentTurnSrc,
  ),
  "chat-only diagram must early-return via streamPlainChatAnswer",
);
assert.ok(
  !/useNativeTools\s*=\s*Boolean\(\s*projectRoot\s*\)\s*&&\s*!chatOnlyDiagramAsk/.test(
    agentTurnSrc,
  ),
  "chat-only diagram should not rely on soft useNativeTools alone",
);

function expectSampleCodeSoft(q: string) {
  assert.ok(
    isAnswerOnlySampleCodeRequest(q),
    `isAnswerOnlySampleCodeRequest soft signal: ${q}`,
  );
  assert.equal(inferCreateFilePath(q), null, `createPath null: ${q}`);
  assert.equal(inferOfficeCreateIntent(q), null, `office null: ${q}`);
  assert.equal(inferExploreIntent(q), null, `explore null: ${q}`);
  assert.equal(
    resolveShellIntent(q, { projectRoot: "/tmp/p" }),
    null,
    `shell null: ${q}`,
  );
  assert.equal(looksLikeMutationRequest(q), false, `mutation false: ${q}`);
  assert.ok(looksLikeAnswerOnlyRequest(q), `looksLikeAnswerOnly: ${q}`);
}

function expectCreate(q: string, path: string) {
  assert.equal(
    isAnswerOnlySampleCodeRequest(q),
    false,
    `not sample-code soft signal: ${q}`,
  );
  assert.equal(inferCreateFilePath(q), path, `createPath ${path}: ${q}`);
  assert.ok(
    looksLikeMutationRequest(q) || hasExplicitRepoActionSignal(q),
    `mutation/action: ${q}`,
  );
  assert.equal(looksLikeAnswerOnlyRequest(q), false, `not answer-only: ${q}`);
}

for (const q of [
  "随便给我写一段代码",
  "随便写一段代码",
  "给我一段代码",
  "给我一段 Python 代码",
  "写一段代码",
  "帮我写段 Python 打印 hello",
  "示例代码",
  "write some code",
  "write me some python code",
  "sample code",
  "show me some code",
  "code snippet",
]) {
  expectSampleCodeSoft(q);
}

expectCreate("写一个 hello.py", "hello.py");
expectCreate("在项目里创建 hello.py 写入 hello", "hello.py");
expectCreate("创建 src/foo.ts", "src/foo.ts");
expectCreate("把这段写进 src/foo.ts", "src/foo.ts");
expectCreate("把这段保存到 hello.py", "hello.py");
expectCreate("create a file bar.js", "bar.js");

assert.ok(hasExplicitRepoActionSignal("删除旧文件"));
assert.ok(looksLikeMutationRequest("改一下 README.md"));

// search_replace / search_files must not be treated as explore "search …"
const replaceAsk =
  "请用 search_replace 修改 math.js：把 return a + b; 改成 return a + b + 1; 只改这一处。";
assert.equal(
  inferExploreIntent(replaceAsk),
  null,
  "search_replace must not become explore search",
);
assert.ok(
  looksLikeMutationRequest(replaceAsk),
  "search_replace ask is a mutation",
);
assert.equal(
  inferExploreIntent("用 search_files"),
  null,
  "bare search_files tool name is not an explore search query",
);
assert.equal(
  inferExploreIntent("call search_replace on math.js"),
  null,
  "search_replace tool name is not an explore search query",
);
assert.deepEqual(inferExploreIntent("请搜索 foo"), {
  kind: "search",
  query: "foo",
});
assert.deepEqual(inferExploreIntent("search for math.js"), {
  kind: "search",
  query: "math.js",
});

// English read/open/cat must not match inside filenames (README.md → ME.md).
assert.equal(inferExploreIntent("总结 README.md"), null);
assert.equal(inferExploreIntent("what does README.md say"), null);
assert.equal(inferExploreIntent("总结 OPENING.md"), null);
assert.equal(inferExploreIntent("catalog.json 是什么"), null);
assert.deepEqual(inferExploreIntent("read README.md"), {
  kind: "read",
  path: "README.md",
});
assert.deepEqual(inferExploreIntent("open README.md"), {
  kind: "read",
  path: "README.md",
});
assert.deepEqual(inferExploreIntent("读取 README.md"), {
  kind: "read",
  path: "README.md",
});

for (const q of [
  "帮我随便画一个mermaid的图",
  "随便画个流程图",
  "画一个时序图",
  "draw a mermaid flowchart",
  "generate a plantuml sequence diagram",
]) {
  assert.ok(looksLikeChatDiagramRequest(q), `chat diagram: ${q}`);
  assert.ok(isChatOnlyDiagramAsk(q), `chat-only diagram: ${q}`);
  assert.ok(looksLikeAnswerOnlyRequest(q), `answer-only diagram: ${q}`);
  assert.equal(looksLikeMutationRequest(q), false, `not mutation: ${q}`);
}

assert.equal(
  looksLikeChatDiagramRequest("根据本项目画一个架构图"),
  false,
  "project-grounded diagram keeps tools path",
);
assert.ok(looksLikeProjectGroundedAsk("根据本项目画一个架构图"));
assert.ok(looksLikeProjectGroundedAsk("本项目架构图"));
assert.ok(looksLikeProjectGroundedAsk("在项目里画架构图"));
assert.equal(
  isChatOnlyDiagramAsk("根据本项目画一个架构图"),
  false,
  "not hard chat-only when project-grounded",
);

// Bare「项目」must not defeat the chat-only diagram gate (#226).
for (const q of [
  "画一个项目的流程图",
  "画一个项目架构图",
  "画个项目管理流程图",
]) {
  assert.equal(looksLikeProjectGroundedAsk(q), false, `not grounded: ${q}`);
  assert.ok(isChatOnlyDiagramAsk(q), `chat-only despite 项目: ${q}`);
}

console.log("smoke-answer-only-intent: ok");
