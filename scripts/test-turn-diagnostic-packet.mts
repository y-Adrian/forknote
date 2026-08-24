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
  generatedAt: Date.parse("2026-08-24T00:00:00.000Z"),
});

assert.match(packet, /ForkNote Turn Diagnostic/);
assert.match(packet, /previousUser: user u1/);
assert.match(packet, /targetMessage: assistant a1/);
assert.match(packet, /为什么当前对话逻辑不对/);
assert.match(packet, /可能是记忆注入问题/);
assert.match(packet, /PROJECT\.md chars: 9/);
assert.match(packet, /activeArchiveTitle: Prior archive/);
assert.match(packet, /semantic_search/);
assert.match(packet, /src\/App\.tsx/);
assert.doesNotMatch(packet, /SECRET_SHOULD_NOT_APPEAR/);
assert.doesNotMatch(packet, /apiKey/i);

const actions = readFileSync("src/components/MessageActions.tsx", "utf8");
assert.ok(actions.includes("onDiagnose"), "MessageActions exposes diagnose action");
const list = readFileSync("src/components/MainChatMessageList.tsx", "utf8");
assert.ok(list.includes("onDiagnoseMessage"), "main message list wires diagnose action");
const panel = readFileSync("src/components/MainPanel.tsx", "utf8");
assert.ok(panel.includes("buildTurnDiagnosticPacket"), "MainPanel builds diagnostic packet");

console.log("[PASS] turn diagnostic packet");
console.log("test-turn-diagnostic-packet: ok");
