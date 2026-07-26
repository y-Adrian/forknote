/**
 * Simulate unbound runAgentTurn for「随便给我写一段代码」with a mocked fetch
 * SSE reply. Asserts: completed (not need_project), no tools in request body,
 * assistant content includes a code fence, no plan-approval callback.
 */
import assert from "node:assert/strict";
import { runAgentTurn } from "../src/lib/agentTurn.ts";

const sample =
  '下面给你一段示例。\n\n【1】Python：\n\n```python\ndef hello():\n    print("Hello, ForkNote")\n```\n';

const encoder = new TextEncoder();
function sseChunk(delta: string): Uint8Array {
  const payload = JSON.stringify({
    choices: [{ delta: { content: delta }, finish_reason: null }],
  });
  return encoder.encode(`data: ${payload}\n\n`);
}

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as {
    tools?: unknown;
    tool_choice?: unknown;
    messages?: unknown[];
  };
  assert.equal(body.tools, undefined, "request must omit tools when unbound");
  assert.equal(
    body.tool_choice,
    undefined,
    "request must omit tool_choice when unbound",
  );
  const sys = body.messages?.find(
    (m) => (m as { role?: string }).role === "system",
  ) as { content?: string } | undefined;
  assert.ok(
    String(sys?.content ?? "").includes("无本地项目工具"),
    "system prompt must be CHAT_SYSTEM",
  );

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const mid = Math.floor(sample.length / 2);
      controller.enqueue(sseChunk(sample.slice(0, mid)));
      controller.enqueue(sseChunk(sample.slice(mid)));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}) as typeof fetch;

let patchedContent = "";
let planCalls = 0;
let activityCalls = 0;

try {
  const outcome = await runAgentTurn({
    llm: {
      baseUrl: "http://mock.local/v1",
      apiKey: "test",
      model: "test-model",
      useProxy: false,
    },
    settings: {
      baseUrl: "http://mock.local/v1",
      apiKey: "test",
      model: "test-model",
      useProxy: false,
      memoryLayerProject: false,
      memoryLayerPreferences: false,
      memoryLayerSession: false,
    },
    locale: "zh",
    session: undefined,
    userText: "随便给我写一段代码",
    thread: {
      id: "t",
      createdAt: 1,
      messages: [
        {
          id: "u",
          role: "user",
          content: "随便给我写一段代码",
          children: [],
          createdAt: 1,
        },
        {
          id: "a",
          role: "assistant",
          content: "",
          children: [],
          createdAt: 2,
        },
      ],
    },
    projectRoot: null,
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
      throw new Error("unbound must not emit agent file changes");
    },
    onAwaitPlanApproval: () => {
      planCalls += 1;
    },
  });

  assert.equal(outcome, "completed");
  assert.notEqual(outcome, "need_project");
  assert.equal(planCalls, 0, "no plan approval");
  assert.equal(activityCalls, 0, "no tool activity");
  assert.match(patchedContent, /```python/);
  assert.match(patchedContent, /Hello, ForkNote/);
  console.log("sim-unbound-write-code: ok");

  // Named create-file phrasing must also stay plain chat when unbound
  // (previously returned need_project and rolled back the turn).
  patchedContent = "";
  const namedOutcome = await runAgentTurn({
    llm: {
      baseUrl: "http://mock.local/v1",
      apiKey: "test",
      model: "test-model",
      useProxy: false,
    },
    settings: {
      baseUrl: "http://mock.local/v1",
      apiKey: "test",
      model: "test-model",
      useProxy: false,
      memoryLayerProject: false,
      memoryLayerPreferences: false,
      memoryLayerSession: false,
    },
    locale: "zh",
    session: undefined,
    userText: "写一个 hello.py",
    thread: {
      id: "t2",
      createdAt: 1,
      messages: [
        {
          id: "u2",
          role: "user",
          content: "写一个 hello.py",
          children: [],
          createdAt: 1,
        },
        {
          id: "a2",
          role: "assistant",
          content: "",
          children: [],
          createdAt: 2,
        },
      ],
    },
    projectRoot: null,
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
      throw new Error("unbound must not emit agent file changes");
    },
    onAwaitPlanApproval: () => {
      planCalls += 1;
    },
  });
  assert.equal(namedOutcome, "completed");
  assert.notEqual(namedOutcome, "need_project");
  assert.equal(planCalls, 0);
  console.log("sim-unbound-create-named-file: ok");
} finally {
  globalThis.fetch = originalFetch;
}
