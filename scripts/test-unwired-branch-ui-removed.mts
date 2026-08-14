/**
 * Probe #373: CommentsRail, TreeSidebar, BranchPopover (and CommentCard) were
 * never imported into the product shell. Branch navigation / clarify now live
 * in BranchRail + FloatingAskPanel — remove the dead maintenance surface.
 *
 * Usage: npx tsx scripts/test-unwired-branch-ui-removed.mts
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const componentsDir = join(root, "src/components");

const removed = [
  "CommentsRail.tsx",
  "TreeSidebar.tsx",
  "BranchPopover.tsx",
  "CommentCard.tsx",
] as const;

for (const file of removed) {
  assert.equal(
    existsSync(join(componentsDir, file)),
    false,
    `${file} must be deleted (unwired dead UI)`,
  );
}

// Prove the prior failure: these symbols existed as components but had zero
// importers outside their own files.
const allSrc = readdirSync(join(root, "src"), { recursive: true })
  .map(String)
  .filter((p) => /\.(tsx?|mts|cts)$/.test(p))
  .map((p) => join(root, "src", p));

const haystack = allSrc.map((p) => readFileSync(p, "utf8")).join("\n");
for (const name of [
  "CommentsRail",
  "TreeSidebar",
  "BranchPopover",
  "CommentCard",
] as const) {
  assert.doesNotMatch(
    haystack,
    new RegExp(`\\b${name}\\b`),
    `${name} must not remain in src/`,
  );
}

// Product replacements that already wire branch / clarify UX.
assert.ok(
  existsSync(join(componentsDir, "BranchRail.tsx")),
  "BranchRail remains the branch outline",
);
assert.ok(
  existsSync(join(componentsDir, "FloatingAskPanel.tsx")),
  "FloatingAskPanel remains the clarify composer",
);
assert.ok(
  existsSync(join(componentsDir, "SelectionToolbar.tsx")),
  "SelectionToolbar remains the clarify entry point",
);

const mainPanel = readFileSync(join(componentsDir, "MainPanel.tsx"), "utf8");
assert.match(mainPanel, /BranchRail/);
assert.doesNotMatch(mainPanel, /CommentsRail|TreeSidebar|BranchPopover/);

const css = readFileSync(join(root, "src/index.css"), "utf8");
assert.doesNotMatch(css, /\.ds-comments-drawer\b/);
assert.doesNotMatch(css, /\.comment-card\b/);
assert.doesNotMatch(css, /\.ds-tree-nav\b/);
assert.doesNotMatch(css, /\.popover-backdrop\b/);
assert.doesNotMatch(css, /--ds-comment-bg\b/);

const i18n = readFileSync(join(root, "src/lib/i18n.ts"), "utf8");
assert.doesNotMatch(i18n, /"comments\.title"/);
assert.doesNotMatch(i18n, /"tree\.outline"/);
assert.doesNotMatch(i18n, /"ask\.aria"/);

console.log("ok: unwired branch UI components removed");
