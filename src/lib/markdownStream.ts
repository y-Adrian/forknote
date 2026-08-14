/**
 * Decide how chat markdown should render for a given stream state.
 *
 * While tokens are still arriving, ReactMarkdown + remark would reparse the
 * entire growing string on every delta. Prefer a lightweight plain-text mount
 * during the stream, then run the full parse once when streaming ends.
 */
export type MarkdownRenderPlan =
  | { mode: "empty" }
  | { mode: "stream-plain"; text: string }
  | { mode: "full"; markdown: string };

export function planMarkdownRender(
  content: string,
  streaming: boolean,
): MarkdownRenderPlan {
  if (!content) return { mode: "empty" };
  if (streaming) return { mode: "stream-plain", text: content };
  return { mode: "full", markdown: content };
}
