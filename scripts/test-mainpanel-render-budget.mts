/**
 * Probe #375: MainPanel message list is memo-isolated from composer typing,
 * with narrowed section store keys and streaming row-stability helpers.
 *
 * Usage: npx tsx scripts/test-mainpanel-render-budget.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAIN_PANEL_COMPOSER_STORE_KEYS,
  MAIN_PANEL_MESSAGE_LIST_STORE_KEYS,
  changedPropKeys,
  countStableMessageRows,
  messageListPropsStableAcrossTyping,
} from "../src/lib/mainPanelRenderBudget.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Prove the prior failure shape: composer input must not dirty message-list props.
const listProps = {
  visibleMessages: Object.freeze([{ id: "a1" }]),
  loadingMain: false,
  openBranchId: null as string | null,
};
assert.equal(
  messageListPropsStableAcrossTyping(listProps, { ...listProps }),
  true,
);
assert.equal(
  messageListPropsStableAcrossTyping(listProps, {
    ...listProps,
    input: "typing…",
  }),
  false,
  "message list must not accept composer input as a prop",
);
assert.deepEqual(
  changedPropKeys(listProps, { ...listProps, loadingMain: true }),
  ["loadingMain"],
);

// Streaming: prior message object identity should remain stable.
const m1 = { id: "u1" };
const m2 = { id: "a1" };
const prev = [m1, m2];
const next = [m1, { id: "a1" }]; // new tail object
const budget = countStableMessageRows(prev, next);
assert.equal(budget.stable, 1);
assert.ok(budget.changed >= 1);

assert.ok(MAIN_PANEL_MESSAGE_LIST_STORE_KEYS.includes("thread"));
assert.ok(MAIN_PANEL_COMPOSER_STORE_KEYS.includes("pendingFileIncludes"));
assert.ok(
  !MAIN_PANEL_MESSAGE_LIST_STORE_KEYS.includes(
    "pendingFileIncludes" as never,
  ),
);

const main = readFileSync(join(root, "src/components/MainPanel.tsx"), "utf8");
assert.match(main, /MainChatMessageList/);
assert.match(main, /onEditUserMessage=\{editUserMessage\}/);
assert.doesNotMatch(
  main,
  /<MainChatMessageList[\s\S]*?\binput=/,
  "MainChatMessageList must not take composer input",
);
assert.match(main, /useCallback\(\(text: string\) => \{/);

const list = readFileSync(
  join(root, "src/components/MainChatMessageList.tsx"),
  "utf8",
);
assert.match(list, /export const MainChatMessageList = memo\(/);
assert.match(list, /const UserMessageRow = memo\(/);
assert.match(list, /const AssistantMessageRow = memo\(/);
assert.doesNotMatch(list, /\binput\b\s*:/);

console.log("ok: MainPanel message list isolated from typing");
