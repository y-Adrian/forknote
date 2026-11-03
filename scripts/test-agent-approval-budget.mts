import assert from "node:assert/strict";
import { runAgentTurn, type RunAgentTurnOptions } from "../src/lib/agentTurn.ts";
const original = globalThis.fetch;
const settings = { baseUrl: "https://mock.test/v1", apiKey: "", model: "mock", useProxy: false,
  agentRequireApproval: true, agentAutoDiagnostics: false, agentMaxRounds: 1,
  agentAllowNetwork: false, memoryLayerProject: false, memoryLayerSession: false, memoryLayerPreferences: false };
let calls = 0;
let writes = 0;
let approval: Parameters<RunAgentTurnOptions["onAwaitPlanApproval"]>[0] | undefined;
globalThis.fetch = async (url) => {
  if (String(url).endsWith("/fs/write")) { writes++; return Response.json({ size: 1, diff: "" }); }
  if (String(url).includes("/fs/list")) return Response.json({ entries: [] });
  if (String(url).includes("/fs/checkpoint/capture")) return Response.json({ id: "c", paths: [] });
  assert.ok(String(url).endsWith("/chat/completions"));
  calls++;
  const delta = calls === 1
    ? { content: "## Plan\n1. write_file(path=\"a.ts\", content=\"a\")\n2. write_file(path=\"b.ts\", content=\"b\")\n3. write_file(path=\"c.ts\", content=\"c\")\n4. write_file(path=\"d.ts\", content=\"d\")" }
    : { tool_calls: [{ index: 0, id: "call", function: { name: "write_file", arguments: JSON.stringify({ path: "a.ts", content: "a" }) } }] };
  return new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
};
try {
  const text = "修改项目中的 a.ts、b.ts、c.ts、d.ts";
  assert.equal(await runAgentTurn({ llm: settings, settings, userText: text, locale: "en", session: undefined,
    thread: { id: "t", createdAt: 1, messages: [{ id: "u", role: "user", content: text, children: [], createdAt: 1 }] },
    projectRoot: "/mock/project", sidecarUrl: "https://sidecar.test", signal: new AbortController().signal,
    isOwned: () => true, patchContent: () => {}, onAgentChange: () => {}, onAgentActivity: () => {},
    onAwaitPlanApproval: plan => { approval = plan; },
  }), "waiting_plan");
  assert.ok(approval);
  await approval.continueExecution();
  assert.equal(writes, 3, "one tool round may finish the three approved steps");
  const before = calls;
  await approval.continueExecution();
  assert.equal(calls, before, "repeat approval must not refill the same turn budget");
  assert.equal(writes, 3);
  console.log("test-agent-approval-budget: ok");
} finally { globalThis.fetch = original; }
