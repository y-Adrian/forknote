import { useCallback, useRef, useState } from "react";
import type { Anchor, NodeId } from "../types";
import { clearSelection, getSelectionInContainer } from "../lib/selection";
import { BranchPopover } from "./BranchPopover";
import { MarkdownBody } from "./MarkdownBody";
import { SelectionToolbar } from "./SelectionToolbar";

interface Props {
  parentId: NodeId;
  parentContent: string;
  content: string;
  onAskBranch: (
    parentId: NodeId,
    parentContent: string,
    anchor: Anchor,
    question: string,
  ) => Promise<void>;
  branchLoading: boolean;
  focusId?: NodeId;
  /** 批注栏内使用更紧凑的正文样式 */
  compact?: boolean;
}

export function SelectableAnswer({
  parentId,
  parentContent,
  content,
  onAskBranch,
  branchLoading,
  focusId,
  compact = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [toolbar, setToolbar] = useState<{ top: number; left: number } | null>(
    null,
  );
  const [pendingAnchor, setPendingAnchor] = useState<Anchor | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [question, setQuestion] = useState("");

  const handleMouseUp = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    const info = getSelectionInContainer(el);
    if (!info) {
      setToolbar(null);
      return;
    }

    setPendingAnchor({
      startOffset: info.startOffset,
      endOffset: info.endOffset,
      quotedText: info.quotedText,
    });
    setToolbar({
      top: info.rect.bottom + window.scrollY + 8,
      left: info.rect.left + window.scrollX,
    });
  }, []);

  const openPopover = () => {
    if (!pendingAnchor) return;
    setPopoverOpen(true);
    setToolbar(null);
    clearSelection();
  };

  const closePopover = () => {
    setPopoverOpen(false);
    setQuestion("");
    setPendingAnchor(null);
  };

  const submit = async () => {
    if (!pendingAnchor || !question.trim()) return;
    await onAskBranch(parentId, parentContent, pendingAnchor, question);
    closePopover();
  };

  return (
    <>
      <div
        ref={containerRef}
        className={`answer-body selectable${compact ? " answer-body-compact" : ""}${focusId ? " is-focus" : ""}`}
        data-answer-id={parentId}
        onMouseUp={handleMouseUp}
      >
        <MarkdownBody content={content} />
      </div>

      {toolbar && (
        <SelectionToolbar
          top={toolbar.top}
          left={toolbar.left}
          onAsk={openPopover}
        />
      )}

      {popoverOpen && pendingAnchor && (
        <BranchPopover
          quotedText={pendingAnchor.quotedText}
          question={question}
          loading={branchLoading}
          onQuestionChange={setQuestion}
          onSubmit={submit}
          onClose={closePopover}
        />
      )}
    </>
  );
}
