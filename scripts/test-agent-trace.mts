/**
 * Agent loop trace: the recorder bounds and redacts what it keeps, and a real
 * agent turn (plan → approval → tool) is recorded end to end, across the pause.
 */
import assert from "node:assert/strict";
import {
  AgentTraceRecorder,
  MAX_TRACE_EVENTS,
  formatAgentTraceSummary,
  redactSecrets,
  type AgentTrace,
} from "../src/lib/agentTrace.ts";
import { runAgentTurn, type RunAgentTurnOptions } from "../src/lib/agentTurn.ts";
import { buildTurnDiagnosticPacket } from "../src/lib/conversationDiagnostic.ts";

const env = { model: "m", baseUrlHost: "h", locale: "en", projectBound: true };
{
  assert.equal(redactSecrets("key sk-abcdefghijklmnopqrstu end"), "key sk-[redacted] end");
  assert.equal(redactSecrets("Authorization: Bearer abcdefghijklmnop123"), "Authorization: Bearer [redacted]");
  assert.equal(redactSecrets('{"apiKey":"abcd1234efgh5678"}'), '{"apiKey":"[redacted]"}');

  const r = new AgentTraceRecorder({ id: "a", sessionId: null, userText: "u", detailed: false, env });
  r.toolCall({ call: { tool: "write_file", path: "a.ts", content: "x".repeat(5000) }, durationMs: 3, ok: true, resultText: "y".repeat(5000) });
  const ev = r.snapshot().events[0]!;
  assert.ok(String((ev.data.args as Record<string, unknown>).content).length < 700, "summary mode shortens arguments");
  assert.ok(String(ev.data.result).length < 700, "summary mode shortens results");
  for (let i = 0; i < MAX_TRACE_EVENTS + 50; i++) r.event("activity", { kind: "info", message: String(i) });
  const capped = r.snapshot();
  assert.equal(capped.events.length, MAX_TRACE_EVENTS);
  assert.equal(capped.droppedEvents, 51);
  assert.equal(capped.events[0]!.kind, "tool_call", "the start of the turn is kept");
  assert.equal(capped.events.at(-1)!.data.message, String(MAX_TRACE_EVENTS + 49), "the newest events are kept");
  console.log("[PASS] recorder shortens, redacts and caps events");
}

const original = globalThis.fetch;
const base = { baseUrl: "https://mock.test/v1", apiKey: "sk-secretsecretsecret123", model: "mock", useProxy: false,
  agentRequireApproval: true, agentAutoDiagnostics: false, agentMaxRounds: 2,
  agentAllowNetwork: false, memoryLayerProject: false, memoryLayerSession: false, memoryLayerPreferences: false };

async function tracedTurn(detailed: boolean): Promise<AgentTrace[]> {
  const settings = { ...base, agentTraceDetailed: detailed };
  let calls = 0;
  let approval: Parameters<RunAgentTurnOptions["onAwaitPlanApproval"]>[0] | undefined;
  const snapshots: AgentTrace[] = [];
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/fs/write")) return Response.json({ size: 1, diff: "" });
    if (String(url).includes("/fs/list")) return Response.json({ entries: [] });
    if (String(url).includes("/fs/checkpoint/capture")) return Response.json({ id: "c", paths: [] });
    assert.ok(String(url).endsWith("/chat/completions"), String(url));
    calls++;
    const delta = calls === 1
      ? { content: "## Plan\n1. write_file(path=\"a.ts\", content=\"a\")" }
      : calls === 2
        ? { tool_calls: [{ index: 0, id: "call", function: { name: "write_file", arguments: JSON.stringify({ path: "a.ts", content: "a" }) } }] }
        : { content: "Done." };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
  };
  const text = "修改项目中的 a.ts (token sk-abcdefghijklmnopqrstu)";
  assert.equal(await runAgentTurn({ llm: settings, settings, userText: text, locale: "en", session: undefined,
    thread: { id: "t", createdAt: 1, messages: [{ id: "u", role: "user", content: text, children: [], createdAt: 1 }] },
    projectRoot: "/mock/project", sidecarUrl: "https://sidecar.test", signal: new AbortController().signal,
    isOwned: () => true, patchContent: () => {}, onAgentChange: () => {}, onAgentActivity: () => {},
    onAwaitPlanApproval: plan => { approval = plan; },
    traceKey: "reply-1",
    persistTrace: (t) => snapshots.push(t),
  }), "waiting_plan");
  assert.ok(approval);
  assert.ok(snapshots.length >= 1, "trace is saved when the turn pauses for approval");
  await approval.continueExecution();
  return snapshots;
}

try {
  const snaps = await tracedTurn(false);
  const trace = snaps.at(-1)!;
  assert.equal(trace.id, "reply-1");
  const kinds = trace.events.map((e) => e.kind);
  for (const k of ["turn_start", "llm_call", "approval_requested", "paused", "approval_resumed", "tool_call", "segment_end"] as const) {
    assert.ok(kinds.includes(k), `trace has ${k}: ${kinds.join(",")}`);
  }
  assert.ok(kinds.indexOf("approval_requested") < kinds.indexOf("approval_resumed"));
  const tool = trace.events.find((e) => e.kind === "tool_call")!;
  assert.equal(tool.data.tool, "write_file");
  assert.equal(tool.data.ok, true);
  assert.ok(trace.events.some((e) => e.kind === "phase"), "phase changes are recorded");
  const llm = trace.events.find((e) => e.kind === "llm_call")!;
  assert.equal(llm.data.messages, undefined, "summary mode keeps no full prompts");
  const json = JSON.stringify(trace);
  assert.ok(!json.includes("sk-secretsecretsecret123"), "API key never in the trace");
  assert.ok(!json.includes("sk-abcdefghijklmnopqrstu"), "key-like text is redacted");

  const summary = formatAgentTraceSummary(trace);
  assert.match(summary, /tool write_file\(/);
  assert.match(summary, /approval_requested/);
  const packet = buildTurnDiagnosticPacket({
    session: undefined, thread: undefined, targetMessageId: "reply-1", projectRoot: "/mock/project",
    sidecarUrl: "", sourceMode: false, loadingMain: false, loadingArchive: false, loadingCompress: false,
    loadingBranchId: null, pendingFileIncludes: [], agentActivity: [], agentChanges: [], agentTrace: trace,
  });
  assert.match(packet, /## Agent Loop Trace[\s\S]*tool write_file\(/);
  console.log("[PASS] agent turn is traced across the approval pause; packet includes it");

  const detailed = (await tracedTurn(true)).at(-1)!;
  const dLlm = detailed.events.find((e) => e.kind === "llm_call")!;
  assert.ok(Array.isArray(dLlm.data.messages) && (dLlm.data.messages as unknown[]).length > 0, "detailed mode keeps prompts");
  assert.ok(!JSON.stringify(detailed).includes("sk-secretsecretsecret123"));
  console.log("[PASS] detailed mode keeps prompts and stays redacted");
} finally {
  globalThis.fetch = original;
}
console.log("All agent-trace probes passed.");
