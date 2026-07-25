import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { BranchReply, NodeId } from "../types";
import { positionFloatingPanel } from "../lib/floatPosition";
import { getHighlightRect } from "../lib/domHighlight";
import {
  findAssistantMessageForBranch,
  findBranchInThread,
} from "../lib/thread";
import { useAppStore } from "../store/useAppStore";
import { SelectableMarkdown } from "./SelectableMarkdown";
import { ThinkingBlock } from "./ThinkingBlock";

interface Props {
  branchId: NodeId;
  anchorRect: DOMRect;
  depth?: number;
  zIndex: number;
  isTopmost?: boolean;
  onClose: () => void;
}

function TurnBlock({
  question,
  answer,
  reasoning,
  thinkingSeconds,
  isLoading,
  showAnswerChrome,
  children,
}: {
  question: string;
  answer: string;
  reasoning?: string;
  thinkingSeconds?: number;
  isLoading: boolean;
  showAnswerChrome: boolean;
  children?: ReactNode;
}) {
  const hasAnswer = Boolean(answer.trim());
  const hasReasoning = Boolean(reasoning?.trim());

  return (
    <>
      <div className="float-branch-row float-branch-row-inline">
        <span className="float-branch-label">question</span>
        <p className="float-branch-text float-branch-text-wrap">{question}</p>
      </div>
      <div className="float-branch-row float-branch-row-answer">
        <span className="float-branch-label">
          {showAnswerChrome ? "answer" : "follow-up"}
        </span>
        <div className="float-branch-answer-scroll">
          {hasReasoning ? (
            <ThinkingBlock
              reasoning={reasoning!}
              seconds={thinkingSeconds}
              streaming={isLoading}
            />
          ) : null}
          {isLoading && !hasAnswer ? (
            <p className="ds-muted">Thinking…</p>
          ) : hasAnswer ? (
            children
          ) : null}
        </div>
      </div>
    </>
  );
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
  const loadingBranchId = useAppStore((s) =>
    s.activeSessionId
      ? s.loadingBranchBySession[s.activeSessionId] ?? null
      : null,
  );
  const askBranch = useAppStore((s) => s.askBranch);
  const continueBranch = useAppStore((s) => s.continueBranch);
  const stopGeneration = useAppStore((s) => s.stopGeneration);
  const openBranchFloat = useAppStore((s) => s.openBranchFloat);
  const [followUp, setFollowUp] = useState("");

  const branch =
    thread && branchId ? findBranchInThread(thread, branchId) : undefined;

  const parentMessage =
    thread && branchId
      ? findAssistantMessageForBranch(thread, branchId)
      : undefined;

  const isLoadingThis = loadingBranchId === branchId;
  const branchLoading = loadingBranchId !== null;
  const replies = branch?.replies ?? [];
  const lastReply: BranchReply | undefined =
    replies.length > 0 ? replies[replies.length - 1] : undefined;
  const loadingLatestReply =
    isLoadingThis && Boolean(lastReply) && !lastReply!.assistantMessage.trim();
  const loadingInitial =
    isLoadingThis && !loadingLatestReply && !branch?.assistantMessage.trim();

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
  }, [
    anchorRect,
    depth,
    zIndex,
    branch?.assistantMessage,
    branch?.reasoning,
    branch?.replies,
    branch?.children.length,
    loadingBranchId,
  ]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [
    branch?.assistantMessage,
    branch?.reasoning,
    branch?.replies,
    loadingBranchId,
  ]);

  const openChildFloat = (childId: NodeId, rect: DOMRect) => {
    openBranchFloat(childId, rect, branchId);
  };

  const submitFollowUp = async () => {
    const trimmed = followUp.trim();
    if (!trimmed || !branch || !parentMessage || loadingBranchId) return;
    if (!branch.assistantMessage.trim()) return;

    setFollowUp("");
    await continueBranch(branchId, trimmed);
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
  const settledReplies = loadingLatestReply ? replies.slice(0, -1) : replies;
  const activeReply = loadingLatestReply ? lastReply : undefined;

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

        <TurnBlock
          question={branch.userQuestion}
          answer={branch.assistantMessage}
          reasoning={branch.reasoning}
          thinkingSeconds={branch.thinkingSeconds}
          isLoading={loadingInitial}
          showAnswerChrome
        >
          <div ref={answerRef}>
            <SelectableMarkdown
              content={branch.assistantMessage}
              branches={
                isLoadingThis && !settledReplies.length ? [] : branch.children
              }
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
          </div>
        </TurnBlock>

        {settledReplies.map((reply, index) => (
          <TurnBlock
            key={`${reply.createdAt}-${index}`}
            question={reply.userQuestion}
            answer={reply.assistantMessage}
            reasoning={reply.reasoning}
            thinkingSeconds={reply.thinkingSeconds}
            isLoading={false}
            showAnswerChrome={false}
          >
            <SelectableMarkdown
              content={reply.assistantMessage}
              branches={[]}
              loading={branchLoading}
              disabled={branchLoading}
              fixedToolbar
              overlayZBase={zIndex}
              compact
              className="float-branch-selectable"
              onAsk={(anchor, question) =>
                askBranch(
                  branch.id,
                  parentMessage.content,
                  anchor,
                  question,
                )
              }
              onBranchOpened={openChildFloat}
            />
          </TurnBlock>
        ))}

        {activeReply ? (
          <TurnBlock
            question={activeReply.userQuestion}
            answer={activeReply.assistantMessage}
            reasoning={activeReply.reasoning}
            thinkingSeconds={activeReply.thinkingSeconds}
            isLoading={loadingLatestReply}
            showAnswerChrome={false}
          >
            <SelectableMarkdown
              content={activeReply.assistantMessage}
              branches={[]}
              loading={branchLoading}
              disabled={branchLoading}
              fixedToolbar
              overlayZBase={zIndex}
              compact
              className="float-branch-selectable"
              onAsk={(anchor, question) =>
                askBranch(
                  branch.id,
                  parentMessage.content,
                  anchor,
                  question,
                )
              }
              onBranchOpened={openChildFloat}
            />
          </TurnBlock>
        ) : null}
      </div>

      <footer className="float-panel-detail-footer">
        <textarea
          rows={2}
          value={followUp}
          onChange={(e) => setFollowUp(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Follow-up stays in this window…"
          disabled={branchLoading || !branch.assistantMessage.trim()}
          aria-label="Follow-up"
        />
        <div className="float-panel-detail-footer-actions">
          <span className="hint">
            Same window · Clarify this opens a new level · ⌘/Ctrl + Enter
          </span>
          {isLoadingThis ? (
            <button
              type="button"
              className="btn danger"
              onClick={() => stopGeneration()}
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="btn primary"
              disabled={
                branchLoading ||
                !followUp.trim() ||
                !branch.assistantMessage.trim()
              }
              onClick={() => void submitFollowUp()}
            >
              Send
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
