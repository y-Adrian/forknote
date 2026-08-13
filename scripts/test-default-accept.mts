/**
 * Probe: unmarked points default to adopt; agent labels stay short / non-leaky.
 * Usage: npx tsx scripts/test-default-accept.mts
 */
import {
  describePointFeedbackForAgent,
  stripLeakedFeedbackMeta,
  WEIGHT_DEFAULT_ADOPT,
} from "../src/lib/feedback.ts";
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
ok(
  "silent has no verbose default-adopt essay",
  silent === "【1】do X" && !/权重|用户未拒绝/.test(silent),
);
ok("silent weight equals accept", WEIGHT_DEFAULT_ADOPT === 1);

const content = "导语\n\n【1】一步\n\n【2】二步\n\n【3】三步";
const annotated = annotateContentWithVerdicts(content, { 2: "reject" });
ok(
  "unmarked before reject stays bare 【N】",
  /【1】一步/.test(annotated) && !/【1】（默认采纳/.test(annotated),
);
ok("reject labeled short", /【2】（用户不采纳/.test(annotated));
ok("after reject truncated", /【3】（已截断/.test(annotated));

const leaked =
  "（默认采纳，权重 1：用户未拒绝，按已采纳处理；仅显式「不采纳」才否决）写一篇博文大纲";
ok(
  "strip removes leaked default-adopt meta",
  stripLeakedFeedbackMeta(leaked) === "写一篇博文大纲",
);

const lyricSep =
  "好的，给你写一首原创的歌词。\n\n---\n\n《晚风经过的街角》\n\n主歌 A";
ok(
  "strip preserves blank lines around thematic breaks",
  stripLeakedFeedbackMeta(lyricSep) === lyricSep,
  JSON.stringify(stripLeakedFeedbackMeta(lyricSep)),
);

const cp = formatCheckpointForArchive(content, { 2: "reject", 1: "accept" });
ok(
  "checkpoint lists default-adopt semantics",
  Boolean(cp && /已采纳/.test(cp) && /已不采纳/.test(cp)),
  cp ?? "",
);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
