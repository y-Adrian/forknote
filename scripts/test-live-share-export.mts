/**
 * Probe #345: share export must read live session state by id, not a frozen
 * snapshot captured when the dialog opened. Empty payloads stay valid.
 *
 * Usage: npx tsx scripts/test-live-share-export.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ChatSession, ThreadRoot } from "../src/types.ts";
import {
  buildSharePayload,
  getShareableMessages,
  resolveLiveShareSession,
  sessionToExportMarkdown,
  sessionToShareMarkdown,
  sharePayloadToHtml,
} from "../src/lib/sessionShare.ts";

{
  const dialog = readFileSync("src/components/ShareSessionDialog.tsx", "utf8");
  const sidebar = readFileSync("src/components/SessionSidebar.tsx", "utf8");
  assert.ok(dialog.includes("sessionId: NodeId"));
  assert.ok(dialog.includes("useAppStore"));
  assert.ok(!dialog.includes("session: ChatSession"));
  assert.ok(sidebar.includes("shareSessionId"));
  assert.ok(sidebar.includes("sessionId={shareSessionId}"));
  assert.ok(!sidebar.includes("session={shareSession}"));
  console.log("[PASS] share dialog resolves session by id from the store");
}

function thread(messages: ThreadRoot["messages"]): ThreadRoot {
  return { id: "t1", createdAt: 1, messages };
}

function session(
  id: string,
  messages: ThreadRoot["messages"],
  title = "Note",
): ChatSession {
  return {
    id,
    title,
    thread: thread(messages),
    createdAt: 1,
    updatedAt: 1,
  };
}

const frozen = session("s1", [
  {
    id: "u1",
    role: "user",
    content: "first",
    children: [],
    createdAt: 1,
  },
]);

const live = session("s1", [
  {
    id: "u1",
    role: "user",
    content: "first",
    children: [],
    createdAt: 1,
  },
  {
    id: "a1",
    role: "assistant",
    content: "second arrived while share stayed open",
    children: [],
    createdAt: 2,
  },
]);

assert.equal(getShareableMessages(frozen).length, 1);
assert.equal(getShareableMessages(live).length, 2);

const resolved = resolveLiveShareSession([live, session("other", [])], "s1");
assert.ok(resolved);
assert.equal(getShareableMessages(resolved!).length, 2);
assert.ok(
  sessionToShareMarkdown(resolved!).includes(
    "second arrived while share stayed open",
  ),
);
console.log("[PASS] live resolve includes messages added after dialog open");

const rich = session("rich", [
  {
    id: "a-rich",
    role: "assistant",
    content: "main answer",
    createdAt: 10,
    children: [
      {
        id: "branch-rich",
        parentId: "a-rich",
        anchor: { startOffset: 0, endOffset: 4, quotedText: "main" },
        userQuestion: "clarify?",
        assistantMessage: "clarified answer",
        createdAt: 11,
        children: [],
        replies: [
          {
            userQuestion: "follow up?",
            assistantMessage: "follow-up answer",
            createdAt: 12,
          },
        ],
      },
    ],
  },
]);
rich.archives = [
  {
    id: "archive-1",
    createdAt: 20,
    title: "Decision log",
    content: "Archived conclusion",
    throughMessageId: "a-rich",
  },
];
const richMarkdown = sessionToExportMarkdown(rich, undefined, {
  includeClarifications: true,
  includeArchives: true,
  includeTimestamps: true,
});
assert.match(richMarkdown, /### Clarification/);
assert.match(richMarkdown, /clarified answer/);
assert.match(richMarkdown, /follow-up answer/);
assert.match(richMarkdown, /## Archives/);
assert.match(richMarkdown, /Archived conclusion/);
assert.doesNotMatch(
  sessionToExportMarkdown(rich, undefined, { includeClarifications: false }),
  /clarified answer/,
);

const emptyPayload = buildSharePayload("Empty note", []);
assert.equal(emptyPayload.messages.length, 0);
const html = sharePayloadToHtml(emptyPayload, {
  roleUser: "You",
  roleAssistant: "Assistant",
  empty: "No messages to share yet.",
});
assert.ok(html.includes("No messages to share yet."));
assert.ok(sessionToShareMarkdown(session("empty", [], "Empty")).includes("_Empty note_"));
console.log("[PASS] empty share payloads remain explicitly valid");

console.log("test-live-share-export: ok");
