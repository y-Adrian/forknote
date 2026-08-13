/**
 * Probe: after-archive compress reuses the archive draft, not raw thread.
 * Usage: npx tsx scripts/test-archive-compress-reuse.mts
 */
import { formatArchiveDraftAsCompressSource } from "../src/lib/contextMemory.ts";

const results: Array<{ name: string; pass: boolean }> = [];
function ok(name: string, pass: boolean, detail = "") {
  results.push({ name, pass });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

ok("empty archive → empty source", formatArchiveDraftAsCompressSource("  ") === "");

const draft = "# 开发日志\n\n- 决策 A\n- 任务 B";
const source = formatArchiveDraftAsCompressSource(draft);
ok("includes archive body", source.includes(draft));
ok(
  "marks as archive draft not raw chat",
  /归档草稿/.test(source) && /非原始聊天/.test(source),
);
ok("does not look like raw turn dump", !/User:|Assistant:/.test(source));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
