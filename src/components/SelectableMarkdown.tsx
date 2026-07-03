import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  FLOAT_Z_ASK_OFFSET,
  FLOAT_Z_BASE,
  FLOAT_Z_TOOLBAR_OFFSET,
} from "../lib/branchFloat";
import type { Anchor, BranchNode, PointVerdictMap } from "../types";
import {
  applyBranchHighlights,
  clearHighlights,
} from "../lib/domHighlight";
import { clearSelection, getSelectionInContainer } from "../lib/selection";
import { useAppStore } from "../store/useAppStore";
import { FloatingAskPanel } from "./FloatingAskPanel";
import { MarkdownBody } from "./MarkdownBody";
import { PointizedAnswer } from "./PointizedAnswer";
import { SelectionToolbar } from "./SelectionToolbar";

interface Props {
  content: string;
  branches?: BranchNode[];
  onAsk: (anchor: Anchor, question: string) => Promise<void | string>;
  loading?: boolean;
  disabled?: boolean;
  /** 在悬浮窗内使用 fixed 定位工具栏 */
  fixedToolbar?: boolean;
  /** 所属批注浮窗的 z-index，用于追问框/工具栏叠层 */
  overlayZBase?: number;
  onHighlightClick?: (branchId: string) => void;
  onBranchOpened?: (branchId: string, anchorRect: DOMRect) => void;
  compact?: boolean;
  className?: string;
  /** 传入后启用分点裁决 UI；值为消息 id 或分支 id */
  verdictTargetId?: string;
  pointVerdicts?: PointVerdictMap;
}

export function SelectableMarkdown({
  content,
  branches = [],
  onAsk,
  loading = false,
  disabled = false,
  fixedToolbar = false,
  overlayZBase,
  onHighlightClick,
  onBranchOpened,
  compact = false,
  className = "",
  verdictTargetId,
  pointVerdicts,
}: Props) {
  const setPointVerdict = useAppStore((s) => s.setPointVerdict);
  const stackTopZ = useAppStore((s) =>
    s.branchFloatStack.length > 0
      ? Math.max(...s.branchFloatStack.map((e) => e.zIndex))
      : FLOAT_Z_BASE,
  );
  const dismissToken = useAppStore((s) => s.floatOverlayDismissToken);

  const ownerZ = overlayZBase ?? stackTopZ;
  const toolbarZ = ownerZ + FLOAT_Z_TOOLBAR_OFFSET;
  const askZ = ownerZ + FLOAT_Z_ASK_OFFSET;

  const containerRef = useRef<HTMLDivElement>(null);
  const [toolbar, setToolbar] = useState<{ top: number; left: number } | null>(
    null,
  );
  const [pendingAnchor, setPendingAnchor] = useState<Anchor | null>(null);
  const [askAnchorRect, setAskAnchorRect] = useState<DOMRect | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [question, setQuestion] = useState("");

  const closePopover = useCallback(() => {
    setPopoverOpen(false);
    setQuestion("");
    setPendingAnchor(null);
    setAskAnchorRect(null);
  }, []);

  useEffect(() => {
    closePopover();
    setToolbar(null);
    clearSelection();
  }, [dismissToken, closePopover]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || !content.trim() || loading) return;
    applyBranchHighlights(el, branches);
    return () => clearHighlights(el);
  }, [content, branches, loading]);

  const handleMouseUp = useCallback(() => {
    if (disabled || loading) return;
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

    const centerX = info.rect.left + info.rect.width / 2;
    // Always use viewport coords — toolbar is always portaled as position:fixed
    setToolbar({ top: info.rect.bottom + 4, left: centerX });
  }, [disabled, fixedToolbar, loading]);

  const handleContentClick = useCallback(
    (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const mark = target.closest("mark.branch-highlight") as HTMLElement | null;
      if (!mark?.dataset.branchId) return;
      e.preventDefault();
      e.stopPropagation();
      onHighlightClick?.(mark.dataset.branchId);
    },
    [onHighlightClick],
  );

  const openPopover = () => {
    if (!pendingAnchor) return;
    const sel = window.getSelection();
    const rect =
      sel && sel.rangeCount > 0
        ? sel.getRangeAt(0).getBoundingClientRect()
        : containerRef.current?.getBoundingClientRect() ?? new DOMRect(0, 0, 0, 0);

    setAskAnchorRect(rect);
    setPopoverOpen(true);
    setToolbar(null);
    clearSelection();
  };

  const submit = async () => {
    if (!pendingAnchor || !question.trim()) return;
    const rect = askAnchorRect;
    const anchor = pendingAnchor;
    const q = question;
    closePopover();
    const branchId = await onAsk(anchor, q);
    if (branchId && rect) {
      requestAnimationFrame(() => {
        onBranchOpened?.(branchId, rect);
      });
    }
  };

  return (
    <>
      <div
        ref={containerRef}
        className={`answer-body selectable${compact ? " answer-body-compact" : ""}${className ? ` ${className}` : ""}`}
        onMouseUp={handleMouseUp}
        onClick={handleContentClick}
      >
        {verdictTargetId ? (
          <PointizedAnswer
            content={content}
            verdicts={pointVerdicts}
            onVerdict={(idx, v) => setPointVerdict(verdictTargetId, idx, v)}
          />
        ) : (
          <MarkdownBody content={content} />
        )}
      </div>

      {toolbar &&
        createPortal(
          <SelectionToolbar
            fixed
            top={toolbar.top}
            left={toolbar.left}
            zIndex={toolbarZ}
            onAsk={openPopover}
          />,
          document.body,
        )}

      {popoverOpen &&
        pendingAnchor &&
        askAnchorRect &&
        createPortal(
          <FloatingAskPanel
            quotedText={pendingAnchor.quotedText}
            question={question}
            loading={loading}
            anchorRect={askAnchorRect}
            zIndex={askZ}
            onQuestionChange={setQuestion}
            onSubmit={submit}
            onClose={closePopover}
          />,
          document.body,
        )}
    </>
  );
}
