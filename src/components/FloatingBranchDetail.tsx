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
import { resolveBranchAdoptSource } from "../lib/adoptBranch";
import { useAppStore } from "../store/useAppStore";
import { AgentPlanReview } from "./AgentPlanReview";
import {
  InlineToolApproval,
  usePendingInlineApproval,
} from "./InlineToolApproval";
import { AgentActivityPanels } from "./ProjectStatusBar";
import { MangaCloudBubble } from "./MangaCloudBubble";
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
  showAgentActivity = false,
  children,
}: {
  question: string;
  answer: string;
  reasoning?: string;
  thinkingSeconds?: number;
  isLoading: boolean;
  /** Initial clarify turn vs nested same-window follow-up (visual separator only). */
  showAnswerChrome: boolean;
  /** Live agent tool log for this turn (below thinking, above answer). */
  showAgentActivity?: boolean;
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
          <MangaCloudBubble>
            <p>{questionText}</p>
          </MangaCloudBubble>
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
          {showAgentActivity ? <AgentActivityPanels /> : null}
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
  const adoptBranchIntoMain = useAppStore((s) => s.adoptBranchIntoMain);
  const unadoptBranchFromMain = useAppStore((s) => s.unadoptBranchFromMain);
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
  /** Collapsed by default so review stays focused; expand for follow-ups. */
  const [composerOpen, setComposerOpen] = useState(false);
  const followUpRef = useRef<HTMLTextAreaElement>(null);
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
    setComposerOpen(false);
  }, [branchId]);

  const forceComposer =
    pendingPlanForThis ||
    (isLoadingThis && loadingLatestReply);
  const showComposer =
    composerOpen || forceComposer || Boolean(followUp.trim());

  useEffect(() => {
    if (!showComposer || pendingPlanForThis || pendingInline) return;
    const el = followUpRef.current;
    if (!el) return;
    el.focus();
  }, [showComposer, pendingPlanForThis, pendingInline, branchId]);

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
          {branch.adoptedAt ? (
            <span
              className="float-panel-adopted-badge"
              title={t("fork.adoptedHint")}
            >
              {t("fork.adopted")}
            </span>
          ) : null}
        </div>
        <div
          className="float-panel-detail-header-actions"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {branch.adoptedAt ? (
            <>
              <button
                type="button"
                className="btn ghost float-panel-adopt-btn"
                disabled={
                  isLoadingThis || !resolveBranchAdoptSource(branch).trim()
                }
                title={t("fork.adoptIntoMainHint")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  adoptBranchIntoMain(branchId);
                }}
              >
                {t("fork.adoptIntoMainAgain")}
              </button>
              <button
                type="button"
                className="btn ghost float-panel-adopt-btn"
                disabled={isLoadingThis}
                title={t("fork.unadoptFromMainHint")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  unadoptBranchFromMain(branchId);
                }}
              >
                {t("fork.unadoptFromMain")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn ghost float-panel-adopt-btn"
              disabled={
                isLoadingThis || !resolveBranchAdoptSource(branch).trim()
              }
              title={t("fork.adoptIntoMainHint")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                adoptBranchIntoMain(branchId);
              }}
            >
              {t("fork.adoptIntoMain")}
            </button>
          )}
          <button
            type="button"
            className="ds-icon-btn"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            ×
          </button>
        </div>
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
          showAgentActivity={
            (isLoadingThis && !loadingLatestReply) ||
            (pendingPlanForThis && replies.length === 0)
          }
        >
          <div ref={answerRef}>
            <SelectableMarkdown
              content={branch.assistantMessage}
              branches={
                isLoadingThis && !settledReplies.length ? [] : branch.children
              }
              loading={loadingInitial}
              disabled={loadingInitial}
              fixedToolbar
              overlayZBase={zIndex}
              compact
              className="float-branch-selectable"
              verdictTargetId={branch.id}
              pointVerdicts={branch.pointVerdicts}
              pointDoubts={branch.pointDoubts}
              pointAttributions={branch.pointAttributions}
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
              loading={false}
              disabled={false}
              fixedToolbar
              overlayZBase={zIndex}
              compact
              className="float-branch-selectable"
              verdictTargetId={branchReplyVerdictTargetId(branch.id, index)}
              pointVerdicts={reply.pointVerdicts}
              pointDoubts={reply.pointDoubts}
              pointAttributions={reply.pointAttributions}
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
            showAgentActivity={
              loadingLatestReply ||
              (pendingPlanForThis && replies.length > 0)
            }
          >
            <SelectableMarkdown
              content={activeReply.assistantMessage}
              branches={[]}
              loading={loadingLatestReply}
              disabled={loadingLatestReply}
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
              pointAttributions={activeReply.pointAttributions}
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

      <footer
        className={`float-panel-detail-footer${showComposer ? "" : " is-collapsed"}`}
      >
        {pendingPlanForThis && !pendingInline ? (
          <AgentPlanReview
            scope={{ kind: "branch", branchId }}
            className="is-float"
          />
        ) : showComposer ? (
          <>
            <textarea
              ref={followUpRef}
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
              <div className="float-panel-detail-footer-btns">
                {!forceComposer ? (
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => {
                      setFollowUp("");
                      setComposerOpen(false);
                    }}
                  >
                    {t("fork.hideComposer")}
                  </button>
                ) : null}
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
            </div>
          </>
        ) : (
          <button
            type="button"
            className="float-panel-detail-continue-ask"
            disabled={
              branchLoading ||
              !branch.assistantMessage.trim() ||
              pendingInline
            }
            onClick={() => setComposerOpen(true)}
          >
            {t("fork.continueAsk")}
          </button>
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
