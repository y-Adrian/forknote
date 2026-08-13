/**
 * Probe #340: streaming token patches should not full-store localStorage-write
 * on every delta, while critical session mutations and turn exits still flush.
 *
 * Usage: npx tsx scripts/test-stream-storage-throttle.mts
 */
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import type { ApiSettings, ChatSession, ThreadRoot } from "../src/types.ts";

Object.defineProperty(globalThis, "crypto", {
  configurable: true,
  value: webcrypto,
});

const SESSION_STORE_KEY = "forknote-sessions-v1";
const values = new Map<string, string>();
let sessionWrites = 0;
const storage = {
  getItem(key: string) {
    return values.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    if (key === SESSION_STORE_KEY) sessionWrites += 1;
    values.set(key, String(value));
  },
  removeItem(key: string) {
    values.delete(key);
  },
  clear() {
    values.clear();
  },
};
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: storage,
});

const {
  flushScheduledSessionStoreSave,
  loadSessionStore,
  saveSessionStore,
} = await import("../src/lib/storage.ts");
const { useAppStore } = await import("../src/store/useAppStore.ts");

type PendingChat = {
  signal?: AbortSignal;
  controller: ReadableStreamDefaultController<Uint8Array>;
};

const encoder = new TextEncoder();
const pendingChats: PendingChat[] = [];

function sseDelta(content: string): Uint8Array {
  return encoder.encode(
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
  );
}

function emit(request: PendingChat, content: string): void {
  request.controller.enqueue(sseDelta(content));
}

function finish(request: PendingChat): void {
  request.controller.enqueue(
    encoder.encode(
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
    ),
  );
  request.controller.enqueue(encoder.encode("data: [DONE]\n\n"));
  request.controller.close();
}

function fail(request: PendingChat, error = new Error("stream failed")): void {
  request.controller.error(error);
}

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (!String(input).includes("/chat/completions")) {
    return new Response("{}", { status: 200 });
  }
  let request!: PendingChat;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      request = {
        signal: init?.signal ?? undefined,
        controller,
      };
      pendingChats.push(request);
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}) as typeof fetch;

const settings: ApiSettings = {
  baseUrl: "http://127.0.0.1:4567/v1",
  apiKey: "",
  model: "probe",
  useProxy: false,
  memoryLayerPreferences: false,
  memoryLayerProject: false,
  memoryLayerSession: false,
  agentAllowNetwork: false,
  agentRequireApproval: false,
};

function thread(id: string, content = ""): ThreadRoot {
  return {
    id: `thread-${id}`,
    createdAt: 1,
    messages: content
      ? [
          {
            id: `user-${id}`,
            role: "user",
            content: `question-${id}`,
            children: [],
            createdAt: 1,
          },
          {
            id: `assistant-${id}`,
            role: "assistant",
            content,
            children: [],
            createdAt: 2,
          },
        ]
      : [],
  };
}

