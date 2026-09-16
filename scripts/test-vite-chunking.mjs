/**
 * Probe: production builds should keep heavy third-party dependencies in stable
 * vendor chunks so the app entry remains smaller and more cacheable.
 *
 * Usage: node scripts/test-vite-chunking.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const config = fs.readFileSync(path.join(ROOT, "vite.config.ts"), "utf8");

const required = [
  "manualChunks",
  "vendor-react",
  "vendor-state",
  "vendor-markdown",
];

for (const token of required) {
  assert.ok(config.includes(token), `vite config should include ${token}`);
}

const asyncMarkdown = fs.readFileSync(
  path.join(ROOT, "src/components/AsyncMarkdownBody.tsx"),
  "utf8",
);
assert.match(asyncMarkdown, /lazy\(\(\) =>\s*import\("\.\/MarkdownBody"\)/);

const app = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
for (const component of [
  "ArchivePanel",
  "ProjectPanel",
  "SettingsPanel",
  "ShareViewer",
]) {
  assert.match(
    app,
    new RegExp(`const ${component} = lazy\\(\\(\\) =>\\s*import`),
    `App should lazy-load ${component}`,
  );
}
assert.match(app, /settingsOpen \? \(\s*<SettingsPanel/);
assert.match(app, /projectOpen \? \(\s*<ProjectPanel/);
assert.match(app, /archivePanelOpen \? <ArchivePanel \/> : null/);

console.log("test-vite-chunking: ok");
