import assert from "node:assert/strict";
import { AgentPlanProgress } from "../src/lib/agentPlanProgress.ts";
import { formatTodos, parseTodos, summarizeTodos } from "../src/lib/agentTodos.ts";
import { agentCallFromOpenAI, executeToolCall, isReadOnlyAgentTool } from "../src/lib/agentTools.ts";
const p = new AgentPlanProgress([
  'read_file(path="a.ts") expected: read A',
  'read_file(path="b.ts") expected: read B',
], "/project");
p.record({ tool: "read_file", path: "a.ts" }, true);
assert.equal(p.complete, false);
assert.equal(p.expectedFor([{ tool: "read_file", path: "b.ts" }]), "read B");
p.record({ tool: "read_file", path: "other.ts" }, true);
assert.equal(p.complete, false);
p.record({ tool: "read_file", path: "b.ts" }, false);
assert.equal(p.complete, false);
p.record({ tool: "read_file", path: "/project/b.ts" }, true);
assert.equal(p.complete, true);
const duplicate = new AgentPlanProgress(['read_file: a.ts', 'read_file: a.ts'], "/project");
duplicate.record({ tool: "read_file", path: "a.ts" }, true);
assert.equal(duplicate.complete, false);
const vague = new AgentPlanProgress(["Review all changes"], "/project");
vague.record({ tool: "read_file", path: "a.ts" }, true);
assert.equal(vague.complete, false);
// update_todos completes steps that have no parseable tool call…
const mixed = new AgentPlanProgress(["Review all changes", 'read_file(path="a.ts")'], "/project");
mixed.applyTodos([
  { content: "Review all changes", status: "completed" },
  { content: "Read a.ts", status: "completed" },
]);
assert.deepEqual(mixed.remaining, ['read_file(path="a.ts")'], "concrete steps still need evidence");
mixed.record({ tool: "read_file", path: "a.ts" }, true);
assert.equal(mixed.complete, true);
// …matched by text when the todo list does not mirror the plan.
const byText = new AgentPlanProgress(["1. Review all changes", "2. Summarize risks"], "/project");
byText.applyTodos([
  { content: "Summarize risks", status: "completed" },
  { content: "extra", status: "pending" },
  { content: "review ALL changes", status: "in_progress" },
]);
assert.deepEqual(byText.remaining, ["1. Review all changes"]);

const parsed = parseTodos([{ content: " a ", status: "completed" }, { content: "b", status: "IN_PROGRESS" }, { content: "c" }]);
assert.ok(Array.isArray(parsed));
assert.equal(formatTodos(parsed), "[x] a\n[>] b\n[ ] c");
assert.equal(summarizeTodos(parsed), "Todos 1/3 · b");
assert.equal(typeof parseTodos([{ content: "", status: "pending" }]), "string");
assert.equal(typeof parseTodos([{ content: "x", status: "done" }]), "string");
assert.equal(typeof parseTodos("nope"), "string");
const call = agentCallFromOpenAI({
  id: "t1", type: "function",
  function: { name: "update_todos", arguments: JSON.stringify({ todos: [{ content: "a", status: "pending" }] }) },
});
assert.equal(call?.tool, "update_todos");
assert.equal(isReadOnlyAgentTool("update_todos"), true);
const ok = await executeToolCall(call!, "http://unused", undefined, "/project");
assert.equal(ok.ok, true);
assert.match(ok.resultText, /\[ \] a/);
const bad = await executeToolCall({ tool: "update_todos", todos: 3 }, "http://unused", undefined, "/project");
assert.equal(bad.ok, false);
console.log("test-agent-plan-progress: ok");
