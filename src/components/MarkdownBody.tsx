import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  content: string;
}

export function MarkdownBody({ content }: Props) {
  if (!content) {
    return <p className="muted">正在生成…</p>;
  }

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
  );
}
