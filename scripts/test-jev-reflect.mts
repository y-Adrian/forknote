import assert from "node:assert/strict";
import { parseJevReflectResponse } from "../src/lib/jev";

const allowed = ["continue", "retry", "replan"] as const;

const parsed = parseJevReflectResponse(
  {
    answers: {
      decision: {
        type: "choice",
        choice: "retry",
        confidence: 0.82,
        probabilities: { continue: 0.12, retry: 0.82, replan: 0.06 },
      },
    },
  },
  [...allowed],
);
assert.deepEqual(parsed, {
  decision: "retry",
  confidence: 0.82,
  probabilities: { continue: 0.12, retry: 0.82, replan: 0.06 },
});

assert.equal(
  parseJevReflectResponse(
    { answers: { decision: { choice: "abort", confidence: 0.99 } } },
    [...allowed],
  ),
  null,
  "decisions outside the local allow-list must be rejected",
);

assert.equal(
  parseJevReflectResponse(
    { answers: { decision: { choice: "continue", confidence: 8 } } },
    [...allowed],
  )?.confidence,
  0,
  "invalid confidence values must not pass a positive threshold",
);

console.log("[PASS] Jev Reflect responses are bounded and confidence-safe");
console.log("test-jev-reflect: ok");
