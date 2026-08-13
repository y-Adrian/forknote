/**
 * Probe agent model routing helpers.
 * Usage: npx tsx scripts/test-model-routing.mts
 */
import {
  resolveAgentModelForPhase,
  withAgentPhaseModel,
} from "../src/lib/agentModelRouting.ts";
import type { ApiSettings } from "../src/types.ts";

const results: Array<{ name: string; pass: boolean }> = [];
function ok(name: string, pass: boolean, detail = "") {
  results.push({ name, pass });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

const base = {
  baseUrl: "https://api.example",
  apiKey: "k",
  model: "default-model",
  useProxy: true,
} satisfies ApiSettings;

ok(
  "fallback to default",
  resolveAgentModelForPhase(base, "plan") === "default-model",
);

ok(
  "plan override",
  resolveAgentModelForPhase(
    { ...base, agentPlanModel: "plan-model" },
    "plan",
  ) === "plan-model",
);

ok(
  "code override leaves plan default",
  resolveAgentModelForPhase(
    { ...base, agentCodeModel: "code-model" },
    "plan",
  ) === "default-model" &&
    resolveAgentModelForPhase(
      { ...base, agentCodeModel: "code-model" },
      "code",
    ) === "code-model",
);

const routed = withAgentPhaseModel(
  { ...base, agentSummaryModel: "sum-model" },
  "summary",
);
ok("withAgentPhaseModel clones model", routed.model === "sum-model");
ok("withAgentPhaseModel keeps other fields", routed.apiKey === "k");

const same = withAgentPhaseModel(base, "code");
ok("identity when no override", same === base);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
