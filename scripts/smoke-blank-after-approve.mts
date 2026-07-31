/**
 * Post-approve blank-page hardening (#161): ownership guard + ErrorBoundary wiring.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const storeSrc = readFileSync(join(root, "src/store/useAppStore.ts"), "utf8");
const mainSrc = readFileSync(join(root, "src/main.tsx"), "utf8");
const boundarySrc = readFileSync(
  join(root, "src/components/AppErrorBoundary.tsx"),
  "utf8",
);

const approveBlock = storeSrc.match(
  /approveAgentPlan:\s*async\s*\(\)\s*=>\s*\{[\s\S]*?\n\s*\},\n\n\s*rejectAgentPlan/,
);
assert.ok(approveBlock, "approveAgentPlan block found");
assert.match(
  approveBlock[0]!,
  /waitingPlan/,
  "approveAgentPlan finally must keep ownership when a plan is re-presented",
);
assert.match(
  approveBlock[0]!,
  /!waitingPlan/,
  "approveAgentPlan must gate mainTurnsBySession.delete on !waitingPlan",
);

assert.match(mainSrc, /AppErrorBoundary/, "main.tsx wraps App in ErrorBoundary");
assert.match(
  boundarySrc,
  /getDerivedStateFromError/,
  "AppErrorBoundary catches render errors",
);

assert.match(
  storeSrc,
  /persistSessions failed/,
  "persistSessions catches storage write failures",
);

console.log("smoke-blank-after-approve: ok");
