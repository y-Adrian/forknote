/**
 * Probe #343: clarify context must be resolved before a Fork stub is
 * persisted; removeBranchFromThread cleans provisional empty forks.
 *
 * Usage: npx tsx scripts/test-clarify-branch-rollback.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import type { ApiSettings, ChatSession, ThreadRoot } from "../src/types.ts";
import {
  appendBranchToMessage,
  removeBranchFromThread,
} from "../src/lib/thread.ts";
import { buildClarifyAddendumMessages } from "../src/lib/contextBuilder.ts";

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
  const source = readFileSync("src/store/useAppStore.ts", "utf8");
  const start = source.indexOf("askBranch: async (parentId, parentContent, anchor, question, opts)");
  const end = source.indexOf("\n  clearPendingClarify: (sessionId) => {", start);
  assert.ok(start >= 0 && end > start, "askBranch implementation must exist");
  const askBranch = source.slice(start, end);
  const buildAt = askBranch.indexOf("buildClarifyAddendumMessages(");
  const persistAt = askBranch.indexOf("persistSessions(nextSessions");
  assert.ok(buildAt >= 0, "askBranch must build clarify context");
  assert.ok(persistAt >= 0, "askBranch must persist the fork stub");
  assert.ok(
    buildAt < persistAt,
    "clarify context must resolve before persisting the provisional branch",
  );
  console.log("[PASS] askBranch validates clarify context before persist");
}

const thread: ThreadRoot = {
  id: "t1",
  createdAt: 1,
  messages: [
    {
      id: "u1",
      role: "user",
      content: "What is gossip?",
      children: [],
      createdAt: 1,
    },
    {
      id: "a1",
      role: "assistant",
      content: "【1】Gossip spreads state across peers.",
      children: [],
      createdAt: 2,
    },
  ],
};

assert.throws(
  () =>
    buildClarifyAddendumMessages(
      thread,
      "missing-parent",
      "Gossip spreads state across peers.",
      "What does that mean?",
      "en",
    ),
  /fork context/i,
);
console.log("[PASS] unresolved clarify parent throws before any stub");

const stub = {
  id: "b-stub",
  parentId: "a1",
  anchor: {
    startOffset: 0,
    endOffset: 10,
    quotedText: "Gossip spreads",
  },
  userQuestion: "What does that mean?",
  assistantMessage: "",
  children: [],
  createdAt: 3,
};
const withStub = appendBranchToMessage(thread, "a1", stub);
assert.equal(withStub.messages[1].children.length, 1);
const rolled = removeBranchFromThread(withStub, "b-stub");
assert.equal(rolled.messages[1].children.length, 0);
assert.equal(rolled.messages[1].id, "a1");
console.log("[PASS] removeBranchFromThread drops empty provisional fork");

// Store: invalid parent must not persist a stub.
globalThis.fetch = (async () => {
  throw new Error("fetch should not run when clarify context fails");
}) as typeof fetch;

const { useAppStore } = await import("../src/store/useAppStore.ts");

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
};

const session: ChatSession = {
  id: "s1",
  title: "s1",
  thread,
  createdAt: 1,
  updatedAt: 1,
};

useAppStore.setState({
  sessions: [session],
  activeSessionId: "s1",
  thread,
  settings,
  projectRoot: null,
  loadingMainBySession: {},
  loadingBranchBySession: {},
  pendingClarifyBySession: {},
  error: null,
});

const beforeChildren = useAppStore.getState().thread!.messages[1].children.length;
const result = await useAppStore.getState().askBranch(
  "missing-parent",
  "【1】Gossip spreads state across peers.",
  {
    startOffset: 0,
    endOffset: 10,
    quotedText: "Gossip spreads",
  },
  "What does that mean?",
);
assert.equal(result, undefined);
assert.equal(
  useAppStore.getState().thread!.messages[1].children.length,
  beforeChildren,
);
assert.ok(useAppStore.getState().error);
console.log("[PASS] askBranch leaves no stub when context resolution fails");

console.log("test-clarify-branch-rollback: ok");
