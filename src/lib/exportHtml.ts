/**
 * Offline HTML note export. Renders Markdown with the same remark pipeline as
 * the chat (GFM tables, links, images, task lists, hard breaks) so exports
 * match what the user saw. Raw HTML in messages is dropped, and URLs go
 * through the chat's scheme allowlist. Loaded lazily from the export dialog
 * to keep react-dom/server out of the main bundle.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { forknoteUrlTransform, MARKDOWN_REMARK_PLUGINS } from "./markdownRemark";
import { shareHtmlDocument, type ShareHtmlLabels } from "./sessionShare";

export function markdownToSafeHtml(markdown: string): string {
  return renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        remarkPlugins: MARKDOWN_REMARK_PLUGINS,
        urlTransform: forknoteUrlTransform,
        skipHtml: true,
      },
      markdown,
    ),
  );
}

export function shareMarkdownToHtml(
  title: string,
  markdown: string,
  labels: ShareHtmlLabels,
): string {
  const body = `<article class="msg markdown-body">${markdownToSafeHtml(markdown)}</article>`;
  return shareHtmlDocument(title.trim() || "Untitled", body, labels);
}
