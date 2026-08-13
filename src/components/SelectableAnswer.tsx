import { useRef } from "react";
import type {
  Anchor,
  BranchNode,
  NodeId,
  PointAttributionMap,
  PointDoubtMap,
  PointVerdictMap,
} from "../types";
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
  /** Disables selection / ask while a turn is in flight. */
  branchLoading: boolean;
  /**
   * True only for the message whose content is actively streaming.
   * Must not follow unrelated branch loads — that remounted every answer.
   */
  contentStreaming?: boolean;
  activeBranchId?: NodeId | null;
  onToggleBranch?: (branchId: NodeId | null) => void;
  compact?: boolean;
  pointVerdicts?: PointVerdictMap;
  pointDoubts?: PointDoubtMap;
  pointAttributions?: PointAttributionMap;
}

export function SelectableAnswer({
  parentId,
  parentContent,
  content,
  branches = [],
  onAskBranch,
  branchLoading,
  contentStreaming = false,
  activeBranchId: _activeBranchId = null,
  onToggleBranch = () => {},
  compact = false,
  pointVerdicts,
  pointDoubts,
  pointAttributions,
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
        streaming={contentStreaming}
        compact={compact}
        verdictTargetId={parentId}
        pointVerdicts={pointVerdicts}
        pointDoubts={pointDoubts}
        pointAttributions={pointAttributions}
        onAsk={(anchor, question) =>
          onAskBranch(parentId, parentContent, anchor, question)
        }
        onBranchOpened={(id, rect, opts) => {
          openBranchFloat(id, rect, null, opts);
          onToggleBranch(id);
        }}
        onHighlightClick={handleHighlightClick}
      />
    </div>
  );
}
