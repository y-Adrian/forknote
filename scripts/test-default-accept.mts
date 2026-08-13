/**
 * Probe: unmarked points default to adopt.
 * Usage: npx tsx scripts/test-default-accept.mts
 */
import { describePointFeedbackForAgent, WEIGHT_DEFAULT_ADOPT } from "../src/lib/feedback.ts";
import {
  annotateContentWithVerdicts,
  formatCheckpointForArchive,
} from "../src/lib/points.ts";

const results: Array<{ name: string; pass: boolean }> = [];
function ok(name: string, pass: boolean, detail = "") {
  results.push({ name, pass });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

const silent = describePointFeedbackForAgent({
  index: 1,
  content: "do X",
  verdict: undefined,
});
ok("silent says 默认采纳", /默认采纳/.test(silent) && !/勿等同于主动采纳/.test(silent));
ok("silent weight equals accept", WEIGHT_DEFAULT_ADOPT === 1);

const content = "导语\n\n【1】一步\n\n【2】二步\n\n【3】三步";
const annotated = annotateContentWithVerdicts(content, { 2: "reject" });
ok("unmarked before reject is default adopt", /【1】（默认采纳/.test(annotated));
ok("reject labeled", /【2】（用户反馈·不采纳/.test(annotated));
ok("after reject truncated", /【3】（已截断/.test(annotated));

const cp = formatCheckpointForArchive(content, { 2: "reject", 1: "accept" });
ok(
  "checkpoint lists default-adopt semantics",
  Boolean(cp && /已采纳/.test(cp) && /已不采纳/.test(cp)),
  cp ?? "",
);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
