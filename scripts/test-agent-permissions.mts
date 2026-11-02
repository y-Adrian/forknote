/**
 * User terminal allow/deny rules: matching semantics, and the agent turn
 * skips the approval card for allowed commands / never executes denied ones.
 *
 * Usage: npx tsx scripts/test-agent-permissions.mts
 */
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  normalizeCommandRules,
  resolveCommandPermission,
} from "../src/lib/agentPermissions.ts";
import { normalizeApiSettings } from "../src/lib/settings.ts";
import { runAgentTurn } from "../src/lib/agentTurn.ts";

Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });

{
  const rules = { allow: ["npm test", "git status", "ls"], deny: ["git push", "rm"] };
  assert.equal(resolveCommandPermission("npm test", rules), "allow");
  assert.equal(resolveCommandPermission("npm  test -- --watch", rules), "allow");
  assert.equal(resolveCommandPermission("npm tester", rules), "ask");
  assert.equal(resolveCommandPermission("git status && npm test", rules), "allow");
  assert.equal(resolveCommandPermission("git status && npm run build", rules), "ask");
  assert.equal(resolveCommandPermission("ls | rm -rf x", rules), "deny");
  assert.equal(resolveCommandPermission("git push origin leading", rules), "deny");
  assert.equal(resolveCommandPermission("ls $(cat x)", rules), "ask");
  assert.equal(resolveCommandPermission("ls `pwd`", rules), "ask");
  assert.equal(resolveCommandPermission("", rules), "ask");
  assert.equal(
    resolveCommandPermission("git push", { allow: ["git push"], deny: ["git push"] }),
    "deny",
  );
  assert.deepEqual(normalizeCommandRules([" npm  test ", "", "npm test", 3, "ls"]), ["npm test", "ls"]);
  assert.deepEqual(normalizeApiSettings({ agentCommandAllow: ["a", " a "] } as never).agentCommandAllow, ["a"]);
  console.log("[PASS] rule matching, compound commands, deny precedence");
}

const encoder = new TextEncoder();
function toolCallReply(command: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "run_terminal", arguments: JSON.stringify({ command }) } }] }, finish_reason: null }] })}\n\n`));
      c.enqueue(encoder.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
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

async function runWithRules(command: string, rules: { allow?: string[]; deny?: string[] }) {
  const originalFetch = globalThis.fetch;
  let llmCalls = 0;
  const runs: Array<{ command: string; allowOutsideProject: unknown }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/chat/completions")) {
      llmCalls += 1;
      return llmCalls === 1 ? toolCallReply(command) : textReply("done");
    }
    if (url.includes("/fs/run")) {
      const body = JSON.parse(String(init?.body));
      runs.push({ command: body.command, allowOutsideProject: body.allowOutsideProject });
      return Response.json({ ok: true, exitCode: 0, stdout: "ok", stderr: "" });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  }) as typeof fetch;
  const settings = {
    baseUrl: "http://mock.local/v1", apiKey: "test", model: "test-model", useProxy: false,
    memoryLayerProject: false, memoryLayerPreferences: false, memoryLayerSession: false,
    agentRequireApproval: false, agentAllowTerminal: true, agentMaxRounds: 3,
    agentCommandAllow: rules.allow, agentCommandDeny: rules.deny,
  };
  const userText = "列出项目根目录的文件";
  const thread = {
    id: "t", createdAt: 1,
    messages: [
      { id: "u", role: "user" as const, content: userText, children: [] as string[], createdAt: 1 },
      { id: "a", role: "assistant" as const, content: "", children: [] as string[], createdAt: 2 },
    ],
  };
  let approvalShown = false;
  const activities: string[] = [];
  try {
    const outcome = await runAgentTurn({
      llm: settings, settings, locale: "en", session: undefined, userText, thread,
      projectRoot: "/tmp/forknote-permissions-probe", sidecarUrl: "http://127.0.0.1:8787",
      signal: new AbortController().signal, isOwned: () => true, patchContent: () => {},
      onAgentActivity: (a) => activities.push(a.message), onAgentChange: () => {},
      onAwaitPlanApproval: () => { approvalShown = true; },
    });
    return { outcome, approvalShown, runs, activities };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const asked = await runWithRules("ls /tmp", {});
  assert.equal(asked.approvalShown, true, "outside command without a rule needs approval");
  assert.equal(asked.runs.length, 0);

  const allowed = await runWithRules("ls /tmp", { allow: ["ls"] });
  assert.equal(allowed.approvalShown, false, "allowed command must skip the card");
  assert.equal(allowed.runs.length, 1);
  assert.equal(allowed.runs[0]!.command, "ls /tmp");
  assert.equal(allowed.runs[0]!.allowOutsideProject, true, "allow rule grants outside access");
  console.log("[PASS] allowed outside-project command runs without approval");

  const denied = await runWithRules("ls /tmp", { allow: ["ls"], deny: ["ls /tmp"] });
  assert.equal(denied.approvalShown, false, "denied command must not open a card");
  assert.equal(denied.runs.length, 0, "denied command must never reach the sidecar");
  assert.ok(denied.activities.some((m) => /Denied by rule/.test(m)));
  console.log("[PASS] denied command never executes");
}

console.log("All agent-permissions probes passed.");
