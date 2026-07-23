import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { NodeId } from "../types";
import {
  anchorRectBelowPanel,
  positionFloatingPanel,
} from "../lib/floatPosition";
import { getHighlightRect } from "../lib/domHighlight";
import {
  branchConversationLeaf,
  findAssistantMessageForBranch,
  findBranchInThread,
} from "../lib/thread";
import { useAppStore } from "../store/useAppStore";
import { SelectableMarkdown } from "./SelectableMarkdown";

interface Props {
  branchId: NodeId;
  anchorRect: DOMRect;
  depth?: number;
  zIndex: number;
  isTopmost?: boolean;
  onClose: () => void;
}

export function FloatingBranchDetail({
  branchId,
  anchorRect,
  depth = 0,
  zIndex,
  isTopmost = true,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const thread = useAppStore((s) => s.thread);
  const loadingBranchId = useAppStore((s) => s.loadingBranchId);
  const askBranch = useAppStore((s) => s.askBranch);
  const openBranchFloat = useAppStore((s) => s.openBranchFloat);
  const [followUp, setFollowUp] = useState("");

  const branch =
    thread && branchId ? findBranchInThread(thread, branchId) : undefined;

  const parentMessage =
    thread && branchId
      ? findAssistantMessageForBranch(thread, branchId)
      : undefined;

  const isLoadingThis = loadingBranchId === branchId;
  const hasAnswer = Boolean(branch?.assistantMessage.trim());
  const branchLoading = loadingBranchId !== null;

  useEffect(() => {
    setFollowUp("");
  }, [branchId]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    panel.style.zIndex = String(zIndex);
    const place = () =>
      positionFloatingPanel(panel, anchorRect, true, depth, zIndex);
    place();

    const ro = new ResizeObserver(place);
    ro.observe(panel);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRect, depth, zIndex, branch?.assistantMessage, branch?.children.length, loadingBranchId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [branch?.assistantMessage, loadingBranchId]);

  const openChildFloat = (childId: NodeId, rect: DOMRect) => {
    openBranchFloat(childId, rect, branchId);
  };

  const submitFollowUp = async () => {
    const trimmed = followUp.trim();
    if (!trimmed || !branch || !parentMessage || loadingBranchId) return;

    const attachTo = branchConversationLeaf(branch);
    const newId = await askBranch(
      attachTo.id,
      parentMessage.content,
      branch.anchor,
      trimmed,
    );
    setFollowUp("");
    if (newId && panelRef.current) {
      openChildFloat(newId, anchorRectBelowPanel(panelRef.current));
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submitFollowUp();
    }
  };

  const handleHighlightClick = (childId: string) => {
    const el = answerRef.current;
    const rect = el ? getHighlightRect(el, childId) : null;
    if (rect) {
      openChildFloat(childId, rect);
    }
  };

  if (!branch || !parentMessage) return null;

  const depthLabel = depth > 0 ? ` · L${depth + 1}` : "";

  return (
    <div
      ref={panelRef}
      className={`float-panel float-panel-detail float-panel-depth-${Math.min(depth, 4)}${isTopmost ? "" : " is-not-topmost"}`}
      role="dialog"
      aria-label={`Fork${depthLabel}`}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <header className="float-panel-detail-header">
        <div className="float-panel-detail-title">
          <h3>Fork{depthLabel}</h3>
          {depth > 0 && (
            <span className="float-panel-depth-badge">Nested</span>
          )}
        </div>
        <button
          type="button"
          className="ds-icon-btn"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
      </header>

      <div ref={scrollRef} className="float-panel-detail-scroll">
        <div className="quote-snippet" title={branch.anchor.quotedText}>
          {branch.anchor.quotedText}
        </div>
        <div className="float-branch-row float-branch-row-inline">
          <span className="float-branch-label">question</span>
          <p className="float-branch-text float-branch-text-wrap">
            {branch.userQuestion}
          </p>
        </div>
        <div className="float-branch-row float-branch-row-answer">
          <span className="float-branch-label">answer</span>
          <div ref={answerRef} className="float-branch-answer-scroll">
            {isLoadingThis && !hasAnswer ? (
              <p className="ds-muted">Thinking…</p>
            ) : hasAnswer ? (
              <SelectableMarkdown
                content={branch.assistantMessage}
                branches={isLoadingThis ? [] : branch.children}
                loading={branchLoading}
                disabled={branchLoading}
                fixedToolbar
                overlayZBase={zIndex}
                compact
                className="float-branch-selectable"
                verdictTargetId={branch.id}
                pointVerdicts={branch.pointVerdicts}
                pointDoubts={branch.pointDoubts}
                onAsk={(anchor, question) =>
                  askBranch(
                    branch.id,
                    parentMessage.content,
                    anchor,
                    question,
                  )
                }
                onBranchOpened={openChildFloat}
                onHighlightClick={handleHighlightClick}
              />
            ) : null}
          </div>
        </div>
      </div>

      <footer className="float-panel-detail-footer">
        <textarea
          rows={2}
          value={followUp}
          onChange={(e) => setFollowUp(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Short follow-up opens a nested fork…"
          disabled={branchLoading}
          aria-label="Follow-up"
        />
        <div className="float-panel-detail-footer-actions">
          <span className="hint">Keep it short · ⌘/Ctrl + Enter to send</span>
          <button
            type="button"
            className="btn primary"
            disabled={branchLoading || !followUp.trim()}
            onClick={() => void submitFollowUp()}
          >
            {branchLoading ? "Generating…" : "Send"}
          </button>
        </div>
      </footer>
    </div>
  );
}
