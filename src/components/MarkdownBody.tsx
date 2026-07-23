import {
  createContext,
  useContext,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import type { Components, ExtraProps } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  content: string;
}

const InPreContext = createContext(false);

function FencedCodeBlock({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const text = String(children).replace(/\n$/, "");
  const lines = text.length === 0 ? [""] : text.split("\n");

  return (
    <div className="fn-code-block">
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
  if (!content) {
    return <p className="muted">Generating…</p>;
  }

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {content}
    </ReactMarkdown>
  );
}
