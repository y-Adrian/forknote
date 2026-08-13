/**
 * Static probe: Mermaid fence uses unique render ids + off-DOM host,
 * and exposes source/copy chrome (no removeChild race via stable useId).
 * Usage: npx tsx scripts/test-mermaid-diagram-fence.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { diagramKindFromLanguage } from "../src/lib/diagramFence.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fenceSrc = readFileSync(join(root, "src/components/DiagramFence.tsx"), "utf8");
const mdSrc = readFileSync(join(root, "src/components/MarkdownBody.tsx"), "utf8");
const i18nSrc = readFileSync(join(root, "src/lib/i18n.ts"), "utf8");

assert.equal(diagramKindFromLanguage("mermaid"), "mermaid");
assert.equal(diagramKindFromLanguage("plantuml"), "plantuml");

assert.ok(
  !/useId\(/.test(fenceSrc),
  "MermaidDiagram must not pin render ids with useId (causes mermaid removeChild races)",
);
assert.ok(
  /mermaid\.render\(/.test(fenceSrc) && /host/.test(fenceSrc),
  "mermaid.render must pass an off-DOM host container",
);
assert.ok(
  /data-fn-mermaid-host/.test(fenceSrc),
  "dedicated mermaid host marker required",
);
assert.ok(
  /chat\.diagram\.viewSource/.test(fenceSrc),
  "diagram source toggle must be wired",
);
assert.ok(
  /chat\.copySource/.test(fenceSrc),
  "copy source action must be wired",
);
assert.ok(
  /MarkdownImage/.test(mdSrc) && /img: MarkdownImage/.test(mdSrc),
  "markdown images must use stable MarkdownImage component ref",
);
assert.ok(
  /MARKDOWN_COMPONENTS/.test(mdSrc) &&
    /MarkdownStreamingContext/.test(mdSrc) &&
    /memo\(function MarkdownBody/.test(mdSrc),
  "MarkdownBody must use a module-stable components map + streaming context (avoids Mermaid remount jitter)",
);
assert.ok(
  !/const components: Components = \{/.test(mdSrc),
  "must not rebuild react-markdown components inline each render",
);
assert.ok(
  /memo\(function MermaidDiagram/.test(fenceSrc),
  "MermaidDiagram should be memoized",
);
assert.ok(
  /chat\.image\.copyMarkdown/.test(i18nSrc) &&
    /chat\.diagram\.viewSource/.test(i18nSrc),
  "i18n keys for diagram/image source actions",
);
assert.ok(
  /chat\.diagram\.plantumlFallback/.test(i18nSrc) &&
    /Use Mermaid fences for live diagrams/.test(i18nSrc),
  "plantuml stays source-only with mermaid guidance",
);
assert.ok(
  /kind === "mermaid"/.test(fenceSrc) && /kind === "plantuml"/.test(fenceSrc),
  "DiagramFence still branches mermaid render vs plantuml source",
);

const cssSrc = readFileSync(join(root, "src/index.css"), "utf8");
assert.ok(
  /\.fn-network-toggle\.is-on\s*\{[^}]*background:\s*var\(--ds-link/s.test(
    cssSrc,
  ),
  "network toggle ON state must use clear --ds-link blue background",
);
assert.ok(
  !/\.fn-network-toggle\.is-on\s*\{[^}]*--ds-accent/s.test(cssSrc),
  "network ON must not tint with --ds-accent (red)",
);

console.log("test-mermaid-diagram-fence: ok");
