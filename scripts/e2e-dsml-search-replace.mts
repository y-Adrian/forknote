/**
 * End-to-end: DSML parse → search_replace against a real sidecar project (#155).
 *
 * Usage:
 *   FORKNOTE_PROJECT=/tmp/forknote-cap-sandbox npx tsx scripts/e2e-dsml-search-replace.mts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  collectToolCalls,
  executeToolCall,
  parseDsmlToolCalls,
  stripToolCalls,
} from "../src/lib/agentTools.ts";

const projectRoot =
  process.env.FORKNOTE_PROJECT?.trim() || "/tmp/forknote-cap-sandbox";
const target = path.join(projectRoot, "math.js");
const baseline = "export function add(a, b) {\n  return a + b;\n}\n";
const expected = "export function add(a, b) {\n  return a + b + 1;\n}\n";

const FW = "｜";
const tag = (name: string) => `<${FW}DSML${FW}${name}>`;
const end = (name: string) => `</${FW}DSML${FW}${name}>`;
const param = (name: string, value: string) =>
  `${tag(`parameter name="${name}" string="true"`)}${value}${end("parameter")}`;

const dsmlLeak = [
  "I'll update the file now.",
  tag("tool_calls"),
  `${tag('invoke name="search_replace"')}`,
  param("path", "math.js"),
  param("old_string", "return a + b;"),
  param("new_string", "return a + b + 1;"),
  end("invoke"),
  end("tool_calls"),
].join("\n");

assert.ok(fs.existsSync(target), `missing ${target}`);
fs.writeFileSync(target, baseline, "utf8");

const calls = collectToolCalls(dsmlLeak);
assert.equal(calls.length, 1, "expected one DSML tool call");
assert.equal(calls[0]!.tool, "search_replace");
assert.equal(calls[0]!.path, "math.js");

const visible = stripToolCalls(dsmlLeak);
assert.ok(!/DSML/i.test(visible), `DSML leaked into visible text: ${visible}`);
assert.match(visible, /I'll update the file now/);

const sidecarUrl =
  process.env.SIDECAR_URL?.trim() || "http://127.0.0.1:8787";
const result = await executeToolCall(
  calls[0]!,
  sidecarUrl,
  undefined,
  projectRoot,
);
assert.equal(result.ok, true, result.resultText);
assert.equal(fs.readFileSync(target, "utf8"), expected);

console.log("e2e-dsml-search-replace: ok");
console.log(`parsed: ${JSON.stringify(parseDsmlToolCalls(dsmlLeak)[0])}`);
console.log(`sidecar result: ${result.resultText}`);
console.log(`math.js now:\n${fs.readFileSync(target, "utf8")}`);
