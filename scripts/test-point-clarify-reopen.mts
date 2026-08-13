/**
 * Probe: point Ask anchors / highlight helpers match rendered point DOM.
 * Usage: npx tsx scripts/test-point-clarify-reopen.mts
 */
import { quotedTextForHighlight } from "../src/lib/domHighlight.ts";
import { anchorForAnswerPoint } from "../src/lib/points.ts";

const results: Array<{ name: string; pass: boolean }> = [];
function ok(name: string, pass: boolean, detail = "") {
  results.push({ name, pass });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

const content = "前言\n\n【1】Gossip 协议用于传播状态\n\n【2】SWIM 是失败检测";
const a1 = anchorForAnswerPoint(content, 1);
ok("anchor exists", Boolean(a1));
ok("pointIndex set", a1?.pointIndex === 1);
ok(
  "quotedText omits 【1】 marker",
  Boolean(a1 && !a1.quotedText.includes("【1】") && /Gossip/.test(a1.quotedText)),
  a1?.quotedText,
);
ok(
  "quoted matches point body for DOM",
  a1?.quotedText === "Gossip 协议用于传播状态",
);

ok(
  "strip helper drops marker",
  quotedTextForHighlight("【2】SWIM 是失败检测") === "SWIM 是失败检测",
);
ok(
  "strip helper leaves plain quote",
  quotedTextForHighlight("plain selection") === "plain selection",
);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
