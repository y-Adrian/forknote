/**
 * Post-approve: synthesize concrete tool_calls from approved plan steps
 * when the model emits none or the wrong tools.
 */
import assert from "node:assert/strict";
import {
  parseApprovedPlanStep,
  pendingCoversPlanTool,
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

const writeInline = parseApprovedPlanStep(
  'write_file(path="note.txt", content="hello\\nworld")',
);
assert.equal(writeInline?.tool, "write_file");
assert.equal(writeInline?.path, "note.txt");
assert.equal(writeInline?.content, "hello\nworld");

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

const writeFence = synthesizeToolCallsFromApprovedPlan({
  planText: [
    'Create note with write_file(path="note.txt")',
    "```",
    "Capability write OK",
    "```",
  ].join("\n"),
  steps: ['write_file(path="note.txt")'],
});
assert.equal(writeFence.length, 1);
assert.equal(writeFence[0]!.tool, "write_file");
assert.equal(writeFence[0]!.path, "note.txt");
assert.equal(writeFence[0]!.content, "Capability write OK");

const noBody = synthesizeToolCallsFromApprovedPlan({
  planText: "create something",
  steps: ['write_file(path="empty.txt")'],
});
assert.equal(noBody.length, 0);

assert.equal(
  pendingCoversPlanTool(
    [{ agent: { tool: "list_dir", path: "." } }],
    {
      tool: "search_replace",
      path: "math.js",
      old_string: "a",
      new_string: "b",
    },
  ),
  false,
);
assert.equal(
  pendingCoversPlanTool(
    [
      {
        agent: {
          tool: "search_replace",
          path: "math.js",
          old_string: "x",
          new_string: "y",
        },
      },
    ],
    {
      tool: "search_replace",
      path: "math.js",
      old_string: "a",
      new_string: "b",
    },
  ),
  true,
);

console.log("smoke-synthesize-from-approved-plan: ok");
