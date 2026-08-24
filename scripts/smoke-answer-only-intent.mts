/**
 * Intent heuristics: casual Q&A / sample-code / diagrams prefer plain chat.
 * Explicit create/save/project work keeps the tool path.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hasAgentWorkSignal,
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
  shouldPreferPlainChatTurn,
} from "../src/lib/agentTools.ts";
import { shouldInjectProjectPackForPlainChat } from "../src/lib/agentTurn.ts";

const agentTurnSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/lib/agentTurn.ts"),
  "utf8",
);
const agentToolsSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/lib/agentTools.ts"),
  "utf8",
);
assert.ok(
  !/if\s*\(\s*isAnswerOnlySampleCodeRequest\s*\(\s*trimmed\s*\)\s*\)/.test(
    agentTurnSrc,
  ),
  "no hard isAnswerOnlySampleCodeRequest early-return in runAgentTurn",
);
assert.ok(
  /shouldPreferPlainChatTurn/.test(agentTurnSrc),
  "runAgentTurn uses shouldPreferPlainChatTurn",
);
assert.ok(
  /omitProjectPack:\s*preferPlainChat\s*&&\s*!injectProjectPackForPlainChat/.test(
    agentTurnSrc,
  ),
  "plain-chat turns omit project memory unless memory/project context is requested",
);
assert.ok(
  /preferPlainChat/.test(agentTurnSrc) &&
    /streamPlainChatAnswer/.test(agentTurnSrc),
  "plain-chat turns early-return via streamPlainChatAnswer",
);
assert.ok(
  /codingToolsSystem\s*=\s*\n?\s*projectRoot\s*&&\s*!preferPlainChat/.test(
    agentTurnSrc,
  ) ||
    /projectRoot\s*&&\s*!preferPlainChat\s*\n?\s*\?\s*buildCodingToolsSystem/.test(
      agentTurnSrc,
    ),
  "plain-chat turns must not inject coding-tools system",
);
assert.ok(
  !/useNativeTools\s*=\s*Boolean\(\s*projectRoot\s*\)\s*&&\s*!chatOnlyDiagramAsk/.test(
    agentTurnSrc,
  ),
  "chat-only diagram should not rely on soft useNativeTools alone",
);
assert.ok(
  /Default to a ```mermaid fence/.test(agentTurnSrc) &&
    /默认且优先使用 ```mermaid 围栏/.test(agentTurnSrc),
  "diagram plain-chat system must default to mermaid (live preview)",
);
assert.ok(
  !/prefer ```mermaid or ```plantuml/.test(agentTurnSrc) &&
    !/优先 ```mermaid 或 ```plantuml/.test(agentTurnSrc),
  "must not treat plantuml as equal default for live diagrams",
);
assert.ok(
  /use ```plantuml only if the user explicitly asked/.test(agentTurnSrc) &&
    /仅当用户明确要求 PlantUML/.test(agentTurnSrc),
  "plantuml only when user explicitly requests it",
);
assert.ok(
  /mermaid fence \(plantuml only if/.test(agentToolsSrc) &&
    /mermaid 围栏输出图/.test(agentToolsSrc),
  "planning-phase diagram guidance defaults to mermaid",
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

// Casual advice must not enter the tool loop (#238).
const bloggerAsk = "如果我想成为一个科技博主，我可以做什么事情？";
assert.equal(hasAgentWorkSignal(bloggerAsk), false, "blogger ask is not agent work");
assert.ok(
  shouldPreferPlainChatTurn(bloggerAsk, {}),
  "blogger ask prefers plain chat",
);
assert.ok(looksLikeAnswerOnlyRequest(bloggerAsk), "blogger ask is answer-only");

// Relevance: inventory-shaped explore only — not bare「项目」/ advice.
for (const q of [
  "有哪些建议可以尝试",
  "帮我看看有什么想法",
  "解释一下项目结构怎么设计比较好",
]) {
  assert.equal(inferExploreIntent(q), null, `not explore list: ${q}`);
  assert.ok(
    shouldPreferPlainChatTurn(q, { exploreIntent: inferExploreIntent(q) }),
    `plain chat by relevance: ${q}`,
  );
}

// Evaluative but project-grounded — may use tools; must not force inventory explore.
for (const q of ["看看这个项目怎么样", "当前项目适合做什么"]) {
  assert.equal(inferExploreIntent(q), null, `not explore list: ${q}`);
}

assert.deepEqual(inferExploreIntent("列出当前目录"), {
  kind: "list",
  path: ".",
});
assert.deepEqual(inferExploreIntent("看看当前目录有什么"), {
  kind: "list",
  path: ".",
});
assert.deepEqual(inferExploreIntent("当前项目目录有哪些文件"), {
  kind: "list",
  path: ".",
});
assert.deepEqual(inferExploreIntent("看看项目结构"), {
  kind: "list",
  path: ".",
});

assert.equal(
  hasAgentWorkSignal("帮我看看有什么建议"),
  false,
  "帮我看 without repo object is not work",
);
assert.ok(
  hasAgentWorkSignal("帮我看看报错日志"),
  "帮我看 + error object is work",
);
assert.equal(
  hasExplicitRepoActionSignal("随便写一段代码，不要写到磁盘"),
  false,
  "negated 不要写到磁盘 is not a write intent",
);
assert.ok(
  shouldPreferPlainChatTurn("随便给我写一段 Python 打印 hello 的代码，不要写到磁盘。", {}),
  "sample code + don't write to disk stays plain chat",
);

// Project-grounded evaluative asks keep tools (need to actually look).
assert.equal(
  shouldPreferPlainChatTurn("看看这个项目怎么样？给三点简短建议就行。", {}),
  false,
  "这个项目怎么样 keeps tools when grounded",
);

assert.ok(hasAgentWorkSignal("帮我改一下 README"));
assert.ok(hasAgentWorkSignal("这个项目是做什么的"));
assert.equal(
  shouldPreferPlainChatTurn("写一个 hello.py", {
    createPath: "hello.py",
  }),
  false,
  "create-file asks keep tools",
);
assert.equal(
  shouldPreferPlainChatTurn("根据本项目画一个架构图", {}),
  false,
  "project-grounded asks keep tools",
);
assert.equal(
  shouldPreferPlainChatTurn("解释一下项目结构怎么设计比较好", {}),
  true,
  "conceptual structure advice stays plain chat",
);
assert.equal(
  shouldInjectProjectPackForPlainChat("之前做了什么？总结一下先前结论"),
  true,
  "history asks still inject project memory in plain chat",
);
assert.equal(
  shouldInjectProjectPackForPlainChat("随便写一段 Python 代码"),
  false,
  "generic plain chat does not inject project memory",
);

console.log("smoke-answer-only-intent: ok");
