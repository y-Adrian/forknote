import type { PluggableList } from "unified";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

/**
 * Remark plugins for chat / archive markdown.
 *
 * `remark-breaks` turns single newlines into hard `<br>` so lyrics, poetry,
 * and other prose keep visible line breaks (CommonMark otherwise collapses
 * soft breaks to spaces). GFM tables/lists remain intact.
 */
export const MARKDOWN_REMARK_PLUGINS: PluggableList = [remarkGfm, remarkBreaks];
