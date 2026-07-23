import { useCallback, useMemo, useState } from "react";
import type { Anchor, BranchNode, NodeId, ThreadRoot } from "../types";
import {
  collectBranchIds,
  countBranchesInThread,
} from "../lib/branches";
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
  embedded?: boolean;
}

function topLevelBranches(thread: ThreadRoot): BranchNode[] {
  return thread.messages.flatMap((m) =>
    m.role === "assistant" ? m.children : [],
  );
}

function allBranchIds(thread: ThreadRoot): NodeId[] {
  const ids: NodeId[] = [];
  for (const m of thread.messages) {
    ids.push(...collectBranchIds(m.children));
  }
  return ids;
}

export function CommentsRail({
  thread,
  loadingBranchId,
  focusBranchId,
  onAskBranch,
  onFocus,
  embedded = false,
}: Props) {
  const branches = useMemo(() => topLevelBranches(thread), [thread]);
  const total = useMemo(() => countBranchesInThread(thread), [thread]);
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
  const collapseAll = () => setCollapsedIds(new Set(allBranchIds(thread)));

  return (
    <div className={`ds-comments-panel${embedded ? " embedded" : ""}`}>
      {!embedded && (
        <div className="comments-rail-header">
          <div className="comments-rail-title">
            <h2>Comments</h2>
            <span className="comments-count">{total}</span>
          </div>
        </div>
      )}

      {embedded && total > 0 && (
        <div className="ds-comments-toolbar">
          <button type="button" className="btn ghost sm" onClick={expandAll}>
            Expand all
          </button>
          <button type="button" className="btn ghost sm" onClick={collapseAll}>
            Collapse all
          </button>
        </div>
      )}

      {branches.length === 0 ? (
        <p className="comments-empty hint">
          Drag-select text in an answer, then click “Clarify this”.
        </p>
      ) : (
        <div className="comments-list">
          {branches.map((node, i) => (
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
    </div>
  );
}
