/**
 * Guard: plain-chat / plan draft must not plant a stuck "Thinking…" content placeholder.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const agentTurn = readFileSync(join(root, "src/lib/agentTurn.ts"), "utf8");
const mainPanel = readFileSync(join(root, "src/components/MainPanel.tsx"), "utf8");
const css = readFileSync(join(root, "src/index.css"), "utf8");

assert.ok(
  !/patchAssistantContent\(\s*t\(\s*"chat\.thinking"/.test(agentTurn),
  "must not set chat.thinking as assistant content placeholder",
);
assert.ok(
  /Keep content empty until real tokens arrive/.test(agentTurn),
  "plain chat documents empty-until-tokens behavior",
);

assert.ok(
  /stickToBottomRef/.test(mainPanel),
  "MainPanel uses stick-to-bottom scroll",
);
assert.ok(
  !/scrollIntoView\(\s*\{\s*behavior:\s*"smooth"\s*\}\s*\)/.test(
    mainPanel.replace(
      /mark\?\.scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/g,
      "",
    ),
  ),
  "chat list must not smooth-scrollIntoView on send/load",
);
assert.ok(/overflow-anchor:\s*none/.test(css), "chat scroll disables overflow-anchor");
assert.ok(
  !/translateY\(10px\)/.test(css.match(/@keyframes msgIn\{[\s\S]*?\}/)?.[0] ?? ""),
  "msgIn must not translateY (feels like a slide on send)",
);

console.log("smoke-send-scroll-thinking: ok");
