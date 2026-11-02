/**
 * Probe: outside-project run_terminal must open InlineToolApproval (Allow/Stop)
 * instead of only emitting the dead-end activity string
 * 「已拦截项目外终端 — 需要先批准权限」.
 *
 * Usage: npx tsx scripts/test-outside-terminal-approval.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import {
  inferShellIntent,
  terminalCallNeedsOutsideApproval,
  commandLeavesProject,
  usesInlineToolApproval,
} from "../src/lib/agentTools.ts";
import { runAgentTurn } from "../src/lib/agentTurn.ts";
import { t } from "../src/lib/i18n.ts";

Object.defineProperty(globalThis, "crypto", {
  value: webcrypto,
  configurable: true,
});

const root = "/tmp/forknote-outside-approval-probe";

{
  assert.equal(
    terminalCallNeedsOutsideApproval(
      { tool: "run_terminal", command: "ls /tmp" },
      root,
    ),
    true,
  );
  assert.equal(
    terminalCallNeedsOutsideApproval(
      { tool: "run_terminal", command: "ls -la" },
      root,
    ),
    false,
  );
  assert.equal(
    terminalCallNeedsOutsideApproval(
      { tool: "list_dir", path: "." },
      root,
    ),
    false,
  );
  console.log("[PASS] terminalCallNeedsOutsideApproval helper");
}

{
  const cases: Array<{ text: string; command: string }> = [
    { text: "执行shell命令，查看 /tmp", command: "ls /tmp" },
    { text: "在终端里列出 /Users/debris", command: "ls /Users/debris" },
    { text: "用终端跑一下 cat /etc/hosts", command: "cat /etc/hosts" },
  ];
  for (const c of cases) {
    const intent = inferShellIntent(c.text, root);
    assert.ok(intent, `intent for ${c.text}`);
    assert.equal(intent!.command, c.command, c.text);
    assert.equal(commandLeavesProject(intent!.command, root), true, c.text);
  }
  console.log("[PASS] Chinese shell asks with absolute paths map to outside cmds");
}

{
  assert.equal(
    usesInlineToolApproval("run_terminal: ls /tmp", ["run_terminal: ls /tmp"], [
      "ls /tmp",
    ]),
    true,
  );
  const zhDenied = t("agent.activity.terminalOutsideDenied", undefined, "zh");
  assert.match(zhDenied, /已拦截项目外终端/);
  console.log("[PASS] inline approval + deny copy still defined");
}

{
  const turnSrc = readFileSync("src/lib/agentTurn.ts", "utf8");
  assert.ok(
    turnSrc.includes("terminalCallNeedsOutsideApproval"),
    "agentTurn must gate outside terminal before execute",
  );
  assert.ok(
    turnSrc.includes("waiting_plan"),
    "outside gate must return waiting_plan",
  );
  const listSrc = readFileSync("src/components/MainChatMessageList.tsx", "utf8");
  assert.ok(
    listSrc.includes("visibleMessages.some"),
    "approval fallback must key off visibleMessages (archive filter)",
  );
  console.log("[PASS] wiring present in agentTurn + MainChatMessageList");
}

const encoder = new TextEncoder();
function sseChunk(delta: Record<string, unknown>): Uint8Array {
  const payload = JSON.stringify({
    choices: [{ delta, finish_reason: null }],
  });
  return encoder.encode(`data: ${payload}\n\n`);
}

function mockSseWithToolCall(command: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        sseChunk({
          tool_calls: [
            {
              index: 0,
              id: "call_outside",
              type: "function",
              function: {
                name: "run_terminal",
                arguments: JSON.stringify({ command }),
              },
            },
          ],
        }),
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

{
  const originalFetch = globalThis.fetch;
  let llmCalls = 0;
  const resumeBodies: Array<{ messages: Array<Record<string, unknown>> }> = [];
  const controller = new AbortController();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/chat/completions")) {
      llmCalls += 1;
      if (llmCalls > 1) {
        // Resumed after Allow: capture history, then stop the turn.
        resumeBodies.push(JSON.parse(String(init?.body)));
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      }
      // Soft informational ask — no forceDirectShellApproval — model still
      // emits outside-project run_terminal.
      return mockSseWithToolCall("ls /tmp");
    }
    // Sidecar must not be hit for the denied/gated path.
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  const settings = {
    baseUrl: "http://mock.local/v1",
    apiKey: "test",
    model: "test-model",
    useProxy: false,
    memoryLayerProject: false,
    memoryLayerPreferences: false,
    memoryLayerSession: false,
    agentRequireApproval: false,
    agentAllowTerminal: true,
  };

  const thread = {
    id: "t",
    createdAt: 1,
    messages: [
      {
        id: "u",
        role: "user" as const,
        content: "列出项目根目录的文件",
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

  let awaitArgs: {
    planText: string;
    steps: string[];
    commands?: string[];
    continueExecution: () => Promise<void>;
  } | null = null;
  const activities: { kind: string; message: string }[] = [];

  try {
    const outcome = await runAgentTurn({
      llm: settings,
      settings,
      locale: "zh",
      session: undefined,
      userText: thread.messages[0]!.content,
      thread,
      projectRoot: root,
      sidecarUrl: "http://127.0.0.1:8787",
      signal: controller.signal,
      isOwned: () => true,
      patchContent: () => {},
      onAgentActivity: (a) => {
        activities.push({ kind: a.kind, message: a.message });
      },
      onAgentChange: () => {},
      onAwaitPlanApproval: (plan) => {
        awaitArgs = {
          planText: plan.planText,
          steps: plan.steps,
          commands: plan.commands,
          continueExecution: plan.continueExecution,
        };
      },
    });

    assert.equal(outcome, "waiting_plan", "must pause for outside approval");
    assert.ok(awaitArgs, "onAwaitPlanApproval must fire");
    assert.ok(
      awaitArgs!.commands?.includes("ls /tmp"),
      `expected ls /tmp in commands, got ${JSON.stringify(awaitArgs)}`,
    );
    assert.ok(
      usesInlineToolApproval(
        awaitArgs!.planText,
        awaitArgs!.steps,
        awaitArgs!.commands,
      ),
      "pending plan must route to InlineToolApproval Allow/Stop",
    );
    const denied = t("agent.activity.terminalOutsideDenied", undefined, "zh");
    assert.ok(
      !activities.some((a) => a.message === denied),
      `must not emit dead-end activity before Allow; got ${JSON.stringify(activities)}`,
    );
    assert.ok(llmCalls >= 1, "model must have been called");
    console.log("[PASS] mid-loop outside run_terminal opens plan approval");

    await awaitArgs!.continueExecution().catch(() => {});
    assert.equal(resumeBodies.length, 1, "Allow must resume the model loop");
    const msgs = resumeBodies[0]!.messages;
    const callIds = msgs.flatMap((m) =>
      Array.isArray(m.tool_calls)
        ? (m.tool_calls as Array<{ id: string }>).map((c) => c.id)
        : [],
    );
    const answered = new Set(
      msgs.filter((m) => m.role === "tool").map((m) => m.tool_call_id),
    );
    assert.ok(callIds.includes("call_outside"));
    for (const id of callIds) {
      assert.ok(answered.has(id), `tool_call ${id} has no tool reply on resume`);
    }
    console.log("[PASS] resumed history pairs every tool_call with a tool reply");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log("All outside-terminal-approval probes passed.");
