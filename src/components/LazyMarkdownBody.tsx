import { useEffect, useRef, useState } from "react";
import {
  deferredMarkdownPreview,
  shouldMountHeavyMarkdown,
} from "../lib/lazyMarkdown";
import { MarkdownBody } from "./MarkdownBody";

interface Props {
  content: string;
  streaming?: boolean;
  /** Expand the viewport so near-fold points warm before scroll. */
  rootMargin?: string;
}

/**
 * Defer ReactMarkdown + diagram fences until the block is near the viewport.
 * Point verdict anchors live on the outer row — not inside this mount.
 */
export function LazyMarkdownBody({
  content,
  streaming = false,
  rootMargin = "240px 0px",
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    const el = hostRef.current;
    if (!el) return;

    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { root: null, rootMargin, threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, rootMargin]);

  const mountHeavy = shouldMountHeavyMarkdown({ visible, force: streaming });

  return (
    <div ref={hostRef} className="fn-lazy-md">
      {mountHeavy ? (
        <MarkdownBody content={content} streaming={streaming} />
      ) : (
        <div
          className="fn-markdown-mount fn-markdown-deferred"
          data-fn-md-mode="deferred"
        >
          {deferredMarkdownPreview(content)}
        </div>
      )}
    </div>
  );
}
