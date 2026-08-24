/**
 * Probe: project learning pack generates a deterministic PROJECT.md and is
 * eligible for memory injection.
 *
 * Usage: npx tsx scripts/test-project-learning-pack.mts
 */
import assert from "node:assert/strict";
import { buildProjectLearningMarkdown } from "../src/lib/projectLearning.ts";
import {
  formatLocalMemoryAddendum,
  selectCoreMemoryExcerpts,
} from "../src/lib/contextMemory.ts";
import type { ContextMemoryPack } from "../src/types.ts";

const markdown = buildProjectLearningMarkdown({
  rootName: "sample-app",
  generatedAt: Date.parse("2026-08-24T00:00:00.000Z"),
  rootEntries: [
    { name: "src", type: "dir", path: "src" },
    { name: "electron", type: "dir", path: "electron" },
    { name: "package.json", type: "file", path: "package.json" },
  ],
  dirEntries: {
    src: [
      { name: "main.tsx", type: "file", path: "src/main.tsx" },
      { name: "App.tsx", type: "file", path: "src/App.tsx" },
    ],
    electron: [
      { name: "main.cjs", type: "file", path: "electron/main.cjs" },
    ],
  },
  fileExcerpts: {
    "package.json": JSON.stringify({
      main: "electron/main.cjs",
      dependencies: { react: "^19.1.0", zustand: "^5.0.5" },
      devDependencies: { vite: "^6.3.5", electron: "^37.10.3" },
    }),
    "src/main.tsx": "import React from 'react';",
    "electron/main.cjs": "const { app } = require('electron');",
  },
});

assert.match(markdown, /# Project Learning Pack/);
assert.match(markdown, /React \^19\.1\.0/);
assert.match(markdown, /Electron \^37\.10\.3/);
assert.match(markdown, /- src\/main\.tsx/);
assert.match(markdown, /- electron\/main\.cjs/);
assert.match(markdown, /## Root Layout/);

const pack: ContextMemoryPack = {
  project: markdown,
  summary: "",
  tasks: "",
  decisions: "## Architecture\n- Keep project learning deterministic.",
  coding: "- Prefer search_replace for small edits.",
  updatedAt: Date.now(),
  storage: "project",
  dir: ".forknote/memory",
};
const core = selectCoreMemoryExcerpts(pack);
assert.ok(core.includes("PROJECT.md"));
assert.ok(core.includes("CODING.md"));
assert.ok(core.includes("DECISIONS.md"));

const injected = formatLocalMemoryAddendum(pack, "src main tsx entrypoints");
assert.ok(injected?.includes("PROJECT.md"));
assert.ok(injected?.includes("Entrypoints"));
assert.ok(injected?.includes("src/main.tsx"));

const unrelated = formatLocalMemoryAddendum(pack, "totally unrelated words");
assert.ok(unrelated?.includes("Keep project learning deterministic"));
assert.ok(unrelated?.includes("Prefer search_replace"));

console.log("[PASS] project learning pack");
console.log("test-project-learning-pack: ok");
