/**
 * Store simulation for concurrent session archive/compress jobs.
 * Usage: npx tsx scripts/test-session-summary-store.mts
 */
import assert from "node:assert/strict";
import type {
  ApiSettings,
  ChatSession,
  ThreadRoot,
} from "../src/types.ts";

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

type PendingRequest = {
  kind: "archive" | "compress";
  source: string;
  signal: AbortSignal | undefined;
  controller: ReadableStreamDefaultController<Uint8Array>;
};
const pending: PendingRequest[] = [];
const encoder = new TextEncoder();

globalThis.fetch = (async (_input, init) => {
  const body = JSON.parse(String(init?.body)) as {
    messages: Array<{ role: string; content: string }>;
  };
  const system = body.messages.find((message) => message.role === "system")
    ?.content;
  const user = body.messages.find((message) => message.role === "user")?.content;
  const kind = system?.includes("===SUMMARY.md===") ? "compress" : "archive";
  let request!: PendingRequest;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      request = {
        kind,
        source: user ?? "",
        signal: init?.signal ?? undefined,
        controller,
      };
      pending.push(request);
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}) as typeof fetch;

const { useAppStore } = await import("../src/store/useAppStore.ts");

function thread(id: string): ThreadRoot {
  return {
    id: `thread-${id}`,
    createdAt: 1,
    messages: [
      {
        id: `message-${id}`,
        role: "user",
        content: `content-${id}`,
        children: [],
        createdAt: 1,
      },
    ],
  };
}

function session(id: string): ChatSession {
  return {
    id,
    title: id,
    thread: thread(id),
    createdAt: 1,
    updatedAt: 1,
  };
}

const settings: ApiSettings = {
  baseUrl: "http://127.0.0.1:1234/v1",
  apiKey: "",
  model: "probe",
  useProxy: false,
  compressAfterArchive: true,
};

function reset(sessions: ChatSession[], activeSessionId: string) {
  const active = sessions.find((item) => item.id === activeSessionId)!;
  useAppStore.setState({
    sessions,
    activeSessionId,
    thread: active.thread,
    settings,
    projectRoot: null,
    loadingArchiveSessionId: null,
    loadingArchiveBySession: {},
    loadingCompressSessionId: null,
    loadingCompressBySession: {},
    archiveDraft: "",
    archiveDraftBySession: {},
    error: null,
  });
}

async function waitFor<T>(read: () => T | undefined): Promise<T> {
  for (let index = 0; index < 100; index += 1) {
    const result = read();
    if (result !== undefined) return result;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for store simulation");
}

function finish(request: PendingRequest, content: string) {
  request.controller.enqueue(
    encoder.encode(
      `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
    ),
  );
  request.controller.enqueue(encoder.encode("data: [DONE]\n\n"));
  request.controller.close();
}

function nextPending(kind: PendingRequest["kind"], source: string) {
  return waitFor(() =>
    pending.find(
      (request) =>
        request.kind === kind &&
        request.source.includes(source) &&
        !request.signal?.aborted,
    ),
  );
}

// Switching to B must not retarget A's archive completion or configured compress.
reset([session("A"), session("B")], "A");
const archiveAPromise = useAppStore.getState().archiveCurrent();
const archiveA = await nextPending("archive", "content-A");
useAppStore.getState().switchSession("B");
const activeBThread = useAppStore.getState().thread;
finish(archiveA, "# archive-A");
await archiveAPromise;

const compressA = await nextPending("compress", "archive-A");
assert.equal(useAppStore.getState().activeSessionId, "B");
finish(
  compressA,
  "===SUMMARY.md===\nsummary-A\n===TASKS.md===\n- [x] A\n===DECISIONS.md===\ndecision-A",
);
await waitFor(() =>
  useAppStore
    .getState()
    .sessions.find((item) => item.id === "A")
    ?.contextMemory?.summary.includes("summary-A")
    ? true
    : undefined,
);
assert.equal(useAppStore.getState().activeSessionId, "B");
assert.deepEqual(useAppStore.getState().thread, activeBThread);
assert.equal(
  useAppStore
    .getState()
    .sessions.find((item) => item.id === "B")?.contextMemory,
  undefined,
);
console.log("[PASS] switched archive/compress commits only to originating A");

// A+B can run together; stopping A must leave B alive and loading until B settles.
settings.compressAfterArchive = false;
reset([session("A2"), session("B2")], "A2");
const archiveA2Promise = useAppStore.getState().archiveCurrent();
const archiveA2 = await nextPending("archive", "content-A2");
useAppStore.getState().switchSession("B2");
const archiveB2Promise = useAppStore.getState().archiveCurrent();
const archiveB2 = await nextPending("archive", "content-B2");
assert.deepEqual(useAppStore.getState().loadingArchiveBySession, {
  A2: true,
  B2: true,
});
useAppStore.getState().switchSession("A2");
useAppStore.getState().stopGeneration();
assert.equal(archiveA2.signal?.aborted, true);
assert.equal(archiveB2.signal?.aborted, false);
assert.deepEqual(useAppStore.getState().loadingArchiveBySession, { B2: true });
useAppStore.getState().switchSession("B2");
assert.equal(useAppStore.getState().loadingArchiveSessionId, "B2");
finish(archiveB2, "# archive-B2");
await Promise.all([archiveA2Promise, archiveB2Promise]);
assert.deepEqual(useAppStore.getState().loadingArchiveBySession, {});
assert.equal(useAppStore.getState().loadingArchiveSessionId, null);
console.log("[PASS] stop A leaves B and indicators settle independently");

// Delete and app-wide clear must abort their owned jobs.
reset([session("A3"), session("B3")], "A3");
void useAppStore.getState().archiveCurrent();
const archiveA3 = await nextPending("archive", "content-A3");
useAppStore.getState().deleteSession("A3");
assert.equal(archiveA3.signal?.aborted, true);
assert.equal(
  useAppStore.getState().sessions.some((item) => item.id === "A3"),
  false,
);
void useAppStore.getState().archiveCurrent();
const archiveB3 = await nextPending("archive", "content-B3");
useAppStore.getState().clearAllSessions();
assert.equal(archiveB3.signal?.aborted, true);
assert.deepEqual(useAppStore.getState().loadingArchiveBySession, {});

reset([session("before-import")], "before-import");
void useAppStore.getState().archiveCurrent();
const archiveBeforeImport = await nextPending(
  "archive",
  "content-before-import",
);
const imported = session("imported");
useAppStore.getState().replaceSessionStore({
  sessions: [imported],
  activeSessionId: imported.id,
});
assert.equal(archiveBeforeImport.signal?.aborted, true);
assert.deepEqual(useAppStore.getState().loadingArchiveBySession, {});
console.log("[PASS] delete, clear, and import abort owned jobs");
