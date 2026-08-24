/**
 * Probe: streaming point answers preview without exposing `【N】` protocol markers.
 *
 * Usage: npx tsx scripts/test-stream-point-marker-preview.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripPointMarkersForPreview } from "../src/lib/points.ts";

const preview = stripPointMarkersForPreview(
  [
    "基于当前项目，建议按优先级推进：",
    "",
    "【1】优先打通显示闭环。",
    "",
    "**【2】** 固化构建配置。",
    "",
    "- 【3】拆分相机服务职责。",
  ].join("\n"),
);

assert.ok(!/^【\d+】/m.test(preview), "bare markers are hidden");
assert.ok(!/^\*\*【\d+】/m.test(preview), "bold markers are hidden");
assert.ok(!/^[-*]\s+【\d+】/m.test(preview), "list markers are hidden");
assert.match(preview, /优先打通显示闭环/);
assert.match(preview, /固化构建配置/);
assert.match(preview, /拆分相机服务职责/);

assert.equal(
  stripPointMarkersForPreview("普通正文\n\n没有分点协议。"),
  "普通正文\n\n没有分点协议。",
  "ordinary markdown stays unchanged",
);

const pointized = readFileSync("src/components/PointizedAnswer.tsx", "utf8");
assert.ok(
  /if \(streaming\)[\s\S]*stripPointMarkersForPreview/.test(pointized),
  "streaming PointizedAnswer must strip point markers before Markdown preview",
);

console.log("[PASS] stream point marker preview");
console.log("test-stream-point-marker-preview: ok");
