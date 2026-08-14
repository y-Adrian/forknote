/**
 * Probe #351: while streaming, chat markdown must stay on a lightweight plain
 * mount — not reparse the full answer with ReactMarkdown on every token.
 * Full parse is reserved for the completed reply.
 *
 * Usage: npx tsx scripts/test-markdown-stream-plain.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planMarkdownRender } from "../src/lib/markdownStream.ts";

// Prove the failure mode the fix targets: a growing answer under the old
// strategy would request a full parse on every token.
const tokens = [
  "Here",
  "Here is",
  "Here is a",
  "Here is a **bold**",
  "Here is a **bold** list:\n\n1. one",
  "Here is a **bold** list:\n\n1. one\n2. two\n\n```js\nconsole.log(1)\n```",
];

let fullWhileStreaming = 0;
for (const text of tokens) {
  const plan = planMarkdownRender(text, true);
  if (plan.mode === "full") fullWhileStreaming += 1;
  assert.equal(
    plan.mode,
    "stream-plain",
    `streaming token must stay stream-plain, got ${plan.mode}`,
  );
  assert.equal(plan.text, text);
}
assert.equal(
  fullWhileStreaming,
  0,
  "streaming path must never request a full Markdown parse",
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
  body.includes("fn-markdown-streaming") || body.includes("stream-plain"),
  "MarkdownBody must render the lightweight stream mount",
);
assert.ok(
  /if \(plan\.mode === "stream-plain"\)[\s\S]*return[\s\S]*fn-markdown-streaming/.test(
    body,
  ),
  "stream-plain must short-circuit before ReactMarkdown",
);

const pointized = readFileSync("src/components/PointizedAnswer.tsx", "utf8");
assert.ok(
  /if \(streaming\)[\s\S]*MarkdownBody[\s\S]*streaming/.test(pointized),
  "PointizedAnswer must keep a single stream mount while tokens arrive",
);

const css = readFileSync("src/index.css", "utf8");
assert.ok(
  css.includes(".fn-markdown-streaming"),
  "stream mount needs pre-wrap styling",
);

console.log("[PASS] streaming markdown stays plain until completion");
console.log("test-markdown-stream-plain: ok");
