import assert from "node:assert/strict";
import { jevEndpointFromSettings, parseJevReflectResponse } from "../src/lib/jev";
import type { ApiSettings } from "../src/types";
import { normalizeApiSettings } from "../src/lib/settings";

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
  jevEndpointFromSettings({
    jevProvider: "official",
    jevBaseUrl: "https://api.typesafe.ai",
  } as ApiSettings),
  "https://api.typesafe.ai/v1/systemone",
);
assert.equal(
  jevEndpointFromSettings({
    jevProvider: "hosted",
    jevBaseUrl: "https://jevtypesafeai.com",
  } as ApiSettings),
  "https://jevtypesafeai.com/api/v1/decide",
);
assert.equal(
  jevEndpointFromSettings({
    jevApiKey: "jv_live_test",
    jevBaseUrl: "",
  } as ApiSettings),
  "https://jevtypesafeai.com/api/v1/decide",
  "legacy settings should infer the hosted provider from its key prefix",
);
const migrated = normalizeApiSettings({
  jevApiKey: "jv_live_test",
  jevBaseUrl: "https://api.typesafe.ai",
});
assert.equal(migrated.jevProvider, "hosted");
assert.equal(migrated.jevBaseUrl, "https://jevtypesafeai.com");

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
