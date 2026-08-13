import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
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
import {
  countRecentRejectStreak,
  recentRejectAttributions,
} from "../lib/feedback";
import type {
  Anchor,
  BranchNode,
  PointAttributionMap,
  PointDoubtMap,
  PointVerdictMap,
} from "../types";
import {
  applyBranchHighlights,
  clarifyBranchIdFromEventTarget,
  clearHighlights,
} from "../lib/domHighlight";
import { parseAnswerPoints, anchorForAnswerPoint } from "../lib/points";
import { clearSelection, getSelectionInContainer } from "../lib/selection";
import { useLocale } from "../lib/i18n";
import { useAppStore } from "../store/useAppStore";
import { FloatingAskPanel } from "./FloatingAskPanel";
import { MarkdownBody } from "./MarkdownBody";
import { PointizedAnswer } from "./PointizedAnswer";
import { SelectionToolbar } from "./SelectionToolbar";

interface Props {
  content: string;
  branches?: BranchNode[];
  onAsk: (anchor: Anchor, question: string) => Promise<void | string>;
  /** Disables selection toolbar / ask while a turn is in flight. */
  loading?: boolean;
  /**
   * Content is actively streaming into this body. Defaults to `loading` for
   * float panels that only pass loading for the active reply.
   */
  streaming?: boolean;
  disabled?: boolean;
  /** 在悬浮窗内使用 fixed 定位工具栏 */
  fixedToolbar?: boolean;
  /** 所属批注浮窗的 z-index，用于追问框/工具栏叠层 */
  overlayZBase?: number;
  onHighlightClick?: (branchId: string) => void;
  onBranchOpened?: (
    branchId: string,
    anchorRect: DOMRect,
    opts?: {
      skipEnterAnimation?: boolean;
      seedLeft?: number;
      seedTop?: number;
    },
  ) => void;
  compact?: boolean;
  className?: string;
  /** 传入后启用分点裁决 UI；值为消息 id 或分支 id */
  verdictTargetId?: string;
  pointVerdicts?: PointVerdictMap;
  pointDoubts?: PointDoubtMap;
  pointAttributions?: PointAttributionMap;
}

