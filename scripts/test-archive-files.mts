/**
 * Probe: archive markdown path helpers.
 * Usage: npx tsx scripts/test-archive-files.mts
 */
import assert from "node:assert/strict";
import {
  archiveFileName,
  archiveRelativePath,
  DEFAULT_ARCHIVES_DIR,
  formatArchiveMarkdownFile,
  joinProjectPath,
  slugifyArchiveTitle,
} from "../src/lib/archiveFiles.ts";
import type { ArchiveSnapshot } from "../src/types.ts";

assert.equal(slugifyArchiveTitle("Hello World!"), "hello-world");
assert.equal(slugifyArchiveTitle("  "), "archive");

const snap: ArchiveSnapshot = {
  id: "abc12345xyz",
  createdAt: Date.parse("2026-08-14T00:00:00Z"),
  title: "Pocket build notes",
  content: "Body without heading",
  throughMessageId: "m1",
};

const name = archiveFileName(snap);
assert.ok(name.endsWith(".md"), "md extension");
assert.ok(name.includes("pocket-build-notes"), `slug in name: ${name}`);
assert.ok(name.includes("abc12345"), `id in name: ${name}`);

assert.equal(
  archiveRelativePath(snap),
  `${DEFAULT_ARCHIVES_DIR}/${name}`,
);
assert.equal(
  archiveRelativePath({ ...snap, filePath: ".forknote/archives/custom.md" }),
  ".forknote/archives/custom.md",
);

const md = formatArchiveMarkdownFile(snap);
assert.ok(md.startsWith("# Pocket build notes"), md);
assert.ok(md.includes("Body without heading"), md);

const headed = formatArchiveMarkdownFile({
  ...snap,
  content: "# Already titled\n\nok",
});
assert.ok(headed.startsWith("# Already titled"), headed);

assert.equal(
  joinProjectPath("/tmp/proj/", ".forknote/archives/a.md"),
  "/tmp/proj/.forknote/archives/a.md",
);

console.log("test-archive-files: ok");
