/**
 * Probe #370: clipboard copy surfaces failures and uses the shared fallback path.
 *
 * Usage: npx tsx scripts/test-clipboard-copy-fallback.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { t } from "../src/lib/i18n.ts";
import {
  copyTextToClipboard,
  copyTextViaExecCommand,
} from "../src/lib/clipboard.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const helper = read("src/lib/clipboard.ts");
assert.match(helper, /export async function copyTextToClipboard/);
assert.match(helper, /export function copyTextViaExecCommand/);
assert.match(helper, /document\.execCommand\("copy"\)/);
assert.match(helper, /setSelectionRange/);

// Prove UI call sites no longer swallow raw clipboard.writeText errors.
for (const rel of [
  "src/components/MarkdownBody.tsx",
  "src/components/DiagramFence.tsx",
  "src/components/ShareSessionDialog.tsx",
  "src/components/ShareViewer.tsx",
  "src/components/MessageActions.tsx",
  "src/components/MainPanel.tsx",
]) {
  const src = read(rel);
  assert.match(
    src,
    /copyTextToClipboard/,
    `${rel} must use shared copyTextToClipboard`,
  );
  assert.doesNotMatch(
    src,
    /navigator\.clipboard\.writeText/,
    `${rel} must not call navigator.clipboard.writeText directly`,
  );
  assert.match(
    src,
    /chat\.copyFailed|share\.copyFailed|is-copy-failed|CopyTextFeedback|"failed"/,
    `${rel} must surface a copy failure state`,
  );
}

assert.equal(t("chat.copyFailed", undefined, "en"), "Could not copy");
assert.equal(t("chat.copyFailed", undefined, "zh"), "无法复制");
assert.ok(t("share.copyFailed", undefined, "en").trim());
assert.ok(t("share.copyFailed", undefined, "zh").trim());

// Runtime: empty text fails; execCommand path works with a minimal DOM shim.
assert.equal(await copyTextToClipboard(""), false);

const calls: string[] = [];
const ta = {
  value: "",
  style: {} as Record<string, string>,
  tabIndex: 0,
  setAttribute(name: string, value: string) {
    calls.push(`setAttribute:${name}=${value}`);
  },
  focus() {
    calls.push("focus");
  },
  select() {
    calls.push("select");
  },
  setSelectionRange(start: number, end: number) {
    calls.push(`setSelectionRange:${start}:${end}`);
  },
};

(globalThis as { document?: unknown }).document = {
  createElement(tag: string) {
    assert.equal(tag, "textarea");
    return ta;
  },
  body: {
    appendChild() {
      calls.push("append");
    },
    removeChild() {
      calls.push("remove");
    },
  },
  execCommand(cmd: string) {
    calls.push(`execCommand:${cmd}`);
    return cmd === "copy";
  },
};

assert.equal(copyTextViaExecCommand("hello"), true);
assert.ok(calls.includes("select"));
assert.ok(calls.includes("setSelectionRange:0:5"));
assert.ok(calls.includes("execCommand:copy"));

assert.equal(await copyTextToClipboard("hello"), true);

console.log("[PASS] clipboard copy failure UI + execCommand fallback");
console.log("test-clipboard-copy-fallback: ok");
