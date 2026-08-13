/**
 * Soft line breaks for lyrics / poetry in chat markdown.
 * Usage: npx tsx scripts/test-markdown-soft-breaks.mts
 */
import assert from "node:assert/strict";
import { visit } from "unist-util-visit";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { MARKDOWN_REMARK_PLUGINS } from "../src/lib/markdownRemark.ts";

const SAMPLE_LYRICS = `好的，给你写一首原创的歌词。

---

《晚风经过的街角》

主歌 A
路灯把影子拉长成河
风从巷口拐了个弯
把昨天的话揉成一枚落叶

副歌
晚风经过的街角
我把心事放轻一点说
如果灯还亮着
就再站一会儿也好

---

想调整风格都可以继续说。`;

function countBreaks(plugins: typeof MARKDOWN_REMARK_PLUGINS): number {
  const processor = unified().use(remarkParse);
  for (const plugin of plugins) {
    processor.use(plugin as never);
  }
  const tree = processor.runSync(processor.parse(SAMPLE_LYRICS));
  let breaks = 0;
  visit(tree, "break", () => {
    breaks += 1;
  });
  return breaks;
}

function stanzaChildTypes(
  plugins: typeof MARKDOWN_REMARK_PLUGINS,
): string[] | null {
  const processor = unified().use(remarkParse);
  for (const plugin of plugins) {
    processor.use(plugin as never);
  }
  const tree = processor.runSync(processor.parse(SAMPLE_LYRICS));
  let types: string[] | null = null;
  visit(tree, "paragraph", (node) => {
    if (types) return;
    const text = (node.children ?? [])
      .map((c) => (c.type === "text" ? c.value : `[${c.type}]`))
      .join("");
    if (text.includes("主歌 A") && text.includes("路灯")) {
      types = (node.children ?? []).map((c) => c.type);
    }
  });
  return types;
}

assert.ok(
  MARKDOWN_REMARK_PLUGINS.includes(remarkGfm),
  "MARKDOWN_REMARK_PLUGINS must include remark-gfm",
);
assert.ok(
  MARKDOWN_REMARK_PLUGINS.includes(remarkBreaks),
  "MARKDOWN_REMARK_PLUGINS must include remark-breaks",
);

const withBreaks = countBreaks(MARKDOWN_REMARK_PLUGINS);
assert.ok(
  withBreaks >= 4,
  `expected soft breaks for lyric lines, got ${withBreaks}`,
);

const withoutBreaks = countBreaks([remarkGfm]);
assert.equal(
  withoutBreaks,
  0,
  "GFM alone must not turn single newlines into hard breaks",
);

const types = stanzaChildTypes(MARKDOWN_REMARK_PLUGINS);
assert.ok(types, "expected a verse paragraph containing 主歌 A");
assert.ok(
  types!.includes("break"),
  `verse paragraph should interleave break nodes, got ${types!.join(",")}`,
);

// GFM table still parses (remark-breaks must not wreck pipe tables).
const tableMd = `| a | b |
| - | - |
| 1 | 2 |`;
const tableProcessor = unified().use(remarkParse);
for (const plugin of MARKDOWN_REMARK_PLUGINS) {
  tableProcessor.use(plugin as never);
}
const tableTree = tableProcessor.runSync(tableProcessor.parse(tableMd));
let sawTable = false;
visit(tableTree, "table", () => {
  sawTable = true;
});
assert.ok(sawTable, "GFM tables must still parse with remark-breaks wired");

console.log("test-markdown-soft-breaks: ok");
