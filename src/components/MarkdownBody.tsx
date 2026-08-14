import type { Components, ExtraProps } from "react-markdown";
import ReactMarkdown from "react-markdown";
import { splitAdoptedSegments } from "../lib/adoptBranch";
import { useLocale } from "../lib/i18n";
import {
  forknoteUrlTransform,
  MARKDOWN_REMARK_PLUGINS,
} from "../lib/markdownRemark";
import { planMarkdownRender } from "../lib/markdownStream";
import {
  createContext,
  memo,
  useContext,
  useState,
  type AnchorHTMLAttributes,
  type HTMLAttributes,
  type ImgHTMLAttributes,
  type ReactNode,
} from "react";
import {
  copyTextToClipboard,
  type CopyTextFeedback,
} from "../lib/clipboard";
import { AdoptedClarifyCard } from "./AdoptedClarifyCard";
import { DiagramFence, isDiagramFenceClass } from "./DiagramFence";

interface Props {
  content: string;
  /** Skip adopted-note cards (used inside the card body itself). */
  skipAdoptedSplit?: boolean;
  /**
   * While the assistant reply is still streaming, render plain text (no
   * ReactMarkdown) so each token does not reparse the full answer. Full
   * remark parse runs once when streaming ends. Diagram fences still defer
   * via context when a completed body remounts with streaming leftovers.
   */
  streaming?: boolean;
}

/**
 * Streaming flag for fenced diagram code. Must live outside the per-render
 * `components` map — inline `code`/`pre` lambdas remount Mermaid/images on
 * every parent state change (header clicks, network toggle, verdicts, etc.).
 */
const MarkdownStreamingContext = createContext(false);

function languageFromClass(className?: string): string | null {
  if (!className) return null;
  const m = /(?:^|\s)language-([a-zA-Z0-9_+-]+)/.exec(className);
  return m?.[1] ?? null;
}

