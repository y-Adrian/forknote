/**
 * After Allow, if the model emits no tool_calls, synthesize from approved plan
 * and execute (integration with mocked LLM + real sidecar).
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { runAgentTurn } from "../src/lib/agentTurn.ts";

Object.defineProperty(globalThis, "crypto", {
  value: webcrypto,
  configurable: true,
});

const projectRoot = "/tmp/forknote-cap-sandbox";
const sidecarUrl = "http://127.0.0.1:8787";
const target = `${projectRoot}/plan-fallback-probe.js`;

writeFileSync(target, "export const n = 1;\n", "utf8");

const planText = [
  "## 计划",
  '1. search_replace(path="plan-fallback-probe.js", old_string="export const n = 1;", new_string="export const n = 2;")',
  "",
  "## 预期操作",
  '- search_replace(path="plan-fallback-probe.js", old_string="export const n = 1;", new_string="export const n = 2;")',
].join("\n");

const monologue =
  "好的，我会按批准的计划修改文件。接下来使用 search_replace 工具……（但我不发出 tool_calls）";

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
      controller.enqueue(sseChunk(text));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

type Phase = "plan" | "exec";
let phase: Phase = "plan";
let llmCalls = 0;

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("/chat/completions")) {
    llmCalls += 1;
    if (phase === "plan") {
      phase = "exec";
      return mockSseReply(planText);
    }
    // Execution rounds: always monologue, never native tool_calls.
    return mockSseReply(monologue);
  }
  return originalFetch(input, init);
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
  agentAllowTerminal: true,
};

const thread = {
  id: "t",
  createdAt: 1,
  messages: [
    {
      id: "u",
      role: "user" as const,
      content:
        '把 plan-fallback-probe.js 里的 n 从 1 改成 2（用 search_replace）',
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

  let continueExecution: (() => Promise<void>) | null = null;
  const activities: { kind: string; message: string }[] = [];

  try {
    const outcome = await runAgentTurn({
      llm: baseSettings,
      settings: baseSettings,
      locale: "zh",
      session: undefined,
      userText: thread.messages[0]!.content,
      thread,
      projectRoot,
      sidecarUrl,
      signal: new AbortController().signal,
      isOwned: () => true,
      patchContent: () => {},
      onAgentActivity: (a) => {
        activities.push({ kind: a.kind, message: a.message });
      },
      onAgentChange: () => {},
      onAwaitPlanApproval: (plan) => {
        continueExecution = plan.continueExecution;
      },
    });

    assert.equal(outcome, "waiting_plan");
    assert.ok(continueExecution, "must await plan approval");

    await continueExecution!();

    const after = readFileSync(target, "utf8");
    assert.equal(
      after,
      "export const n = 2;\n",
      "search_replace must run from approved plan despite monologue-only model",
    );
    assert.ok(
      activities.some(
        (a) => a.kind === "write" && /plan-fallback-probe\.js/.test(a.message),
      ),
      `expected write activity for probe file, got ${JSON.stringify(activities)}`,
    );
    console.log("sim-plan-fallback-after-approve: ok", {
      llmCalls,
      activities,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
