/**
 * Probe: diagram image copy helper + DiagramFence wiring.
 * Usage: npx tsx scripts/test-diagram-copy-image.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dataUrlToBlob } from "../src/lib/copyDiagramImage.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fenceSrc = readFileSync(join(root, "src/components/DiagramFence.tsx"), "utf8");
const helperSrc = readFileSync(join(root, "src/lib/copyDiagramImage.ts"), "utf8");
const i18nSrc = readFileSync(join(root, "src/lib/i18n.ts"), "utf8");

// --- dataUrlToBlob ---
{
  // 1x1 PNG
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const blob = dataUrlToBlob(png);
  assert.equal(blob.type, "image/png");
  assert.ok(blob.size > 0, "png blob should have bytes");
}

{
  const svg =
    "data:image/svg+xml," +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
  const blob = dataUrlToBlob(svg);
  assert.equal(blob.type, "image/svg+xml");
  assert.ok(blob.size > 0);
}

assert.throws(() => dataUrlToBlob("not-a-data-url"), /Invalid data URL/);

// --- helper API surface ---
assert.ok(/export async function svgElementToPngBlob/.test(helperSrc));
assert.ok(/export async function copyPngBlobToClipboard/.test(helperSrc));
assert.ok(/export async function copyDiagramImage/.test(helperSrc));
assert.ok(/image\/png/.test(helperSrc));
assert.ok(/ClipboardItem/.test(helperSrc));
assert.ok(/triggerBlobDownload/.test(helperSrc));

// --- DiagramFence wiring ---
assert.ok(
  /from ["']\.\.\/lib\/copyDiagramImage["']/.test(fenceSrc),
  "DiagramFence must import copyDiagramImage helper",
);
assert.ok(
  /canCopyImage/.test(fenceSrc) && /onCopyImage/.test(fenceSrc),
  "toolbar must expose copy-image controls",
);
assert.ok(
  /chat\.diagram\.copyImage/.test(fenceSrc),
  "copy image label must be wired",
);
assert.ok(
  /MermaidDiagram[\s\S]*canCopyImage/.test(fenceSrc) &&
    /PlantumlDiagram[\s\S]*canCopyImage/.test(fenceSrc),
  "both Mermaid and PlantUML successful renders expose copy image",
);
assert.ok(
  /downloadName:\s*["']mermaid-diagram\.png["']/.test(fenceSrc) &&
    /downloadName:\s*["']plantuml-diagram\.png["']/.test(fenceSrc),
  "fallback download filenames for mermaid and plantuml",
);

// --- i18n zh+en ---
for (const key of [
  "chat.diagram.copyImage",
  "chat.diagram.imageCopied",
  "chat.diagram.imageDownloaded",
  "chat.diagram.copyImageFailed",
]) {
  assert.ok(i18nSrc.includes(`"${key}"`), `missing i18n key ${key}`);
}
assert.ok(i18nSrc.includes('"Copy image"') && i18nSrc.includes('"复制图片"'));
assert.ok(i18nSrc.includes('"Image copied"') && i18nSrc.includes('"图片已复制"'));
assert.ok(
  i18nSrc.includes('"Could not copy image"') &&
    i18nSrc.includes('"无法复制图片"'),
);

console.log("test-diagram-copy-image: ok");