function session(id: string, content = ""): ChatSession {
  return {
    id,
    title: id,
    thread: content ? thread(id, content) : null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function resetStore(sessions: ChatSession[], activeSessionId: string): void {
  flushScheduledSessionStoreSave();
  pendingChats.length = 0;
  storage.clear();
  const active = sessions.find((item) => item.id === activeSessionId) ?? null;
  useAppStore.setState({
    sessions,
    activeSessionId,
    thread: active?.thread ?? null,
    settings,
    projectRoot: null,
    projectError: null,
    focus: { type: "root" },
    error: null,
    loadingMainBySession: {},
    loadingBranchBySession: {},
    pendingClarifyBySession: {},
    loadingArchiveSessionId: null,
    loadingArchiveBySession: {},
    loadingCompressSessionId: null,
    loadingCompressBySession: {},
    archiveDraft: "",
    archiveDraftBySession: {},
    agentPendingPlan: null,
    agentActivity: [],
    agentChanges: [],
    pendingFileIncludes: [],
  });
  saveSessionStore({ sessions, activeSessionId });
  sessionWrites = 0;
}

async function waitFor<T>(read: () => T | undefined): Promise<T> {
  for (let index = 0; index < 200; index += 1) {
    const result = read();
    if (result !== undefined) return result;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for streaming storage probe");
}

async function nextChat(): Promise<PendingChat> {
  return waitFor(() => pendingChats.shift());
}

function storedAssistantContent(sessionId: string): string {
  const store = loadSessionStore();
  const stored = store.sessions.find((item) => item.id === sessionId);
  const message = stored?.thread?.messages.find(
    (item) => item.role === "assistant",
  );
  return message?.content ?? "";
}

try {
  resetStore([session("throttle")], "throttle");
  const manyPatchTurn = useAppStore.getState().askMain("stream many patches");
  const manyPatchChat = await nextChat();
  for (let index = 0; index < 50; index += 1) {
    emit(manyPatchChat, `${index},`);
  }
  const expectedManyPatchContent = Array.from(
    { length: 50 },
    (_, index) => `${index},`,
  ).join("");
  await waitFor(() =>
    useAppStore.getState().thread?.messages.at(-1)?.content ===
    expectedManyPatchContent
      ? true
      : undefined,
  );
  assert.equal(
    useAppStore.getState().thread?.messages.at(-1)?.content,
    expectedManyPatchContent,
    "in-memory UI content updates immediately on every token",
  );
  finish(manyPatchChat);
  await manyPatchTurn;
  assert.ok(
    sessionWrites <= 4,
    `50 streaming patches should coalesce to far fewer writes, got ${sessionWrites}`,
  );
  assert.equal(
    storedAssistantContent("throttle"),
    expectedManyPatchContent,
    "final assistant content persisted after turn flush",
  );
  console.log("[PASS] streaming patches coalesce and final content flushes");

  resetStore([session("abort")], "abort");
  const abortTurn = useAppStore.getState().askMain("abort me");
  const abortChat = await nextChat();
  emit(abortChat, "partial abort content");
  assert.ok(storedAssistantContent("abort").length < "partial abort content".length);
  const restoredPrompt = useAppStore.getState().stopGeneration();
  assert.equal(restoredPrompt, "abort me");
  await abortTurn;
  assert.equal(
    loadSessionStore().sessions.find((item) => item.id === "abort")?.thread,
    null,
    "abort rollback is flushed immediately",
  );
  console.log("[PASS] abort path flushes rollback");

  resetStore([session("error")], "error");
  const errorTurn = useAppStore.getState().askMain("error after partial");
  const errorChat = await nextChat();
  emit(errorChat, "partial before error");
  fail(errorChat);
  await errorTurn;
  assert.equal(
    storedAssistantContent("error"),
    "partial before error",
    "error path flushes last streamed assistant state",
  );
  console.log("[PASS] error path flushes partial state");

  resetStore([session("outgoing"), session("incoming")], "outgoing");
  const switchTurn = useAppStore.getState().askMain("switch while streaming");
  const switchChat = await nextChat();
  emit(switchChat, "outgoing survives switch");
  await waitFor(() =>
    useAppStore.getState().thread?.messages.at(-1)?.content ===
    "outgoing survives switch"
      ? true
      : undefined,
  );
  useAppStore.getState().switchSession("incoming");
  assert.equal(loadSessionStore().activeSessionId, "incoming");
  assert.equal(
    storedAssistantContent("outgoing"),
    "outgoing survives switch",
    "session switch flushes outgoing session before replacing the live thread",
  );
  finish(switchChat);
  await switchTurn;
  console.log("[PASS] session switch flushes outgoing session");

  resetStore([session("critical", "old")], "critical");
  const beforeRenameWrites = sessionWrites;
  assert.equal(useAppStore.getState().renameSession("critical", "renamed"), true);
  assert.equal(
    sessionWrites,
    beforeRenameWrites + 1,
    "non-streaming critical writes remain immediate",
  );
  assert.equal(
    loadSessionStore().sessions.find((item) => item.id === "critical")?.title,
    "renamed",
  );
  console.log("[PASS] non-streaming critical write remains immediate");
} finally {
  flushScheduledSessionStoreSave();
  globalThis.fetch = originalFetch;
}
