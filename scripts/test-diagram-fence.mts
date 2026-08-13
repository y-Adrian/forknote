/**
 * Probe: diagram fence language detection.
 * Usage: npx tsx scripts/test-diagram-fence.mts
 */
import { diagramKindFromLanguage } from "../src/lib/diagramFence.ts";

const results: Array<{ name: string; pass: boolean }> = [];
function ok(name: string, pass: boolean) {
  results.push({ name, pass });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}`);
}

ok("mermaid", diagramKindFromLanguage("mermaid") === "mermaid");
ok("Mermaid case", diagramKindFromLanguage("Mermaid") === "mermaid");
ok("plantuml", diagramKindFromLanguage("plantuml") === "plantuml");
ok("puml alias", diagramKindFromLanguage("puml") === "plantuml");
ok("ts not diagram", diagramKindFromLanguage("ts") === null);
ok("null", diagramKindFromLanguage(null) === null);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
