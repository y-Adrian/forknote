/**
 * Probe: per-turn diagnostic packet contains conversation/debug context
 * without API secrets.
 *
 * Usage: npx tsx scripts/test-turn-diagnostic-packet.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildTurnDiagnosticPacket } from "../src/lib/conversationDiagnostic.ts";
import type { ChatSession, ThreadRoot } from "../src/types.ts";

const thread: ThreadRoot = {
  id: "thread_1",
  createdAt: 1,
  messages: [
    {
      id: "u1",
      role: "user",
      content: "为什么当前对话逻辑不对？",
      children: [],
      createdAt: 1,
    },
    {
      id: "a1",
      role: "assistant",
      content: "## 诊断\n\n可能是记忆注入问题。",
      children: [],
      createdAt: 2,
      pointVerdicts: { 1: "unsure" },
    },
  ],
};

const session: ChatSession = {
  id: "s1",
  title: "Debug session",
  thread,
  createdAt: 1,
  updatedAt: 2,
  contextMode: "archive",
  activeArchiveId: "ar1",
  archives: [
    {
      id: "ar1",
      createdAt: 3,
      title: "Prior archive",
      content: "archive body",
      throughMessageId: "a1",
    },
  ],
  contextMemory: {
    project: "# Project",
    summary: "summary",
    tasks: "- [ ] task",
    decisions: "- keep diagnostics local",
    coding: "- Prefer concise diagnostics",
    updatedAt: 4,
    storage: "project",
    dir: ".forknote/memory",
  },
  sessionMemory: { summary: "session note", updatedAt: 5 },
  api: { apiKey: "SECRET_SHOULD_NOT_APPEAR", model: "x" },
  feedbackLog: [
    {
      id: "f1",
      targetId: "a1",
      pointIndex: 1,
      signal: "unsure",
      explicit: true,
      weight: 1,
      source: "explicit",
      at: 6,
    },
  ],
};

const packet = buildTurnDiagnosticPacket({
  session,
  thread,
  targetMessageId: "a1",
  projectRoot: "/Users/me/project",
  sidecarUrl: "/sidecar",
  sourceMode: false,
  loadingMain: false,
  loadingArchive: false,
  loadingCompress: false,
  loadingBranchId: null,
  pendingFileIncludes: ["src/App.tsx"],
  agentActivity: [
    { id: "act1", kind: "search", message: "semantic_search", at: 7 },
  ],
  agentChanges: [{ path: "src/App.tsx", size: 123, at: 8 }],
  settings: {
    baseUrl: "https://api.example.com/v1",
    apiKey: "GLOBAL_SECRET_SHOULD_NOT_APPEAR",
    model: "global-model",
    useProxy: true,
    memoryLayerPreferences: true,
    memoryLayerProject: true,
    memoryLayerSession: false,
    compressAfterArchive: true,
    contextAutoSummary: true,
    contextWindowTurns: 64,
    agentRequireApproval: true,
    agentAllowTerminal: true,
    agentAllowNetwork: false,
    agentAutoDiagnostics: true,
  },
  generatedAt: Date.parse("2026-08-24T00:00:00.000Z"),
});

assert.match(packet, /ForkNote Turn Diagnostic/);
assert.match(packet, /Problem observed/);
assert.match(packet, /Automatic Analysis \(heuristic\)/);
assert.match(packet, /previousUserIntent: conversation-diagnostic/);
assert.match(packet, /assistantActualIntent: conversation-diagnostic/);
assert.match(packet, /alignment: match/);
assert.match(packet, /Agent Route \(inferred\)/);
assert.match(packet, /previousUser: user u1/);
assert.match(packet, /targetMessage: assistant a1/);
assert.match(packet, /renderMode: full-preview/);
assert.match(packet, /Nearby Message Index/);
assert.match(packet, /为什么当前对话逻辑不对/);
assert.match(packet, /可能是记忆注入问题/);
assert.match(packet, /PROJECT\.md chars: 9/);
assert.match(packet, /activeArchiveTitle: Prior archive/);
assert.match(packet, /model: x/);
assert.match(packet, /baseUrlHost: https:\/\/api\.example\.com/);
assert.match(packet, /memoryLayerSession: off/);
assert.match(packet, /contextWindowTurns: 64/);
assert.match(packet, /semantic_search/);
assert.match(packet, /src\/App\.tsx/);
assert.doesNotMatch(packet, /SECRET_SHOULD_NOT_APPEAR/);
assert.doesNotMatch(packet, /GLOBAL_SECRET_SHOULD_NOT_APPEAR/);
assert.doesNotMatch(packet, /apiKey/i);

const driftThread: ThreadRoot = {
  id: "thread_drift",
  createdAt: 1,
  messages: [
    {
      id: "u2",
      role: "user",
      content: "告诉我现在你了解到的信息",
      children: [],
      createdAt: 1,
    },
    {
      id: "a2",
      role: "assistant",
      content: "报错来自 cmake/toolchain.cmake，SYSROOT_DIR 变量为空。",
      children: [],
      createdAt: 2,
    },
  ],
};

const driftPacket = buildTurnDiagnosticPacket({
  session: { ...session, id: "s2", thread: driftThread },
  thread: driftThread,
  targetMessageId: "a2",
  projectRoot: "/Users/me/project",
  sidecarUrl: "/sidecar",
  sourceMode: false,
  loadingMain: false,
  loadingArchive: false,
  loadingCompress: false,
  loadingBranchId: null,
  pendingFileIncludes: [],
  agentActivity: [],
  agentChanges: [],
  settings: null,
  generatedAt: Date.parse("2026-08-24T00:00:00.000Z"),
});

assert.match(driftPacket, /previousUserIntent: project-understanding-summary/);
assert.match(driftPacket, /assistantActualIntent: build-error-troubleshooting/);
assert.match(driftPacket, /alignment: mismatch/);
assert.match(driftPacket, /suspectedIssue: answer drift \/ stale context injection/);
assert.match(driftPacket, /groundingRisk: high/);
assert.match(driftPacket, /answerMentionsUnseenBuildIssue: yes/);
assert.match(driftPacket, /turnMode: plain-chat\/no-tools/);
assert.match(driftPacket, /preferPlainChat: yes/);
assert.match(driftPacket, /forcePlainNoTools: yes/);
assert.match(driftPacket, /projectUnderstandingSummary: yes/);
assert.match(driftPacket, /networkOnlyTurn: no/);
assert.match(driftPacket, /availableTools: \(none\)/);

const actions = readFileSync("src/components/MessageActions.tsx", "utf8");
assert.ok(actions.includes("onDiagnose"), "MessageActions exposes diagnose action");
const list = readFileSync("src/components/MainChatMessageList.tsx", "utf8");
assert.ok(list.includes("onDiagnoseMessage"), "main message list wires diagnose action");
const panel = readFileSync("src/components/MainPanel.tsx", "utf8");
assert.ok(panel.includes("buildTurnDiagnosticPacket"), "MainPanel builds diagnostic packet");

console.log("[PASS] turn diagnostic packet");
console.log("test-turn-diagnostic-packet: ok");
