import type { Components, ExtraProps } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useLocale } from "../lib/i18n";
import { useState, type HTMLAttributes, type ReactNode } from "react";

interface Props {
  content: string;
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
      <div className="fn-code-gutter" aria-hidden>
        {lines.map((_, i) => (
          <span key={i} className="fn-code-line-no">
            {i + 1}
          </span>
        ))}
      </div>
      <pre className="fn-code-pre">
        <code className={className}>{text}</code>
      </pre>
    </div>
  );
}

/**
 * Prefer remounting the whole markdown tree when content changes during an
 * agent turn. Custom fenced-code UI replaces <code> with a <div>, which can
 * desync react-markdown reconciliation on rapid Allow→status swaps.
 */
export function MarkdownBody({ content }: Props) {
  const { t } = useLocale();
  if (!content) {
    return <p className="muted">{t("chat.generating")}</p>;
  }

  const components: Components = {
    code({ className, children, node: _node, ...props }: HTMLAttributes<HTMLElement> & ExtraProps) {
      const text = String(children).replace(/\n$/, "");
      const isFenced =
        Boolean(languageFromClass(className)) || text.includes("\n");
      if (isFenced) {
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
    <div className="fn-markdown-mount" key={content}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
