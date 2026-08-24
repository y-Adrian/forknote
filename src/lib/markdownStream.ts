/**
 * Decide how chat markdown should render for a given stream state.
 *
 * While tokens are still arriving, prefer a live Markdown preview so headings,
 * emphasis, lists, and tables do not show as raw source. Repair only the common
 * incomplete constructs that can destabilize the preview; heavyweight diagram
 * rendering is still deferred by DiagramFence while `streaming` is true.
 */
export type MarkdownRenderPlan =
  | { mode: "empty" }
  | { mode: "stream-preview"; markdown: string }
  | { mode: "full"; markdown: string };

export function closeUnterminatedFence(markdown: string): string {
  const fenceRe = /(^|\n)(`{3,}|~{3,})[^\n]*(?=\n|$)/g;
  let match: RegExpExecArray | null;
  let openFence: string | null = null;
  while ((match = fenceRe.exec(markdown)) !== null) {
    const fence = match[2] ?? "";
    if (!openFence) {
      openFence = fence;
      continue;
    }
    if (fence[0] === openFence[0] && fence.length >= openFence.length) {
      openFence = null;
    }
  }
  return openFence ? `${markdown}\n${openFence}` : markdown;
}

export function repairStreamingMarkdown(content: string): string {
  return closeUnterminatedFence(content);
}

export function planMarkdownRender(
  content: string,
  streaming: boolean,
): MarkdownRenderPlan {
  if (!content) return { mode: "empty" };
  if (streaming) {
    return { mode: "stream-preview", markdown: repairStreamingMarkdown(content) };
  }
  return { mode: "full", markdown: content };
}
