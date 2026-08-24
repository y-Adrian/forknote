/**
 * Probe #351: while streaming, chat markdown should render as a live preview
 * instead of leaking raw Markdown source. Heavy diagram rendering is still
 * deferred by component context.
 *
 * Usage: npx tsx scripts/test-markdown-stream-plain.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  closeUnterminatedFence,
  planMarkdownRender,
} from "../src/lib/markdownStream.ts";

const tokens = [
  "Here",
  "Here is",
  "Here is a",
  "Here is a **bold**",
  "Here is a **bold** list:\n\n1. one",
  "Here is a **bold** list:\n\n1. one\n2. two\n\n```js\nconsole.log(1)\n```",
];

for (const text of tokens) {
  const plan = planMarkdownRender(text, true);
  assert.equal(
    plan.mode,
    "stream-preview",
    `streaming token must use live preview, got ${plan.mode}`,
  );
  assert.equal(plan.markdown, text);
}

const openFence = "```ts\nconst x = 1;";
assert.equal(closeUnterminatedFence(openFence), `${openFence}\n\`\`\``);
const repairedPlan = planMarkdownRender(openFence, true);
assert.equal(repairedPlan.mode, "stream-preview");
assert.equal(repairedPlan.markdown, `${openFence}\n\`\`\``);
assert.equal(
  closeUnterminatedFence("```ts\nconst x = 1;\n```"),
  "```ts\nconst x = 1;\n```",
);

const done = planMarkdownRender(tokens[tokens.length - 1]!, false);
assert.equal(done.mode, "full");
assert.equal(done.markdown, tokens[tokens.length - 1]);

assert.equal(planMarkdownRender("", true).mode, "empty");
assert.equal(planMarkdownRender("", false).mode, "empty");

const body = readFileSync("src/components/MarkdownBody.tsx", "utf8");
assert.ok(
  body.includes("planMarkdownRender"),
  "MarkdownBody must consult the stream plan",
);
assert.ok(
  body.includes("fn-markdown-streaming") &&
    body.includes("stream-preview") &&
    body.includes("ReactMarkdown"),
  "MarkdownBody must render live Markdown preview while streaming",
);
assert.ok(
  !/if \(plan\.mode === "stream-plain"\)/.test(body),
  "streaming must not short-circuit to raw plain text",
);

const pointized = readFileSync("src/components/PointizedAnswer.tsx", "utf8");
assert.ok(
  /if \(streaming\)[\s\S]*MarkdownBody[\s\S]*streaming/.test(pointized),
  "PointizedAnswer must keep a single stream mount while tokens arrive",
);

const css = readFileSync("src/index.css", "utf8");
assert.ok(
  css.includes(".fn-markdown-streaming"),
  "stream preview mount needs explicit styling hook",
);

console.log("[PASS] streaming markdown renders as live preview");
console.log("test-markdown-stream-plain: ok");
