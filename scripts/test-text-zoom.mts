/**
 * Probe: text zoom clamp / step helpers.
 * Usage: npx tsx scripts/test-text-zoom.mts
 */
import {
  TEXT_ZOOM_DEFAULT,
  TEXT_ZOOM_MAX,
  TEXT_ZOOM_MIN,
  applyTextZoom,
  stepTextZoom,
} from "../src/lib/textZoom.ts";

const results: Array<{ name: string; pass: boolean }> = [];
function ok(name: string, pass: boolean) {
  results.push({ name, pass });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}`);
}

ok("apply 1.2", applyTextZoom(1.2, false) === 1.2);
ok("clamp max", applyTextZoom(9, false) === TEXT_ZOOM_MAX);
ok("clamp min", applyTextZoom(0.1, false) === TEXT_ZOOM_MIN);

applyTextZoom(1, false);
ok("step in", stepTextZoom("in") === 1.05);
ok("step out", stepTextZoom("out") === 1);
ok("step reset", stepTextZoom("reset") === TEXT_ZOOM_DEFAULT);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
