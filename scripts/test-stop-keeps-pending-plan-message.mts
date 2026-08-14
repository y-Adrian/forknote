/**
 * Probe #357: Stop while waiting for plan approval must clear the pending plan
 * without rolling back the initiating user message (mirror rejectAgentPlan).
 *
 * Usage: npx tsx scripts/test-stop-keeps-pending-plan-message.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import type { ApiSettings, ChatSession } from "../src/types.ts";

Object.defineProperty(globalThis, "crypto", {
  configurable: true,
  value: webcrypto,
});

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  },
});

{
  const storeSrc = readFileSync("src/store/useAppStore.ts", "utf8");
  const start = storeSrc.indexOf("stopGeneration: () => {");
  const end = storeSrc.indexOf("\n  setArchivePanelOpen:", start);
  assert.ok(start >= 0 && end > start, "stopGeneration must exist");
  const body = storeSrc.slice(start, end);
  assert.ok(
    body.includes("pendingPlanForSession") || body.includes("agentPendingPlan"),
    "stopGeneration must detect pending plan",
  );
  assert.ok(
    body.includes("rejectAgentPlan") ||
      body.includes("keep the") ||
      body.includes("Mirror rejectAgentPlan"),
    "stopGeneration pending-plan path should document reject parity",
  );
  // When pending: must clear plan before any rollback, and return null (no composer restore).
  const pendingIdx = body.indexOf("if (pendingPlanForSession)");
  assert.ok(pendingIdx >= 0, "explicit pendingPlanForSession branch required");
  const pendingBranch = body.slice(
    pendingIdx,
    body.indexOf("// Roll back the incomplete main turn", pendingIdx),
  );
  assert.ok(
    pendingBranch.includes("clearPendingAgentPlan"),
    "pending stop must clear plan",
  );
  assert.ok(
    !pendingBranch.includes("rollbackMainTurn"),
    "pending stop must NOT rollback the user message",
  );
  assert.match(pendingBranch, /return null/);
  console.log("[PASS] stopGeneration pending-plan path skips rollbackMainTurn");
}

const encoder = new TextEncoder();
type PendingChat = {
  controller: ReadableStreamDefaultController<Uint8Array>;
};
const pendingChats: PendingChat[] = [];

function sse(text: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      pendingChats.push({ controller });
      const mid = Math.max(1, Math.floor(text.length / 2));
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(0, mid) } }] })}\n\n`,
        ),
      );
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(mid) } }] })}\n\n`,
        ),
      );
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
        ),
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

const planText =
  "## 计划\n1. 用 write_file 创建 hello.py\n\n## 预期操作\n- write_file";

globalThis.fetch = (async (input: RequestInfo | URL) => {
  if (String(input).includes("/chat/completions")) {
    return sse(planText);
  }
  return new Response("{}", { status: 200 });
}) as typeof fetch;

const { useAppStore } = await import("../src/store/useAppStore.ts");

const settings: ApiSettings = {
  baseUrl: "http://127.0.0.1:4567/v1",
  apiKey: "",
  model: "probe",
  useProxy: false,
  memoryLayerPreferences: false,
  memoryLayerProject: false,
  memoryLayerSession: false,
  agentAllowNetwork: false,
  agentRequireApproval: true,
};

const session: ChatSession = {
  id: "s-stop-plan",
  title: "stop plan",
  thread: null,
  createdAt: 1,
  updatedAt: 1,
  projectRoot: "/tmp/forknote-stop-plan-probe",
};

useAppStore.setState({
  sessions: [session],
  activeSessionId: session.id,
  thread: null,
  settings,
  projectRoot: session.projectRoot!,
  projectError: null,
  focus: { type: "root" },
  error: null,
  loadingMainBySession: {},
  loadingBranchBySession: {},
  pendingClarifyBySession: {},
  agentPendingPlan: null,
  agentActivityBySession: {},
  agentChangesBySession: {},
  agentActivity: [],
  agentChanges: [],
  pendingFileIncludes: [],
});

const prompt = "写一个 hello.py";
const turnPromise = useAppStore.getState().askMain(prompt);

await new Promise<void>((resolve, reject) => {
  const started = Date.now();
  const tick = () => {
    const plan = useAppStore.getState().agentPendingPlan;
    if (plan?.sessionId === session.id) {
      resolve();
      return;
    }
    if (Date.now() - started > 5000) {
      reject(new Error("timed out waiting for agentPendingPlan"));
      return;
    }
    setTimeout(tick, 10);
  };
  tick();
});

const before = useAppStore.getState().thread?.messages ?? [];
assert.ok(
  before.some((m) => m.role === "user" && m.content === prompt),
  "user message must exist while waiting for plan approval",
);

const restored = useAppStore.getState().stopGeneration();
assert.equal(restored, null, "stop on pending plan must not restore composer text");
assert.equal(
  useAppStore.getState().agentPendingPlan,
  null,
  "pending plan must be cleared",
);

const after = useAppStore.getState().thread?.messages ?? [];
assert.ok(
  after.some((m) => m.role === "user" && m.content === prompt),
  "user question must remain after stop during plan approval",
);
assert.ok(after.length >= 1, "thread must not be wiped");

await turnPromise;
console.log("[PASS] stop during pending plan keeps the user message");
console.log("All #357 stop-keeps-pending-plan-message probes passed.");
