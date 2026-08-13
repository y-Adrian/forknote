/**
 * Probe auto-diagnostics helpers.
 * Usage: npx tsx scripts/test-exec-feedback.mts
 */
import {
  batchNeedsAutoDiagnostics,
  formatAutoDiagnosticsFeedback,
  isCodeSourcePath,
} from "../src/lib/agentExecFeedback.ts";

const results: Array<{ name: string; pass: boolean; detail: string }> = [];
function ok(name: string, pass: boolean, detail = "") {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

ok("isCodeSourcePath ts", isCodeSourcePath("src/a.ts"));
ok("isCodeSourcePath md false", !isCodeSourcePath("README.md"));
ok(
  "batch needs diag on write_file ts",
  batchNeedsAutoDiagnostics([
    { tool: "write_file", path: "src/x.ts", ok: true },
  ]),
);
ok(
  "batch skips markdown write",
  !batchNeedsAutoDiagnostics([
    { tool: "write_file", path: "notes.md", ok: true },
  ]),
);
ok(
  "batch skips failed edit",
  !batchNeedsAutoDiagnostics([
    { tool: "search_replace", path: "src/x.ts", ok: false },
  ]),
);

const failMsg = formatAutoDiagnosticsFeedback({
  ok: false,
  output: "error TS2304: Cannot find name 'foo'.",
});
ok(
  "fail feedback mentions 自动诊断",
  failMsg.includes("自动诊断") && failMsg.includes("TS2304"),
);

const passMsg = formatAutoDiagnosticsFeedback({
  ok: true,
  output: "OK",
});
ok("pass feedback", passMsg.includes("通过"));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
