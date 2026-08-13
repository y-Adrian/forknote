import type { PluggableList } from "unified";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

/**
 * Chat markdown often uses a lone `---` as a visual separator after a short
 * intro line. CommonMark setext headings treat `text\\n---` as `<h2>`, which
 * jumps body prose to ~1.3em and looks broken next to user bubbles.
 * Keep ATX (`##`) headings; only disable setext underlines.
 */
export function remarkDisableSetext(this: {
  data: () => {
    micromarkExtensions?: Array<{ disable?: { null?: string[] } }>;
  };
}): undefined {
  const data = this.data();
  const list = data.micromarkExtensions || (data.micromarkExtensions = []);
  list.push({ disable: { null: ["setextUnderline"] } });
}

/**
 * Remark plugins for chat / archive markdown.
 *
 * `remark-breaks` turns single newlines into hard `<br>` so lyrics, poetry,
 * and other prose keep visible line breaks (CommonMark otherwise collapses
 * soft breaks to spaces). GFM tables/lists remain intact.
 */
export const MARKDOWN_REMARK_PLUGINS: PluggableList = [
  remarkDisableSetext,
  remarkGfm,
  remarkBreaks,
];