export function SelectableMarkdown({
  content,
  branches = [],
  onAsk,
  loading = false,
  streaming,
  disabled = false,
  fixedToolbar: _fixedToolbar = false,
  overlayZBase,
  onHighlightClick,
  onBranchOpened,
  compact = false,
  className = "",
  verdictTargetId,
  pointVerdicts,
  pointDoubts,
  pointAttributions,
}: Props) {
  const contentStreaming = streaming ?? loading;
  const setPointVerdict = useAppStore((s) => s.setPointVerdict);
  const setPointDoubt = useAppStore((s) => s.setPointDoubt);
  const setPointAttribution = useAppStore((s) => s.setPointAttribution);
  const denyPointHypothesis = useAppStore((s) => s.denyPointHypothesis);
  const archiveCurrent = useAppStore((s) => s.archiveCurrent);
  const integrating = useAppStore(
    (s) => s.loadingArchiveSessionId === s.activeSessionId,
  );
  // Select the log reference (stable until feedback changes). Deriving a fresh
  // array inside the Zustand selector caused Maximum update depth exceeded.
  const feedbackLog = useAppStore((s) => {
    const session = s.sessions.find((x) => x.id === s.activeSessionId);
    return session?.feedbackLog;
  });
  const recentAttributions = useMemo(
    () => recentRejectAttributions(feedbackLog),
    [feedbackLog],
  );
  const rejectStreak = useMemo(
    () => countRecentRejectStreak(feedbackLog),
    [feedbackLog],
  );
  /** Remount when list↔prose structure flips so react-markdown doesn't reconcile mutated trees.
   * While streaming, keep a stable key so flat→points mid-reply does not collapse layout / yank scroll. */
  const pointStructureKey = useMemo(() => {
    if (contentStreaming) return "stream";
    const parsed = parseAnswerPoints(content);
    return parsed.points.length < 2
      ? "flat"
      : `pts-${parsed.points.length}-${parsed.points.map((p) => p.index).join(".")}`;
  }, [content, contentStreaming]);
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
  const [askPlaceholder, setAskPlaceholder] = useState<string | undefined>(
    undefined,
  );
  const { t } = useLocale();

  const closePopover = useCallback(() => {
    setPopoverOpen(false);
    setQuestion("");
    setPendingAnchor(null);
    setAskAnchorRect(null);
    setAskPlaceholder(undefined);
  }, []);

  const dismissToolbar = useCallback(() => {
    setToolbar(null);
    // Keep pendingAnchor only while ask popover is open
    if (!popoverOpen) {
      setPendingAnchor(null);
    }
  }, [popoverOpen]);

  useEffect(() => {
    closePopover();
    setToolbar(null);
    clearSelection();
  }, [dismissToken, closePopover]);

  // Dismiss "Clarify this" when the user cancels the selection (click elsewhere).
  useEffect(() => {
    if (!toolbar || popoverOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target?.closest?.(".fn-selection-toolbar, .selection-toolbar")) {
        return;
      }
      dismissToolbar();
    };

    const onSelectionChange = () => {
      const el = containerRef.current;
      if (!el) return;
      // Defer: clicking the toolbar may briefly collapse selection before preventDefault.
      window.setTimeout(() => {
        if (popoverOpen) return;
        if (getSelectionInContainer(el)) return;
        const active = document.activeElement as Element | null;
        if (active?.closest?.(".fn-selection-toolbar, .selection-toolbar")) {
          return;
        }
        dismissToolbar();
      }, 0);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [toolbar, popoverOpen, dismissToolbar]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    clearHighlights(el);
    if (!content.trim()) return;
    if (branches.length === 0) return;
    // Keep reopen targets visible even while another branch is loading.
    applyBranchHighlights(el, branches);
    return () => clearHighlights(el);
  }, [content, branches, loading]);

  const handleMouseUp = useCallback(() => {
    if (disabled || loading) return;
    const el = containerRef.current;
    if (!el) return;

    const info = getSelectionInContainer(el);
    if (!info) {
      dismissToolbar();
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
  }, [disabled, dismissToolbar, loading]);

  const handleContentClick = useCallback(
    (e: MouseEvent) => {
      const branchId = clarifyBranchIdFromEventTarget(e.target);
      if (!branchId) return;
      // Don't steal clicks on verdict / clarify controls inside the point row.
      const target = e.target as HTMLElement;
      if (target.closest(".point-verdict-group, .point-hypo, .point-doubt")) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onHighlightClick?.(branchId);
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
    setAskPlaceholder(undefined);
    setPopoverOpen(true);
    setToolbar(null);
    clearSelection();
  };

  const openPointClarify = (pointIndex: number) => {
    if (disabled || loading) return;
    const anchor = anchorForAnswerPoint(content, pointIndex);
    if (!anchor) return;
    const row = containerRef.current?.querySelector(
      `[data-point-index="${pointIndex}"]`,
    ) as HTMLElement | null;
    const rect =
      row?.getBoundingClientRect() ??
      containerRef.current?.getBoundingClientRect() ??
      new DOMRect(0, 0, 0, 0);
    setPendingAnchor(anchor);
    setAskAnchorRect(rect);
    setAskPlaceholder(t("clarify.pointPlaceholder"));
    setQuestion("");
    setPopoverOpen(true);
    setToolbar(null);
    clearSelection();
  };

  const submit = async () => {
    if (!pendingAnchor || !question.trim()) return;
    const askEl = document.querySelector(
      ".float-panel-ask",
    ) as HTMLElement | null;
    const panelRect = askEl?.getBoundingClientRect() ?? askAnchorRect;
    const anchor = pendingAnchor;
    const q = question;
    // Keep ask panel up until the fork float is ready, then hand off without
    // replaying floatIn (Enter used to close ask → open fork = one blink).
    const branchId = await onAsk(anchor, q);
    if (branchId && panelRect) {
      onBranchOpened?.(branchId, panelRect, {
        skipEnterAnimation: true,
        seedLeft: panelRect.left,
        seedTop: panelRect.top,
      });
    }
    closePopover();
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
            key={pointStructureKey}
            content={content}
            verdicts={pointVerdicts}
            doubts={pointDoubts}
            attributions={pointAttributions}
            recentAttributions={recentAttributions}
            rejectStreak={rejectStreak}
            onVerdict={(idx, v) => setPointVerdict(verdictTargetId, idx, v)}
            onDoubt={(idx, doubt) => setPointDoubt(verdictTargetId, idx, doubt)}
            onConfirmHypothesis={(idx, attr) =>
              setPointAttribution(verdictTargetId, idx, attr)
            }
            onDenyHypothesis={(idx) =>
              denyPointHypothesis(verdictTargetId, idx)
            }
            onClarifyPoint={(idx) => openPointClarify(idx)}
            onIntegrateProgress={() => void archiveCurrent()}
            integrating={integrating}
            streaming={contentStreaming}
          />
        ) : (
          <MarkdownBody content={content} streaming={contentStreaming} />
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
            placeholder={askPlaceholder}
            onQuestionChange={setQuestion}
            onSubmit={submit}
            onClose={closePopover}
          />,
          document.body,
        )}
    </>
  );
}
