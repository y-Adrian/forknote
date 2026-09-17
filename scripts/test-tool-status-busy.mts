/**
 * Agent turn status placeholder detection + busy-indicator wiring.
 * Usage: npx tsx scripts/test-tool-status-busy.mts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isAgentTurnPlaceholder } from "../src/lib/agentStatus.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  } else {
    console.log(`ok: ${msg}`);
  }
}

const cases: [string, boolean][] = [
  ["正在使用项目工具…", true],
  ["Using project tools…", true],
  ["Reading src/foo.ts…", true],
  ["正在读取 package.json…", true],
  ["Creating notes/a.md…", true],
  ["Thinking", true],
  ["思考中…", true],
  ["Here is the real answer.", false],
  ["", false],
  ["  ", false],
];

for (const [input, want] of cases) {
  assert(
    isAgentTurnPlaceholder(input) === want,
    `isAgentTurnPlaceholder(${JSON.stringify(input)}) === ${want}`,
  );
}

const mainMessageList = readFileSync(
  join(root, "src/components/MainChatMessageList.tsx"),
  "utf8",
);
assert(mainMessageList.includes("fn-msg-footer"), "message list renders fn-msg-footer");
assert(mainMessageList.includes("TurnBusyIndicator"), "message list mounts TurnBusyIndicator");
assert(
  mainMessageList.includes("isAgentTurnPlaceholder(msg.content)"),
  "message list gates spinner on placeholder + loading",
);
assert(mainMessageList.includes("aria-busy={"), "message list sets aria-busy on footer");

const floatPanel = readFileSync(
  join(root, "src/components/FloatingBranchDetail.tsx"),
  "utf8",
);
assert(
  floatPanel.includes("TurnBusyIndicator"),
  "FloatingBranchDetail mounts TurnBusyIndicator",
);
assert(
  floatPanel.includes("is-agent-status"),
  "FloatingBranchDetail marks busy status bubble",
);

const css = readFileSync(join(root, "src/index.css"), "utf8");
assert(css.includes(".fn-turn-busy-spinner"), "CSS defines turn busy spinner");
assert(css.includes("animation: spin"), "Spinner uses spin animation");

const indicator = readFileSync(
  join(root, "src/components/TurnBusyIndicator.tsx"),
  "utf8",
);
assert(indicator.includes('role="status"'), "TurnBusyIndicator has role=status");
assert(indicator.includes("aria-live"), "TurnBusyIndicator is polite live region");

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log("\nAll checks passed.");
