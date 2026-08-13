import type { PluggableList } from "unified";
import { defaultUrlTransform } from "react-markdown";
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
 * Allow remote http(s) images (and safe data:image/*) while keeping
 * react-markdown's default block on javascript: and other dangerous schemes.
 */
export function forknoteUrlTransform(url: string): string {
  const value = String(url ?? "").trim();
  if (!value) return "";
  if (
    /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml|bmp|x-icon)[;,]/i.test(value)
  ) {
    return value;
  }
  return defaultUrlTransform(value);
}

/** Heuristic: URL looks like a direct image asset (for prompts / tests). */
export function looksLikeImageUrl(src: string): boolean {
  const s = String(src ?? "").trim();
  if (!s) return false;
  if (/^data:image\//i.test(s)) return true;
  try {
    const u = new URL(s, "https://example.invalid");
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return /\.(?:png|jpe?g|gif|webp|svg|bmp|ico)(?:[?#]|$)/i.test(u.pathname);
  } catch {
    return /\.(?:png|jpe?g|gif|webp|svg|bmp|ico)(?:[?#]|$)/i.test(s);
  }
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
