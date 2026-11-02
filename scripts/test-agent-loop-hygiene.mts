/**
 * Loop hygiene: read-only calls batch in parallel between writes, and
 * loop-control nudges replace each other instead of piling up in history.
 *
 * Usage: npx tsx scripts/test-agent-loop-hygiene.mts
 */
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { groupCallsForExecution, runAgentTurn } from "../src/lib/agentTurn.ts";

Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });

{
  const ro = (s: string) => s.startsWith("r");
  assert.deepEqual(groupCallsForExecution(["r1", "r2", "w1", "r3", "w2", "w3", "r4", "r5"], ro), [
    ["r1", "r2"], ["w1"], ["r3"], ["w2"], ["w3"], ["r4", "r5"],
  ]);
  assert.deepEqual(groupCallsForExecution([], ro), []);
  console.log("[PASS] read-only runs group, writes are barriers");
}

const encoder = new TextEncoder();
function textReply(text: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`));
      c.enqueue(encoder.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

{
  const originalFetch = globalThis.fetch;
  const bodies: Array<{ messages: Array<{ role: string; content: string | null }> }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/chat/completions")) {
      bodies.push(JSON.parse(String(init?.body)));
      return textReply("I will look into it.");
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  const settings = {
    baseUrl: "http://mock.local/v1", apiKey: "test", model: "test-model", useProxy: false,
    memoryLayerProject: false, memoryLayerPreferences: false, memoryLayerSession: false,
    agentRequireApproval: false, agentAllowTerminal: false, agentMaxRounds: 6,
  };
  const userText = "Refactor src/app.ts and update the helper functions";
  const thread = {
    id: "t", createdAt: 1,
    messages: [
      { id: "u", role: "user" as const, content: userText, children: [] as string[], createdAt: 1 },
      { id: "a", role: "assistant" as const, content: "", children: [] as string[], createdAt: 2 },
    ],
  };
  try {
    await runAgentTurn({
      llm: settings, settings, locale: "en", session: undefined, userText, thread,
      projectRoot: "/tmp/forknote-hygiene-probe", sidecarUrl: "http://127.0.0.1:8787",
      signal: new AbortController().signal, isOwned: () => true, patchContent: () => {},
      onAgentActivity: () => {}, onAgentChange: () => {}, onAwaitPlanApproval: () => {},
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  const codeBodies = bodies.filter((b) => b.messages.some((m) => m.role === "assistant"));
  assert.ok(codeBodies.length >= 2, `expected nudged follow-up rounds, got ${bodies.length} requests`);
  for (const body of codeBodies) {
    const nudges = body.messages.filter(
      (m) => m.role === "user" && /^(Call tools now|请立刻调用工具执行)/.test(m.content ?? ""),
    );
    assert.ok(nudges.length <= 1, `stale nudges piled up: ${nudges.length}`);
    assert.ok(
      !body.messages.some((m) => /[一-龥]/.test(m.content ?? "") && m.role === "user" && /立刻调用/.test(m.content ?? "")),
      "en locale must not receive Chinese loop nudges",
    );
  }
  console.log(`[PASS] nudges replace each other (${bodies.length} requests)`);
}

console.log("All agent loop hygiene probes passed.");
