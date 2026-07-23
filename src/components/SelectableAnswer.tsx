import { useRef } from "react";
import type { Anchor, BranchNode, NodeId, PointDoubtMap, PointVerdictMap } from "../types";
import { getHighlightRect } from "../lib/domHighlight";
import { useAppStore } from "../store/useAppStore";
import { SelectableMarkdown } from "./SelectableMarkdown";

interface Props {
  parentId: NodeId;
  parentContent: string;
  content: string;
  branches?: BranchNode[];
  onAskBranch: (
    parentId: NodeId,
    parentContent: string,
    anchor: Anchor,
    question: string,
  ) => Promise<NodeId | void>;
  branchLoading: boolean;
  activeBranchId?: NodeId | null;
  onToggleBranch?: (branchId: NodeId | null) => void;
  compact?: boolean;
  pointVerdicts?: PointVerdictMap;
  pointDoubts?: PointDoubtMap;
}

export function SelectableAnswer({
  parentId,
  parentContent,
  content,
  branches = [],
  onAskBranch,
  branchLoading,
  activeBranchId: _activeBranchId = null,
  onToggleBranch = () => {},
  compact = false,
  pointVerdicts,
  pointDoubts,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const openBranchFloat = useAppStore((s) => s.openBranchFloat);
  const closeBranchFloat = useAppStore((s) => s.closeBranchFloat);
  const branchFloatStack = useAppStore((s) => s.branchFloatStack);

  const isBranchOpen = (branchId: string) =>
    branchFloatStack.some((e) => e.branchId === branchId);

  const handleHighlightClick = (branchId: string) => {
    const el = containerRef.current;
    const rect = el ? getHighlightRect(el, branchId) : null;
    if (!rect) return;

    if (isBranchOpen(branchId)) {
      closeBranchFloat(branchId);
      onToggleBranch(null);
    } else {
      openBranchFloat(branchId, rect, null);
      onToggleBranch(branchId);
    }
  };

  return (
    <div ref={containerRef}>
      <SelectableMarkdown
        content={content}
        branches={branches}
        loading={branchLoading}
        compact={compact}
        verdictTargetId={parentId}
        pointVerdicts={pointVerdicts}
        pointDoubts={pointDoubts}
        onAsk={(anchor, question) =>
          onAskBranch(parentId, parentContent, anchor, question)
        }
        onBranchOpened={(id, rect) => {
          openBranchFloat(id, rect, null);
          onToggleBranch(id);
        }}
        onHighlightClick={handleHighlightClick}
      />
    </div>
  );
}
