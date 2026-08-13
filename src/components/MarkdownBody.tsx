import type { Components, ExtraProps } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { splitAdoptedSegments } from "../lib/adoptBranch";
import { useLocale } from "../lib/i18n";
import { useState, type HTMLAttributes, type ReactNode } from "react";
import { AdoptedClarifyCard } from "./AdoptedClarifyCard";
import { DiagramFence, isDiagramFenceClass } from "./DiagramFence";

interface Props {
  content: string;
  /** Skip adopted-note cards (used inside the card body itself). */
  skipAdoptedSplit?: boolean;
  /**
   * While the assistant reply is still streaming, keep a stable mount key and
   * defer Mermaid render so partial fences do not thrash.
   */
  streaming?: boolean;
}

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
  const [copied, setCopied] = useState(false);
  const text = String(children).replace(/\n$/, "");
  const lines = text.length === 0 ? [""] : text.split("\n");
  const language = languageFromClass(className);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignore
    }
  };

  return (
    <div className="fn-code-block">
      <div className="fn-code-toolbar">
        <span className="fn-code-lang">{language ?? "text"}</span>
        <button
          type="button"
          className="fn-code-copy"
          onClick={() => void copy()}
          aria-label={copied ? t("chat.copied") : t("chat.copy")}
          title={copied ? t("chat.copied") : t("chat.copy")}
        >
          {copied ? t("chat.copied") : t("chat.copy")}
        </button>
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

/**
 * Prefer remounting the whole markdown tree when content changes during an
 * agent turn — except while `streaming`, where remounting every token breaks
 * Mermaid (and similar) stateful fences.
 */
export function MarkdownBody({
  content,
  skipAdoptedSplit = false,
  streaming = false,
}: Props) {
  const { t } = useLocale();
  if (!content) {
    return <p className="muted">{t("chat.generating")}</p>;
  }

  let markdown = content;
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

  const components: Components = {
    // Custom fenced UI is a <div>; unwrap the wrapping <pre> so lists /
    // point cards do not nest an extra pre around the code chrome.
    pre({ children }) {
      return <>{children}</>;
    },
    code({ className, children, node: _node, ...props }: HTMLAttributes<HTMLElement> & ExtraProps) {
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
    },
  };

  return (
    <div className="fn-markdown-mount" key={streaming ? "streaming" : markdown}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
