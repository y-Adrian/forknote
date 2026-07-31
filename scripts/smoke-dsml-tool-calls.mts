/**
 * DeepSeek DSML tool-call parse + strip fallback (#155).
 */
import assert from "node:assert/strict";
import {
  collectToolCalls,
  parseDsmlToolCalls,
  stripToolCalls,
} from "../src/lib/agentTools.ts";

const FW = "｜"; // U+FF5C fullwidth vertical line used by DeepSeek DSML
const tag = (name: string) => `<${FW}DSML${FW}${name}>`;
const end = (name: string) => `</${FW}DSML${FW}${name}>`;

function param(name: string, value: string, isString = true): string {
  return `${tag(`parameter name="${name}" string="${isString ? "true" : "false"}"`)}${value}${end("parameter")}`;
}

const searchReplaceBlock = [
  tag("tool_calls"),
  `${tag('invoke name="search_replace"')}`,
  param("path", "math.js"),
  param("old_string", "return a + b;"),
  param("new_string", "return a * b;"),
  end("invoke"),
  end("tool_calls"),
].join("\n");

const parsed = parseDsmlToolCalls(
  `I'll edit the file.\n${searchReplaceBlock}\nDone.`,
);
assert.equal(parsed.length, 1);
assert.equal(parsed[0]!.tool, "search_replace");
assert.equal(parsed[0]!.path, "math.js");
assert.equal(parsed[0]!.old_string, "return a + b;");
assert.equal(parsed[0]!.new_string, "return a * b;");

const collected = collectToolCalls(`Plan OK.\n${searchReplaceBlock}`);
assert.equal(collected.length, 1);
assert.equal(collected[0]!.tool, "search_replace");

const stripped = stripToolCalls(
  `Editing now.\n${searchReplaceBlock}\nAll set.`,
);
assert.ok(!/DSML/i.test(stripped), stripped);
assert.match(stripped, /Editing now/);
assert.match(stripped, /All set/);

// V3.2 wrapper name + non-string JSON param
const v32 = [
  tag("function_calls"),
  `${tag('invoke name="run_terminal"')}`,
  param("command", "pwd && ls -la"),
  param("timeoutMs", "120000", false),
  end("invoke"),
  end("function_calls"),
].join("\n");
const term = parseDsmlToolCalls(v32);
assert.equal(term.length, 1);
assert.equal(term[0]!.tool, "run_terminal");
assert.equal(term[0]!.command, "pwd && ls -la");
assert.equal(term[0]!.timeoutMs, 120000);

// search_files + write_file
const multi = [
  tag("tool_calls"),
  `${tag('invoke name="search_files"')}`,
  param("path", "."),
  param("query", "math.js"),
  end("invoke"),
  `${tag('invoke name="write_file"')}`,
  param("path", "note.txt"),
  param("content", "Capability write OK"),
  end("invoke"),
  end("tool_calls"),
].join("\n");
const multiParsed = parseDsmlToolCalls(multi);
assert.equal(multiParsed.length, 2);
assert.equal(multiParsed[0]!.tool, "search_files");
assert.equal(multiParsed[0]!.query, "math.js");
assert.equal(multiParsed[1]!.tool, "write_file");
assert.equal(multiParsed[1]!.content, "Capability write OK");

// Truncated stream (no closing wrapper) still yields a usable invoke
const truncated = `${tag("tool_calls")}\n${tag('invoke name="list_dir"')}\n${param("path", ".")}`;
const truncParsed = parseDsmlToolCalls(truncated);
assert.equal(truncParsed.length, 1);
assert.equal(truncParsed[0]!.tool, "list_dir");
assert.equal(truncParsed[0]!.path, ".");
assert.equal(stripToolCalls(`Hi\n${truncated}`).trim(), "Hi");

// ASCII-pipe fallback (some proxies rewrite fullwidth)
const ascii = `<|DSML|tool_calls>
<|DSML|invoke name="mkdir">
<|DSML|parameter name="path" string="true">tmp/a</|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`;
const asciiParsed = parseDsmlToolCalls(ascii);
assert.equal(asciiParsed.length, 1);
assert.equal(asciiParsed[0]!.tool, "mkdir");
assert.equal(asciiParsed[0]!.path, "tmp/a");

// DSML in reasoning pool via collectToolCalls
const fromReasoning = collectToolCalls("ok", "", searchReplaceBlock);
assert.equal(fromReasoning[0]?.tool, "search_replace");

console.log("smoke-dsml-tool-calls: ok");