function FencedCodeBlock({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const { t } = useLocale();
  const [feedback, setFeedback] = useState<CopyTextFeedback>("idle");
  const text = String(children).replace(/\n$/, "");
  const lines = text.length === 0 ? [""] : text.split("\n");
  const language = languageFromClass(className);

  const copy = async () => {
    const ok = await copyTextToClipboard(text);
    setFeedback(ok ? "copied" : "failed");
    window.setTimeout(() => setFeedback("idle"), 1400);
  };

  const label =
    feedback === "copied"
      ? t("chat.copied")
      : feedback === "failed"
        ? t("chat.copyFailed")
        : t("chat.copy");

  return (
    <div className="fn-code-block">
      <div className="fn-code-toolbar">
        <span className="fn-code-lang">{language ?? "text"}</span>
        <div className="fn-code-toolbar-actions">
          <button
            type="button"
            className={`fn-code-copy${feedback === "failed" ? " is-copy-failed" : ""}`}
            onClick={() => void copy()}
            aria-label={label}
            title={label}
          >
            {label}
          </button>
        </div>
      </div>
      <div className="fn-code-body">
        <div className="fn-code-gutter" aria-hidden>
          {lines.map((_, i) => (
            <span key={i} className="fn-code-line-num">
              {i + 1}
            </span>
          ))}
        </div>
        <pre className="fn-code-pre">
          <code className={className}>{text}</code>
        </pre>
      </div>
    </div>
  );
}

/** Markdown images: stable chrome + copyable `![alt](src)` source. */
function MarkdownImage({
  src,
  alt,
  title,
}: ImgHTMLAttributes<HTMLImageElement>) {
  const { t } = useLocale();
  const [feedback, setFeedback] = useState<CopyTextFeedback>("idle");
  const [failed, setFailed] = useState(false);
  const safeSrc = typeof src === "string" ? forknoteUrlTransform(src.trim()) : "";
  const safeAlt = typeof alt === "string" ? alt : "";
  const markdown = safeSrc
    ? `![${safeAlt}](${safeSrc}${title ? ` "${String(title)}"` : ""})`
    : "";

  const copy = async () => {
    if (!markdown) return;
    const ok = await copyTextToClipboard(markdown);
    setFeedback(ok ? "copied" : "failed");
    window.setTimeout(() => setFeedback("idle"), 1400);
  };

  const copyLabel =
    feedback === "copied"
      ? t("chat.copied")
      : feedback === "failed"
        ? t("chat.copyFailed")
        : t("chat.image.copyMarkdown");

  if (!safeSrc) return null;

  return (
    <figure className="fn-md-image">
      <div className="fn-code-toolbar">
        <span className="fn-code-lang">image</span>
        <div className="fn-code-toolbar-actions">
          <a
            className="fn-code-copy"
            href={safeSrc}
            target="_blank"
            rel="noreferrer noopener"
            title={t("chat.image.open")}
          >
            {t("chat.image.open")}
          </a>
          <button
            type="button"
            className={`fn-code-copy${feedback === "failed" ? " is-copy-failed" : ""}`}
            onClick={() => void copy()}
            aria-label={copyLabel}
            title={copyLabel}
          >
            {copyLabel}
          </button>
        </div>
      </div>
      {failed ? (
        <p className="fn-md-image-failed">
          {t("chat.image.failed")}
          {safeAlt ? ` — ${safeAlt}` : ""}
        </p>
      ) : (
        <div className="fn-md-image-frame">
          <img
            src={safeSrc}
            alt={safeAlt || t("chat.image.open")}
            title={title}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
          />
        </div>
      )}
    </figure>
  );
}

/** Stable across MarkdownBody renders — identity must not change. */
function MarkdownPre({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

function MarkdownCode({
  className,
  children,
  node: _node,
  ...props
}: HTMLAttributes<HTMLElement> & ExtraProps) {
  const streaming = useContext(MarkdownStreamingContext);
  const text = String(children).replace(/\n$/, "");
  const isFenced =
    Boolean(languageFromClass(className)) || text.includes("\n");
  if (isFenced) {
    if (isDiagramFenceClass(className)) {
      return (
        <DiagramFence className={className} streaming={streaming}>
          {children}
        </DiagramFence>
      );
    }
    return <FencedCodeBlock className={className}>{children}</FencedCodeBlock>;
  }
  return (
    <code className={className} {...props}>
      {children}
    </code>
  );
}

/**
 * Keep ForkNote's conversation mounted when a reader opens a source.
 * Electron routes new-window requests to the system browser; regular browsers
 * retain the chat in the original tab.
 */
function MarkdownLink({
  href,
  children,
  node: _node,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & ExtraProps) {
  const safeHref =
    typeof href === "string" ? forknoteUrlTransform(href.trim()) : "";
  if (!safeHref) return <>{children}</>;

  const opensAwayFromDocument = !safeHref.startsWith("#");
  return (
    <a
      {...props}
      href={safeHref}
      target={opensAwayFromDocument ? "_blank" : props.target}
      rel={opensAwayFromDocument ? "noreferrer noopener" : props.rel}
    >
      {children}
    </a>
  );
}

/** Module-stable map so react-markdown never remounts fences/images on parent churn. */
const MARKDOWN_COMPONENTS: Components = {
  pre: MarkdownPre,
  img: MarkdownImage,
  code: MarkdownCode,
  a: MarkdownLink,
};

/**
 * Markdown updates in place. While `streaming`, use a lightweight plain-text
 * mount (see `planMarkdownRender`) so token deltas do not reparse the full
 * tree. When streaming ends, ReactMarkdown runs once. Completed diagram fences
 * still defer via `MarkdownStreamingContext` when needed.
 */
export const MarkdownBody = memo(function MarkdownBody({
  content,
  skipAdoptedSplit = false,
  streaming = false,
}: Props) {
  const { t } = useLocale();
  const plan = planMarkdownRender(content, streaming);
  if (plan.mode === "empty") {
    return <p className="muted">{t("chat.generating")}</p>;
  }

  if (plan.mode === "stream-plain") {
    return (
      <div
        className="fn-markdown-mount fn-markdown-streaming"
        data-fn-md-mode="stream"
      >
        {plan.text}
      </div>
    );
  }

  let markdown = plan.markdown;
  if (!skipAdoptedSplit) {
    const segments = splitAdoptedSegments(content);
    if (segments.some((s) => s.type === "adopted")) {
      return (
        <div className="fn-markdown-with-adopts">
          {segments.map((seg, i) =>
            seg.type === "adopted" ? (
              <AdoptedClarifyCard
                key={`adopt-${seg.branchId}-${i}`}
                branchId={seg.branchId}
                label={seg.label}
                storedBody={seg.body}
              />
            ) : (
              <MarkdownBody
                key={`md-${i}-${seg.text.length}`}
                content={seg.text}
                skipAdoptedSplit
                streaming={streaming}
              />
            ),
          )}
        </div>
      );
    }
    const only = segments[0];
    if (only?.type === "markdown") markdown = only.text;
  }

  return (
    <MarkdownStreamingContext.Provider value={streaming}>
      <div className="fn-markdown-mount" data-fn-md-mode="full">
        <ReactMarkdown
          remarkPlugins={MARKDOWN_REMARK_PLUGINS}
          urlTransform={forknoteUrlTransform}
          components={MARKDOWN_COMPONENTS}
        >
          {markdown}
        </ReactMarkdown>
      </div>
    </MarkdownStreamingContext.Provider>
  );
});
