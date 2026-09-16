import { Suspense, lazy } from "react";
import { deferredMarkdownPreview } from "../lib/lazyMarkdown";
import type { MarkdownBodyProps } from "./MarkdownBody";

const MarkdownBody = lazy(() =>
  import("./MarkdownBody").then((mod) => ({ default: mod.MarkdownBody })),
);

function MarkdownFallback({ content }: { content: string }) {
  return (
    <div
      className="fn-markdown-mount fn-markdown-deferred"
      data-fn-md-mode="deferred"
    >
      {deferredMarkdownPreview(content)}
    </div>
  );
}

export function AsyncMarkdownBody(props: MarkdownBodyProps) {
  return (
    <Suspense fallback={<MarkdownFallback content={props.content} />}>
      <MarkdownBody {...props} />
    </Suspense>
  );
}
