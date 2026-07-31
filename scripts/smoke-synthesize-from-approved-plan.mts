/**
 * Post-approve: synthesize concrete tool_calls from approved plan steps
 * when the model emits none.
 */
import assert from "node:assert/strict";
import {
  parseApprovedPlanStep,
  synthesizeToolCallsFromApprovedPlan,
} from "../src/lib/agentTools.ts";

const read = parseApprovedPlanStep(
  'read_file(path="math.js")，展示前 20 行',
);
assert.equal(read?.tool, "read_file");
assert.equal(read?.path, "math.js");

const term = parseApprovedPlanStep(
  'run_terminal(command="pwd && ls -la")',
);
assert.equal(term?.tool, "run_terminal");
assert.equal(term?.command, "pwd && ls -la");

const sr = parseApprovedPlanStep(
  'search_replace(path="math.js", old_string="return a + b + 1;", new_string="return a + b;")',
);
assert.equal(sr?.tool, "search_replace");
assert.equal(sr?.path, "math.js");
assert.equal(sr?.old_string, "return a + b + 1;");
assert.equal(sr?.new_string, "return a + b;");

const vague = parseApprovedPlanStep("Edit math.js to fix the bug");
assert.equal(vague, null);

const vagueSr = parseApprovedPlanStep('search_replace(path="math.js")');
assert.equal(vagueSr, null);

const synth = synthesizeToolCallsFromApprovedPlan({
  planText: "1. list root\n2. read math.js\n3. patch add",
  steps: [
    'list_dir(path=".")',
    'read_file(path="math.js")',
    'search_replace(path="math.js", old_string="a + b + 1", new_string="a + b")',
    "Edit README somehow",
  ],
});
assert.equal(synth.length, 3);
assert.equal(synth[0]!.tool, "list_dir");
assert.equal(synth[0]!.path, ".");
assert.equal(synth[1]!.tool, "read_file");
assert.equal(synth[1]!.path, "math.js");
assert.equal(synth[2]!.tool, "search_replace");

const shellOnly = synthesizeToolCallsFromApprovedPlan({
  planText: "run_terminal: pwd",
  steps: ["run_terminal: pwd"],
  commands: ["pwd"],
});
assert.ok(shellOnly.some((c) => c.tool === "run_terminal" && c.command === "pwd"));

console.log("smoke-synthesize-from-approved-plan: ok");
