/**
 * Bound project +「随便给我写一段代码」→ soft judgment path:
 * tools schema still offered (tool_choice auto), no hard zero-tools early-return,
 * typically completes as chat without write_file / plan.
 * Explicit create phrasing still enters the write plan path.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import { runAgentTurn } from "../src/lib/agentTurn.ts";

Object.defineProperty(globalThis, "crypto", {
  value: webcrypto,
  configurable: true,
});

const agentTurnSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/lib/agentTurn.ts"),
  "utf8",
);
assert.ok(
  !/Hard guarantee:\s*sample-code/.test(agentTurnSrc),
  "hard sample-code early-return comment must be gone",
);
assert.ok(
  !/if\s*\(\s*isAnswerOnlySampleCodeRequest\s*\(\s*trimmed\s*\)\s*\)/.test(
    agentTurnSrc,
  ),
  "isAnswerOnlySampleCodeRequest must not hard early-return in runAgentTurn",
);
assert.ok(
  /softInformationalAsk/.test(agentTurnSrc),
  "soft informational path should exist",
);
console.log("sim-bound-answer-only hard-path-absent: ok");

const sample =
  '下面给你一段示例。\n\n【1】Python：\n\n```python\ndef hello():\n    print("Hello, ForkNote")\n```\n';

const createPlan =
  "## 计划\n1. 用 write_file 创建 hello.py，写入 hello\n\n## 预期操作\n- write_file";

const encoder = new TextEncoder();
function sseChunk(delta: string): Uint8Array {
  const payload = JSON.stringify({
    choices: [{ delta: { content: delta }, finish_reason: null }],
  });
  return encoder.encode(`data: ${payload}\n\n`);
}

function mockSseReply(text: string) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const mid = Math.floor(text.length / 2);
      controller.enqueue(sseChunk(text.slice(0, mid)));
      controller.enqueue(sseChunk(text.slice(mid)));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

type Body = {
  tools?: unknown;
  tool_choice?: unknown;
  messages?: { role?: string; content?: string }[];
};

const originalFetch = globalThis.fetch;
let lastBody: Body | null = null;
let replyMode: "sample" | "create-plan" = "sample";

globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  lastBody = JSON.parse(String(init?.body ?? "{}")) as Body;
  return mockSseReply(replyMode === "create-plan" ? createPlan : sample);
}) as typeof fetch;

const baseSettings = {
  baseUrl: "http://mock.local/v1",
  apiKey: "test",
  model: "test-model",
  useProxy: false,
  memoryLayerProject: false,
  memoryLayerPreferences: false,
  memoryLayerSession: false,
  agentRequireApproval: true,
};

function threadFor(text: string) {
  return {
    id: "t",
    createdAt: 1,
    messages: [
      {
        id: "u",
        role: "user" as const,
        content: text,
        children: [] as string[],
        createdAt: 1,
      },
      {
        id: "a",
        role: "assistant" as const,
        content: "",
        children: [] as string[],
        createdAt: 2,
      },
    ],
  };
}

let patchedContent = "";
let planCalls = 0;
let activityCalls = 0;
let changeCalls = 0;

try {
  const q = "随便给我写一段代码";
  const outcome = await runAgentTurn({
    llm: baseSettings,
    settings: baseSettings,
    locale: "zh",
    session: undefined,
    userText: q,
    thread: threadFor(q),
    projectRoot: "/tmp/demo-project",
    sidecarUrl: "http://127.0.0.1:8787",
    signal: new AbortController().signal,
    isOwned: () => true,
    patchContent: (patch) => {
      if (patch.content !== undefined) patchedContent = patch.content;
    },
    onAgentActivity: () => {
      activityCalls += 1;
    },
    onAgentChange: () => {
      changeCalls += 1;
    },
    onAwaitPlanApproval: () => {
      planCalls += 1;
    },
  });

  assert.equal(outcome, "completed");
  assert.equal(planCalls, 0, "no plan approval for soft sample-code ask");
  assert.equal(activityCalls, 0, "no tool activity when model answers in chat");
  assert.equal(changeCalls, 0, "no write_file / file changes");
  assert.ok(
    Array.isArray(lastBody?.tools) && (lastBody!.tools as unknown[]).length > 0,
    "soft path must still offer tools schema (not hard zero-tools early-return)",
  );
  assert.ok(
    lastBody?.tool_choice === "auto" ||
      lastBody?.tool_choice === undefined ||
      (typeof lastBody?.tool_choice === "object" && lastBody?.tool_choice !== null),
    "tool_choice should stay auto / model-decided (not forced write)",
  );
  const sysJoined = (lastBody?.messages ?? [])
    .filter((m) => m.role === "system")
    .map((m) => m.content ?? "")
    .join("\n");
  assert.match(
    sysJoined,
    /根据实际情景|Judge by situation|优先用 Markdown|prefer answering/i,
  );
  assert.ok(
    !/禁止调用任何工具|Do not call any tools/i.test(sysJoined),
    "must not hard-forbid all tools",
  );
  assert.match(patchedContent, /```python/);
  console.log("sim-bound-answer-only soft-sample: ok");

  replyMode = "create-plan";
  lastBody = null;
  planCalls = 0;
  activityCalls = 0;
  changeCalls = 0;
  patchedContent = "";

  const createQ = "在项目里创建 hello.py 写入 hello";
  const createOutcome = await runAgentTurn({
    llm: baseSettings,
    settings: baseSettings,
    locale: "zh",
    session: undefined,
    userText: createQ,
    thread: threadFor(createQ),
    projectRoot: "/tmp/demo-project",
    sidecarUrl: "http://127.0.0.1:8787",
    signal: new AbortController().signal,
    isOwned: () => true,
    patchContent: (patch) => {
      if (patch.content !== undefined) patchedContent = patch.content;
    },
    onAgentActivity: () => {
      activityCalls += 1;
    },
    onAgentChange: () => {
      changeCalls += 1;
    },
    onAwaitPlanApproval: () => {
      planCalls += 1;
    },
  });

  assert.equal(createOutcome, "waiting_plan");
  assert.equal(planCalls, 1, "create intent should request plan approval");
  assert.equal(activityCalls, 0, "no tools before approval");
  assert.equal(changeCalls, 0, "no write_file before approval");
  const createSys = (lastBody?.messages ?? [])
    .filter((m) => m.role === "system")
    .map((m) => m.content ?? "")
    .join("\n");
  assert.ok(
    !/根据实际情景判断|Judge by situation and necessity/i.test(createSys),
    "create must not use soft-informational system hint",
  );
  assert.match(createSys, /hello\.py|write_file|创建文件/);
  console.log("sim-bound-answer-only create-intent: ok");
} finally {
  globalThis.fetch = originalFetch;
}
