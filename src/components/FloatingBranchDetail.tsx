import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { BranchReply, NodeId } from "../types";
import { handleComposerEnterKey } from "../lib/composerKeys";
import { getHighlightRect } from "../lib/domHighlight";
import { useLocale } from "../lib/i18n";
import { branchReplyVerdictTargetId } from "../lib/points";
import {
  findAssistantMessageForBranch,
  findBranchInThread,
} from "../lib/thread";
import { useDraggableFloat } from "../lib/useDraggableFloat";
import { useAppStore } from "../store/useAppStore";
import { AgentPlanReview } from "./AgentPlanReview";
import {
  InlineToolApproval,
  usePendingInlineApproval,
} from "./InlineToolApproval";
import { SelectableMarkdown } from "./SelectableMarkdown";
import { ThinkingBlock } from "./ThinkingBlock";

interface Props {
  branchId: NodeId;
  anchorRect: DOMRect;
  depth?: number;
  zIndex: number;
  isTopmost?: boolean;
  skipEnterAnimation?: boolean;
  seedLeft?: number;
  seedTop?: number;
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
  /** Initial clarify turn vs nested same-window follow-up (visual separator only). */
  showAnswerChrome: boolean;
  children?: ReactNode;
}) {
  const { t } = useLocale();
  const questionText = question.trim();
  const hasAnswer = Boolean(answer.trim());
  const hasReasoning = Boolean(reasoning?.trim());
  const isFollowUp = !showAnswerChrome;
  const showAssistant = hasReasoning || hasAnswer || isLoading;

  return (
    <div
      className={
        isFollowUp
          ? "float-branch-turn float-branch-turn-nested"
          : "float-branch-turn"
      }
    >
      {questionText ? (
        <div className="fn-msg fn-msg-user float-branch-msg">
          <div className="ds-bubble ds-bubble-user">
            <p>{questionText}</p>
          </div>
        </div>
      ) : null}
      {showAssistant ? (
        <div className="fn-msg fn-msg-assistant float-branch-msg">
          {hasReasoning ? (
            <ThinkingBlock
              reasoning={reasoning!}
              seconds={thinkingSeconds}
              streaming={isLoading}
            />
          ) : null}
          {isLoading && !hasAnswer ? (
            !hasReasoning ? (
              <div className="ds-typing" aria-label={t("chat.thinking")}>
                <span />
                <span />
                <span />
              </div>
            ) : (
              <p className="ds-muted">{t("chat.thinking")}</p>
            )
          ) : hasAnswer ? (
            <div className="ds-bubble ds-bubble-assistant">{children}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function FloatingBranchDetail({
  branchId,
  anchorRect,
  depth = 0,
  zIndex,
  isTopmost = true,
  skipEnterAnimation = false,
  seedLeft,
  seedTop,
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
  const pendingPlanForThis = useAppStore((s) => {
    const plan = s.agentPendingPlan;
    if (!plan || plan.sessionId !== s.activeSessionId) return false;
    return plan.branchId === branchId;
  });
  const { pending: pendingInline } = usePendingInlineApproval({
    kind: "branch",
    branchId,
  });
  const [followUp, setFollowUp] = useState("");
  const composingRef = useRef(false);
  const { t } = useLocale();

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

  const layoutToken = [
    branch?.assistantMessage?.length ?? 0,
    branch?.reasoning?.length ?? 0,
    branch?.replies?.length ?? 0,
    branch?.children.length ?? 0,
    loadingBranchId ?? "",
    pendingPlanForThis ? "plan" : "",
    pendingInline ? "inline" : "",
  ].join(":");

  const { onDragHandlePointerDown, onResizeHandlePointerDown } =
    useDraggableFloat(panelRef, {
    anchorRect,
    preferBelow: true,
    depth,
    zIndex,
    layoutToken,
    resetKey: branchId,
    skipEnterAnimation,
    seedLeft,
    seedTop,
    resizable: true,
  });

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
    handleComposerEnterKey(e, {
      composing: composingRef.current,
      canSubmit:
        !loadingBranchId &&
        Boolean(followUp.trim()) &&
        Boolean(branch?.assistantMessage.trim()),
      onSubmit: () => {
        void submitFollowUp();
      },
    });
  };

  const handleHighlightClick = (childId: string) => {
    const el = answerRef.current;
    const rect = el ? getHighlightRect(el, childId) : null;
    if (rect) {
      openChildFloat(childId, rect);
    }
  };

  if (!branch || !parentMessage) return null;

  const layer = depth + 1;
  const panelTitle = t("fork.title");
  const layerLabel = t("fork.layer", { n: layer });
  const settledReplies = loadingLatestReply ? replies.slice(0, -1) : replies;
  const activeReply = loadingLatestReply ? lastReply : undefined;

  return (
    <div
      ref={panelRef}
      className={`float-panel float-panel-detail is-resizable float-panel-depth-${Math.min(depth, 4)}${isTopmost ? "" : " is-not-topmost"}${skipEnterAnimation ? " is-settled" : " float-panel-enter"}`}
      role="dialog"
      aria-label={`${panelTitle} · ${layerLabel}`}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <header
        className="float-panel-detail-header float-panel-drag-handle"
        onPointerDown={onDragHandlePointerDown}
        title={t("common.dragToMove")}
      >
        <div className="float-panel-detail-title">
          <h3>{panelTitle}</h3>
          <span className="float-panel-depth-badge" title={layerLabel}>
            {layerLabel}
          </span>
        </div>
        <button
          type="button"
          className="ds-icon-btn"
          onClick={onClose}
          aria-label={t("common.close")}
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
              verdictTargetId={branchReplyVerdictTargetId(branch.id, index)}
              pointVerdicts={reply.pointVerdicts}
              pointDoubts={reply.pointDoubts}
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
              verdictTargetId={branchReplyVerdictTargetId(
                branch.id,
                settledReplies.length,
              )}
              pointVerdicts={activeReply.pointVerdicts}
              pointDoubts={activeReply.pointDoubts}
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

        {pendingInline ? (
          <InlineToolApproval
            scope={{ kind: "branch", branchId }}
            className="is-float"
          />
        ) : null}
      </div>

      <footer className="float-panel-detail-footer">
        {pendingPlanForThis && !pendingInline ? (
          <AgentPlanReview
            scope={{ kind: "branch", branchId }}
            className="is-float"
          />
        ) : (
          <>
            <textarea
              rows={2}
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={() => {
                composingRef.current = false;
              }}
              onKeyDown={handleKeyDown}
              placeholder={t("fork.followUpPlaceholder")}
              disabled={
                branchLoading ||
                !branch.assistantMessage.trim() ||
                pendingInline
              }
              aria-label={t("fork.followUpAria")}
            />
            <div className="float-panel-detail-footer-actions">
              <span className="hint">{t("fork.followUpHint")}</span>
              {isLoadingThis ? (
                <button
                  type="button"
                  className="btn danger"
                  onClick={() => stopGeneration()}
                >
                  {t("common.stop")}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn primary"
                  disabled={
                    branchLoading ||
                    pendingInline ||
                    !followUp.trim() ||
                    !branch.assistantMessage.trim()
                  }
                  onClick={() => void submitFollowUp()}
                >
                  {t("common.send")}
                </button>
              )}
            </div>
          </>
        )}
      </footer>
      {onResizeHandlePointerDown ? (
        <div
          className="float-panel-resize-handle"
          onPointerDown={onResizeHandlePointerDown}
          role="separator"
          aria-orientation="horizontal"
          aria-label={t("common.resizePanel")}
          title={t("common.resizePanel")}
        />
      ) : null}
    </div>
  );
}
