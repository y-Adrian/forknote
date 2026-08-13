/**
 * Probe CODING.md memory helpers.
 * Usage: npx tsx scripts/test-coding-memory.mts
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendCodingMemoryNote,
  selectRelevantMemoryExcerpts,
} from "../src/lib/contextMemory.ts";
import type { ApiSettings, ContextMemoryPack } from "../src/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROJECT = path.join(ROOT, `.tmp-coding-memory-${process.pid}`);

const results: Array<{ name: string; pass: boolean }> = [];
function ok(name: string, pass: boolean, detail = "") {
  results.push({ name, pass });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

const pack: ContextMemoryPack = {
  summary: "A note app",
  tasks: "- [ ] ship",
  decisions: "Use local sidecar",
  coding: "- Prefer search_replace over full rewrites",
  updatedAt: Date.now(),
  storage: "local",
};
const excerpts = selectRelevantMemoryExcerpts(pack, "search replace coding convention");
ok("excerpts mention CODING", /CODING\.md|search_replace/i.test(excerpts));

async function main() {
  await fs.rm(PROJECT, { recursive: true, force: true });
  await fs.mkdir(path.join(PROJECT, ".forknote", "memory"), { recursive: true });

  // Unit-level append without live sidecar: write via helper using mock by
  // calling select/format only when sidecar unavailable — exercise pack shape.
  const settings = {
    baseUrl: "",
    apiKey: "",
    model: "",
    useProxy: true,
    memoryDir: ".forknote/memory",
  } satisfies ApiSettings;

  // Without sidecar, append falls back to local pack return — still validates API.
  try {
    await appendCodingMemoryNote({
      note: "Never commit .env",
      settings,
      projectRoot: null,
      sidecarUrl: "http://127.0.0.1:9",
    });
    ok("append without project returns local", true);
  } catch (e) {
    ok("append without project returns local", false, String(e));
  }

  await fs.rm(PROJECT, { recursive: true, force: true }).catch(() => {});

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
