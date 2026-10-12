/**
 * Probe #355: agent-loop working memory must be injected into subsequent
 * model rounds (especially after failure → retry/replan).
 *
 * Usage: npx tsx scripts/test-working-memory-inject.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toToolResult } from "../src/lib/agentResult.ts";
import {
  AgentLoopController,
  buildWorkingMemoryAddendum,
  isWorkingMemoryAddendum,
  upsertWorkingMemoryAddendum,
  WORKING_MEMORY_ADDENDUM_PREFIX_EN,
} from "../src/lib/agentLoop.ts";

{
  const loop = new AgentLoopController();
  loop.enter("plan", "OLD_CONTEXT".repeat(200));
  loop.enter("reflect", "LATEST_DECISION retry corrected path");
  const memory = loop.formatWorkingMemory(100);
  assert.ok(memory.length <= 100);
  assert.match(memory, /LATEST_DECISION retry corrected path/);
  assert.equal(loop.formatWorkingMemory(0), "");
  const rolling = new AgentLoopController({ workingMemoryCompressAt: 4, workingMemoryKeepRecent: 1 });
  for (let i = 0; i < 80; i++) {
    rolling.enter("act", `batch_${i} ${"context ".repeat(10)}`);
    rolling.recordToolResults([{ tool: "read_file", result: toToolResult({ ok: true, resultText: "ok" }) }]);
  }
  assert.ok(rolling.workingMemoryDigest.includes("batch_79"));
  assert.ok(!rolling.workingMemoryDigest.includes("batch_0 "));
  console.log("[PASS] memory budgets preserve latest decisions and rolling summaries");
}

{
  const turn = readFileSync("src/lib/agentTurn.ts", "utf8");
  assert.ok(
    turn.includes("upsertWorkingMemoryAddendum"),
    "agentTurn must inject working memory on later rounds",
  );
  assert.ok(
    /if\s*\(\s*round\s*>\s*0\s*\)/.test(turn),
    "injection must target subsequent rounds only",
  );
  console.log("[PASS] agentTurn wires working-memory inject for round > 0");
}

{
  const loop = new AgentLoopController({ maxStepRetries: 2, maxReplans: 1 });
  const fail = toToolResult({
    ok: false,
    resultText: "Error: path is required",
  });

  const observed = loop.recordToolResults([
    { tool: "read_file", result: fail },
  ]);
  const decision = loop.reflect({ observed });
  assert.equal(decision, "retry");

  const addendum = buildWorkingMemoryAddendum(loop, "en");
  assert.ok(addendum);
  assert.ok(addendum!.startsWith(WORKING_MEMORY_ADDENDUM_PREFIX_EN));
  assert.match(addendum!, /\[observe\]/);
  assert.match(addendum!, /\[reflect\].*retry/);
  console.log("[PASS] formatWorkingMemory captures failure→retry continuity");
}

{
  const loop = new AgentLoopController();
  const fail = toToolResult({
    ok: false,
    resultText: "Error: path is required",
  });
  loop.reflect({
    observed: loop.recordToolResults([{ tool: "read_file", result: fail }]),
  });

  const messages: Array<{ role: string; content: string }> = [
    { role: "user", content: "read the file" },
    {
      role: "user",
      content: `${WORKING_MEMORY_ADDENDUM_PREFIX_EN}\nstale`,
    },
  ];

  const inserted = upsertWorkingMemoryAddendum(messages, loop, "en");
  assert.equal(inserted, true);
  const wm = messages.filter((m) => isWorkingMemoryAddendum(m.content));
  assert.equal(wm.length, 1, "prior working-memory addendum must be replaced");
  assert.match(wm[0]!.content, /\[reflect\]/);
  assert.doesNotMatch(wm[0]!.content, /^\[Agent working memory\]\nstale$/);
  console.log("[PASS] upsertWorkingMemoryAddendum replaces prior snapshot");
}

{
  const loop = new AgentLoopController();
  assert.equal(buildWorkingMemoryAddendum(loop, "en"), null);
  const messages: Array<{ role: string; content: string }> = [];
  assert.equal(upsertWorkingMemoryAddendum(messages, loop, "en"), false);
  assert.equal(messages.length, 0);
  console.log("[PASS] empty working memory does not inject");
}

console.log("All #355 working-memory-inject probes passed.");
