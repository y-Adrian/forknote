import { useCallback, useMemo, useState } from "react";
import type { Anchor, NodeId, ThreadRoot } from "../types";
import { collectBranchIds, countBranches } from "../lib/branches";
import { CommentCard } from "./CommentCard";

interface Props {
  thread: ThreadRoot;
  loadingBranchId: NodeId | null;
  focusBranchId?: NodeId;
  onAskBranch: (
    parentId: NodeId,
    parentContent: string,
    anchor: Anchor,
    question: string,
  ) => Promise<void>;
  onFocus: (branchId: NodeId) => void;
}

export function CommentsRail({
  thread,
  loadingBranchId,
  focusBranchId,
  onAskBranch,
  onFocus,
}: Props) {
  const total = useMemo(() => countBranches(thread.children), [thread.children]);
  const [collapsedIds, setCollapsedIds] = useState<Set<NodeId>>(() => new Set());

  const isCollapsed = useCallback(
    (id: NodeId) => collapsedIds.has(id),
    [collapsedIds],
  );

  const onToggleExpand = useCallback((id: NodeId) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = () => setCollapsedIds(new Set());
  const collapseAll = () =>
    setCollapsedIds(new Set(collectBranchIds(thread.children)));

  return (
    <aside className="comments-rail" aria-label="批注">
      <div className="comments-rail-header">
        <div className="comments-rail-title">
          <h2>批注</h2>
          <span className="comments-count">{total} 条</span>
        </div>
        {total > 0 && (
          <div className="comments-rail-actions">
            <button type="button" className="btn ghost sm" onClick={expandAll}>
              全部展开
            </button>
            <button type="button" className="btn ghost sm" onClick={collapseAll}>
              全部收起
            </button>
          </div>
        )}
      </div>

      {thread.children.length === 0 ? (
        <p className="comments-empty hint">
          在左侧正文中拖选文字，点击「针对选中追问」，批注会显示在这里。
        </p>
      ) : (
        <div className="comments-list">
          {thread.children.map((node, i) => (
            <CommentCard
              key={node.id}
              node={node}
              indexLabel={String(i + 1)}
              depth={0}
              loadingBranchId={loadingBranchId}
              focusBranchId={focusBranchId}
              expanded={
                !isCollapsed(node.id) || loadingBranchId === node.id
              }
              onToggleExpand={onToggleExpand}
              onAskBranch={onAskBranch}
              onFocus={onFocus}
              isCollapsed={isCollapsed}
            />
          ))}
        </div>
      )}
    </aside>
  );
}
