/**
 * Probe #342: empty / failed / aborted archive generation must restore the
 * prior live (or prior archive) context instead of leaving stale archive mode.
 *
 * Usage: npx tsx scripts/test-archive-mode-rollback.mts
 */
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import type { ApiSettings, ChatSession, ThreadRoot } from "../src/types.ts";

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

type PendingChat = {
  signal?: AbortSignal;
  controller: ReadableStreamDefaultController<Uint8Array>;
};

const encoder = new TextEncoder();
const pendingChats: PendingChat[] = [];

function finishEmpty(request: PendingChat): void {
  request.controller.enqueue(
    encoder.encode(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "   " } }] })}\n\n`,
    ),
  );
  request.controller.enqueue(
    encoder.encode(
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
    ),
  );
  request.controller.enqueue(encoder.encode("data: [DONE]\n\n"));
  request.controller.close();
}

function finishOk(request: PendingChat, content: string): void {
  request.controller.enqueue(
    encoder.encode(
      `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
    ),
  );
  request.controller.enqueue(
    encoder.encode(
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
    ),
  );
  request.controller.enqueue(encoder.encode("data: [DONE]\n\n"));
  request.controller.close();
}

function fail(request: PendingChat, error = new Error("archive stream failed")): void {
  request.controller.error(error);
}

globalThis.fetch = (async (_input, init) => {
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

const { useAppStore } = await import("../src/store/useAppStore.ts");
const { resolveConversationContext } = await import(
  "../src/lib/conversationContext.ts"
);

const settings: ApiSettings = {
  baseUrl: "http://127.0.0.1:4567/v1",
  apiKey: "probe-key",
  model: "probe",
  useProxy: false,
  memoryLayerPreferences: false,
  memoryLayerProject: false,
  memoryLayerSession: false,
  agentAllowNetwork: false,
  agentRequireApproval: false,
  compressAfterArchive: false,
};

function thread(id: string): ThreadRoot {
  return {
    id: `thread-${id}`,
    createdAt: 1,
    messages: [
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
        content: `answer-${id}`,
        children: [],
        createdAt: 2,
      },
    ],
  };
}

function session(id: string, extra: Partial<ChatSession> = {}): ChatSession {
  return {
    id,
    title: id,
    thread: thread(id),
    createdAt: 1,
    updatedAt: 1,
    contextMode: "live",
    activeArchiveId: null,
    threadView: "evolution",
    ...extra,
  };
}

function reset(sessions: ChatSession[], activeSessionId: string): void {
  pendingChats.length = 0;
  values.clear();
  const active = sessions.find((item) => item.id === activeSessionId) ?? null;
  useAppStore.setState({
    sessions,
    activeSessionId,
    thread: active?.thread ?? null,
    settings,
    projectRoot: null,
    loadingArchiveSessionId: null,
    loadingArchiveBySession: {},
    loadingCompressSessionId: null,
    loadingCompressBySession: {},
    loadingMainBySession: {},
    archiveDraft: "",
    archiveDraftBySession: {},
    viewingArchiveId: null,
    archiveAlreadyCurrent: false,
    error: null,
  });
}

async function waitForPending(): Promise<PendingChat> {
  for (let i = 0; i < 100; i += 1) {
    const next = pendingChats.find((item) => !item.signal?.aborted);
    if (next) return next;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for archive request");
}

function activeSession() {
  const state = useAppStore.getState();
  return state.sessions.find((item) => item.id === state.activeSessionId)!;
}

// Reproduce: empty archive leaves stale archive mode without a snapshot.
reset([session("empty")], "empty");
{
  const promise = useAppStore.getState().archiveCurrent();
  const pending = await waitForPending();
  assert.equal(activeSession().contextMode, "archive");
  assert.equal(activeSession().threadView, "archive");
  finishEmpty(pending);
  await promise;
  const sess = activeSession();
  assert.equal(sess.contextMode, "live");
  assert.equal(sess.threadView, "evolution");
  assert.equal(sess.activeArchiveId ?? null, null);
  assert.equal((sess.archives ?? []).length, 0);
  assert.equal(resolveConversationContext(sess).mode, "live");
  assert.ok(useAppStore.getState().error);
  console.log("[PASS] empty archive restores live context");
}

// Failed stream restores prior live context.
reset([session("fail")], "fail");
{
  const promise = useAppStore.getState().archiveCurrent();
  const pending = await waitForPending();
  fail(pending);
  await promise;
  const sess = activeSession();
  assert.equal(sess.contextMode, "live");
  assert.equal(sess.threadView, "evolution");
  assert.equal(sess.activeArchiveId ?? null, null);
  assert.equal((sess.archives ?? []).length, 0);
  assert.ok(useAppStore.getState().error);
  console.log("[PASS] failed archive restores live context");
}

// Abort restores prior live context.
reset([session("abort")], "abort");
{
  const promise = useAppStore.getState().archiveCurrent();
  const pending = await waitForPending();
  assert.equal(activeSession().contextMode, "archive");
  useAppStore.getState().stopGeneration();
  assert.equal(pending.signal?.aborted, true);
  await promise;
  const sess = activeSession();
  assert.equal(sess.contextMode, "live");
  assert.equal(sess.threadView, "evolution");
  assert.equal(sess.activeArchiveId ?? null, null);
  console.log("[PASS] aborted archive restores live context");
}

// Successful archive keeps archive mode with a real snapshot.
reset([session("ok")], "ok");
{
  const promise = useAppStore.getState().archiveCurrent();
  const pending = await waitForPending();
  finishOk(pending, "# Dev log\n\nShipped rollback.");
  await promise;
  const sess = activeSession();
  assert.equal(sess.contextMode, "archive");
  assert.equal(sess.threadView, "archive");
  assert.ok(sess.activeArchiveId);
  assert.equal((sess.archives ?? []).length, 1);
  assert.equal(resolveConversationContext(sess).mode, "archive");
  console.log("[PASS] successful archive keeps archive context");
}

// Incremental failure restores prior archive snapshot context.
{
  const priorId = "arch-prior";
  reset(
    [
      session("incr", {
        contextMode: "archive",
        activeArchiveId: priorId,
        threadView: "archive",
        archives: [
          {
            id: priorId,
            createdAt: 1,
            title: "Prior",
            content: "# Prior\n\nold",
            throughMessageId: "user-incr",
            storage: "local",
          },
        ],
      }),
    ],
    "incr",
  );
  // Add new material so incremental archive runs.
  const current = activeSession();
  const nextThread: ThreadRoot = {
    ...current.thread!,
    messages: [
      ...current.thread!.messages,
      {
        id: "user-incr-2",
        role: "user",
        content: "new question",
        children: [],
        createdAt: 3,
      },
      {
        id: "assistant-incr-2",
        role: "assistant",
        content: "new answer",
        children: [],
        createdAt: 4,
      },
    ],
  };
  useAppStore.setState({
    thread: nextThread,
    sessions: useAppStore.getState().sessions.map((item) =>
      item.id === "incr" ? { ...item, thread: nextThread } : item,
    ),
  });

  const promise = useAppStore.getState().archiveCurrent();
  const pending = await waitForPending();
  finishEmpty(pending);
  await promise;
  const sess = activeSession();
  assert.equal(sess.contextMode, "archive");
  assert.equal(sess.threadView, "archive");
  assert.equal(sess.activeArchiveId, priorId);
  assert.equal((sess.archives ?? []).length, 1);
  assert.equal(resolveConversationContext(sess).mode, "archive");
  console.log("[PASS] empty incremental archive restores prior archive");
}

console.log("test-archive-mode-rollback: ok");
