/**
 * Inline Allow/Stop routing helpers for tool approvals.
 */
import assert from "node:assert/strict";
import {
  summarizeInlineApprovalAction,
  usesInlineToolApproval,
} from "../src/lib/agentTools.ts";

assert.equal(
  usesInlineToolApproval("run_terminal: npm test", ["run_terminal npm test"], [
    "npm test",
  ]),
  true,
);
assert.equal(
  usesInlineToolApproval(
    '## 计划\n1. write_file path="hello.py"\n',
    ['write_file path="hello.py"'],
  ),
  true,
);
assert.equal(
  usesInlineToolApproval("Just clarifying — no tools needed.", []),
  false,
);

const shell = summarizeInlineApprovalAction({
  planText: "run_terminal: npm test",
  steps: ["run_terminal npm test"],
  explicitCommands: ["npm test"],
});
assert.equal(shell.kind, "terminal");
assert.equal(shell.detail, "npm test");

const write = summarizeInlineApprovalAction({
  planText: "用 write_file 创建 hello.py，写入 hello",
  steps: ['write_file path="hello.py"'],
});
assert.equal(write.kind, "write");
assert.equal(write.detail, "hello.py");

const edit = summarizeInlineApprovalAction({
  planText: 'search_replace path="src/a.ts"',
  steps: ['search_replace path="src/a.ts"'],
});
assert.equal(edit.kind, "edit");
assert.equal(edit.detail, "src/a.ts");

console.log("smoke-inline-tool-approval: ok");
