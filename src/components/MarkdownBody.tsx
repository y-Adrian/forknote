import {
  createContext,
  useContext,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import type { Components, ExtraProps } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useLocale } from "../lib/i18n";

interface Props {
  content: string;
}

const InPreContext = createContext(false);

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
          {copied ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M5 12.5l4.5 4.5L19 7.5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>{t("chat.copied")}</span>
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <rect
                  x="9"
                  y="9"
                  width="11"
                  height="11"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <path
                  d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
              <span>{t("chat.copy")}</span>
            </>
          )}
        </button>
      </div>
      <div className="fn-code-body">
        <div className="fn-code-gutter" aria-hidden="true">
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

function MarkdownCode({
  className,
  children,
  node: _node,
  ...props
}: HTMLAttributes<HTMLElement> & ExtraProps) {
  const inPre = useContext(InPreContext);

  if (!inPre) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  return <FencedCodeBlock className={className}>{children}</FencedCodeBlock>;
}

const markdownComponents: Components = {
  // Mark fenced blocks so `code` can distinguish them from inline.
  pre({ children }) {
    return (
      <InPreContext.Provider value={true}>{children}</InPreContext.Provider>
    );
  },
  code: MarkdownCode,
};

export function MarkdownBody({ content }: Props) {
  const { t } = useLocale();
  if (!content) {
    return <p className="muted">{t("chat.generating")}</p>;
  }

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {content}
    </ReactMarkdown>
  );
}
