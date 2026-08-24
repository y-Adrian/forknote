/**
 * Probe: streaming Markdown render crashes stay local to the message, and
 * branch highlight DOM surgery is paused while content is still streaming.
 *
 * Usage: npx tsx scripts/test-stream-render-crash-guard.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const markdownBody = readFileSync("src/components/MarkdownBody.tsx", "utf8");
assert.ok(
  /class MarkdownRenderBoundary extends Component/.test(markdownBody),
  "MarkdownBody must wrap ReactMarkdown in a local error boundary",
);
assert.ok(
  /getDerivedStateFromError/.test(markdownBody),
  "Markdown render boundary catches render/commit crashes",
);
assert.ok(
  /fn-markdown-render-fallback/.test(markdownBody) &&
    /fallbackContent/.test(markdownBody),
  "Markdown render failures must fall back to source for the affected message",
);
assert.ok(
  /resetSignal=\{markdownResetSignal\(markdown, plan\.mode\)\}/.test(
    markdownBody,
  ),
  "Markdown render boundary must retry when streamed content changes",
);

const selectable = readFileSync("src/components/SelectableMarkdown.tsx", "utf8");
assert.ok(
  /clearHighlights\(el\);\s*if \(contentStreaming\) return;[\s\S]*applyBranchHighlights/.test(
    selectable,
  ),
  "branch highlight DOM rewrites must be paused while content streams",
);
assert.ok(
  /\[content, branches, loading, contentStreaming\]/.test(selectable),
  "highlight effect must resync once streaming finishes",
);

console.log("[PASS] stream render crash guard");
console.log("test-stream-render-crash-guard: ok");
