/**
 * Project rule files (AGENTS.md / CLAUDE.md / .cursorrules …) are read via the
 * sidecar and injected as a bounded system message on project turns.
 *
 * Usage: npx tsx scripts/test-project-rules.mts
 */
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  formatProjectRulesSystem,
  loadProjectRules,
} from "../src/lib/projectRules.ts";
import { runAgentTurn } from "../src/lib/agentTurn.ts";

Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });

const files: Record<string, string> = {
  "AGENTS.md": "Use pnpm. Never edit generated files.",
  ".cursorrules": "Prefer named exports.",
};
const encoder = new TextEncoder();
const originalFetch = globalThis.fetch;
const llmBodies: Array<{ messages: Array<{ role: string; content: string | null }> }> = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.pathname.endsWith("/fs/read")) {
    const path = url.searchParams.get("path") ?? "";
    if (path in files) {
      return Response.json({ path, content: files[path], size: files[path]!.length });
    }
    return Response.json({ error: "ENOENT: not found" }, { status: 404 });
  }
  if (url.pathname.endsWith("/chat/completions")) {
    llmBodies.push(JSON.parse(String(init?.body)));
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: null }] })}\n\n`));
        c.enqueue(encoder.encode("data: [DONE]\n\n"));
        c.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }
  throw new Error(`unexpected fetch: ${url}`);
}) as typeof fetch;

try {
  const rules = await loadProjectRules("/tmp/rules-probe", "http://127.0.0.1:8787");
  assert.deepEqual(rules.map((r) => r.path), ["AGENTS.md", ".cursorrules"]);
  console.log("[PASS] loads existing rule files in priority order, skips missing");

  const text = formatProjectRulesSystem(rules, "en")!;
  assert.match(text, /^\[Project rules\]/);
  assert.match(text, /--- AGENTS\.md ---\nUse pnpm/);
  assert.equal(formatProjectRulesSystem([], "en"), null);
  const capped = formatProjectRulesSystem(
    [{ path: "AGENTS.md", content: "x".repeat(500) }, { path: "CLAUDE.md", content: "y" }],
    "zh",
    100,
  )!;
  assert.match(capped, /…\(truncated\)/);
  assert.ok(!capped.includes("CLAUDE.md"), "budget exhausted by the first file");
  console.log("[PASS] formatting and char budget");

  const settings = {
    baseUrl: "http://mock.local/v1", apiKey: "test", model: "test-model", useProxy: false,
    memoryLayerProject: false, memoryLayerPreferences: false, memoryLayerSession: false,
    agentRequireApproval: false, agentAllowTerminal: false, agentMaxRounds: 2,
  };
  const userText = "What does this project do?";
  const thread = {
    id: "t", createdAt: 1,
    messages: [
      { id: "u", role: "user" as const, content: userText, children: [] as string[], createdAt: 1 },
      { id: "a", role: "assistant" as const, content: "", children: [] as string[], createdAt: 2 },
    ],
  };
  await runAgentTurn({
    llm: settings, settings, locale: "en", session: undefined, userText, thread,
    projectRoot: "/tmp/rules-probe", sidecarUrl: "http://127.0.0.1:8787",
    signal: new AbortController().signal, isOwned: () => true, patchContent: () => {},
    onAgentActivity: () => {}, onAgentChange: () => {}, onAwaitPlanApproval: () => {},
  });
  assert.ok(llmBodies.length >= 1);
  assert.ok(
    llmBodies[0]!.messages.some((m) => m.role === "system" && /\[Project rules\][\s\S]*Use pnpm/.test(m.content ?? "")),
    "project turn must carry the rules system message",
  );
  console.log("[PASS] project turn injects rules");
} finally {
  globalThis.fetch = originalFetch;
}
console.log("All project-rules probes passed.");
