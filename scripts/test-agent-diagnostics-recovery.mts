import assert from "node:assert/strict";
import { runAgentTurn } from "../src/lib/agentTurn.ts";
import type { ApiSettings, ThreadRoot } from "../src/types.ts";

const originalFetch = globalThis.fetch;
const settings: ApiSettings = {
  baseUrl: "https://mock.local/v1", apiKey: "test", model: "test",
  useProxy: false, agentRequireApproval: false, agentAutoDiagnostics: true,
  agentAllowNetwork: false, memoryLayerProject: false,
  memoryLayerPreferences: false, memoryLayerSession: false, agentMaxRounds: 6,
};
const userText = "创建 probe.ts 文件，导出一个 number 类型变量";
const thread: ThreadRoot = {
  id: "thread", createdAt: 1,
  messages: [{ id: "user", role: "user", content: userText, children: [], createdAt: 1 }],
};
const encoder = new TextEncoder();
function reply(content: string, tool?: Record<string, unknown>) {
  return new Response(new ReadableStream({ start(controller) {
    const delta = tool ? { tool_calls: [{ index: 0, id: crypto.randomUUID(), type: "function", function: { name: "write_file", arguments: JSON.stringify(tool) } }] } : { content };
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`));
    controller.close();
  }}), { headers: { "Content-Type": "text/event-stream" } });
}

for (const failureMode of ["type_error", "request_error"] as const) {
let writes = 0;
let diagnostics = 0;
let sawRepairRound = false;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.includes("/chat/completions")) {
    const body = JSON.parse(String(init?.body));
    if (body.messages[0]?.content?.includes("Reflect controller") ||
        body.messages[0]?.content?.includes("Reflect 控制器")) {
      return reply(JSON.stringify({ decision: diagnostics === 1 ? "retry" : "continue" }));
    }
    if (writes === 1) {
      sawRepairRound = true;
      const messages = body.messages as Array<{ content?: string }>;
      assert.ok(messages.some(m => m.content?.includes(failureMode === "type_error" ? "TS2322" : "diagnostics timeout")));
      assert.ok(!messages.some(m => m.content?.includes("请用一两句中文确认路径与作用，不要再调用工具")),
        "failed validation must not be followed by a stop-tools completion prompt");
    }
    return writes < 2
      ? reply("", { path: "probe.ts", content: writes ? "export const n: number = 1;" : "export const n: number = 'bad';" })
      : reply("已创建并通过检查。");
  }
  if (url.endsWith("/fs/write")) {
    writes++;
    return Response.json({ size: 30, diff: "" });
  }
  if (url.endsWith("/fs/diagnostics")) {
    diagnostics++;
    if (failureMode === "request_error" && diagnostics === 1) {
      throw new Error("diagnostics timeout");
    }
    return Response.json({ ok: diagnostics > 1, output: diagnostics === 1 ? "error TS2322: Type string is not assignable to number." : "OK" });
  }
  if (url.includes("/fs/list")) return Response.json({ path: ".", entries: [] });
  throw new Error(`Unexpected test request: ${url}`);
};
const activities: string[] = [];
try {
  const outcome = await runAgentTurn({
    llm: settings, settings, locale: "zh", userText, thread,
    session: undefined, projectRoot: "/mock/project", sidecarUrl: "https://sidecar.test",
    signal: new AbortController().signal, isOwned: () => true,
    patchContent: () => {}, onAgentChange: () => {},
    onAgentActivity: a => activities.push(a.message),
    onAwaitPlanApproval: () => { throw new Error("Unexpected approval"); },
  });
  assert.equal(outcome, "completed");
  assert.equal(writes, 2);
  assert.equal(diagnostics, 2);
  assert.ok(sawRepairRound);
  assert.ok(activities.some(a => a.startsWith("reflect:retry")),
    "failed diagnostics must enter Reflect recovery");
  console.log(`test-agent-diagnostics-recovery: ok (${failureMode}: write -> failed check -> repair -> passed check)`);
} finally {
  globalThis.fetch = originalFetch;
}
}
