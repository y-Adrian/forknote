import { spawnSync } from "node:child_process";

const tests = [
  "test-agent-plan-progress",
  "test-agent-budget",
  "test-agent-approval-budget",
  "test-model-metrics",
  "test-reflect-timeout",
  "test-jev-reflect",
  "test-agent-loop", "test-agent-diagnostics-recovery", "test-agent-max-rounds",
  "test-working-memory-inject", "test-outside-terminal-approval",
  "test-mutation-plan-tools", "test-stop-keeps-pending-plan-message",
  "test-agent-activity-by-session", "test-session-summary-jobs",
  "test-clarification-shared-memory", "test-model-routing",
];
for (const test of tests) {
  const result = spawnSync(process.execPath, ["--import", "tsx", `scripts/${test}.mts`], {
    stdio: "inherit",
    cwd: new URL("../", import.meta.url),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`Agent regression suite: ${tests.length} scripts passed`);
