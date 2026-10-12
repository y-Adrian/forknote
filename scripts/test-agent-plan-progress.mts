import assert from "node:assert/strict";
import { AgentPlanProgress } from "../src/lib/agentPlanProgress.ts";
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
console.log("test-agent-plan-progress: ok");
