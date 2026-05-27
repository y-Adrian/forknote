import type { Anchor, BranchNode, NodeId } from "../types";
import { SelectableAnswer } from "./SelectableAnswer";

interface Props {
  node: BranchNode;
  indexLabel: string;
  depth: number;
  loadingBranchId: NodeId | null;
  focusBranchId?: NodeId;
  expanded: boolean;
  onToggleExpand: (branchId: NodeId) => void;
  onAskBranch: (
    parentId: NodeId,
    parentContent: string,
    anchor: Anchor,
    question: string,
  ) => Promise<void>;
  onFocus: (branchId: NodeId) => void;
  isCollapsed: (branchId: NodeId) => boolean;
}

export function CommentCard({
  node,
  indexLabel,
  depth,
  loadingBranchId,
  focusBranchId,
  expanded,
  onToggleExpand,
  onAskBranch,
  onFocus,
  isCollapsed,
}: Props) {
  const isFocused = focusBranchId === node.id;
  const isLoading = loadingBranchId === node.id;
  const hasAnswer = Boolean(node.assistantMessage?.trim());
  const showBody = expanded || isLoading;

  const quotePreview =
    node.anchor.quotedText.length > 72
      ? `${node.anchor.quotedText.slice(0, 72)}…`
      : node.anchor.quotedText;

  return (
    <article
      className={`comment-card depth-${Math.min(depth, 3)}${isFocused ? " focused" : ""}${showBody ? " expanded" : " collapsed"}`}
      id={`branch-${node.id}`}
    >
      <div className="comment-connector" aria-hidden />

      <header
        className="comment-header"
        onClick={() => onFocus(node.id)}
      >
        <div className="comment-meta">
          <span className="comment-badge">批注 {indexLabel}</span>
          <button
            type="button"
            className="comment-toggle"
            aria-expanded={showBody}
            aria-label={showBody ? "收起回答" : "展开回答"}
            onClick={(e) => {
              e.stopPropagation();
              if (!isLoading) onToggleExpand(node.id);
            }}
          >
            <span className="comment-chevron" aria-hidden />
            {showBody ? "收起" : "展开"}
          </button>
        </div>

        <p className="comment-anchor" title={node.anchor.quotedText}>
          <mark>{quotePreview}</mark>
        </p>
        <p className="comment-question">{node.userQuestion}</p>

        {!showBody && hasAnswer && (
          <p className="comment-preview muted">
            {node.assistantMessage.replace(/\s+/g, " ").slice(0, 80)}
            {node.assistantMessage.length > 80 ? "…" : ""}
          </p>
        )}
      </header>

      {showBody && (
        <div className="comment-body">
          {hasAnswer ? (
            <SelectableAnswer
              parentId={node.id}
              parentContent={node.assistantMessage}
              content={node.assistantMessage}
              onAskBranch={onAskBranch}
              branchLoading={loadingBranchId !== null}
              compact
            />
          ) : (
            <div className="answer-body answer-body-compact">
              <p className="muted">{isLoading ? "正在生成…" : ""}</p>
            </div>
          )}

          {node.children.length > 0 && (
            <div className="comment-replies">
              {node.children.map((child, i) => (
                <CommentCard
                  key={child.id}
                  node={child}
                  indexLabel={`${indexLabel}.${i + 1}`}
                  depth={depth + 1}
                  loadingBranchId={loadingBranchId}
                  focusBranchId={focusBranchId}
                  expanded={!isCollapsed(child.id) || loadingBranchId === child.id}
                  onToggleExpand={onToggleExpand}
                  onAskBranch={onAskBranch}
                  onFocus={onFocus}
                  isCollapsed={isCollapsed}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {!showBody && node.children.length > 0 && (
        <p className="comment-nested-hint muted">
          含 {node.children.length} 条回复批注，展开后可见
        </p>
      )}
    </article>
  );
}
