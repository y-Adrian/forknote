import { memo, useState, type RefObject } from "react";
import { isAgentTurnPlaceholder } from "../lib/agentStatus";
import {
  archiveRelativePath,
  joinProjectPath,
} from "../lib/archiveFiles";
import { copyTextToClipboard } from "../lib/clipboard";
import { useLocale } from "../lib/i18n";
import { useAppStore } from "../store/useAppStore";
import type { Anchor, ArchiveSnapshot, ChatMessage, NodeId } from "../types";
import {
  InlineToolApproval,
  usePendingInlineApproval,
} from "./InlineToolApproval";
import { MarkdownBody } from "./MarkdownBody";
import { MessageActions } from "./MessageActions";
import { AgentActivityPanels } from "./ProjectStatusBar";
import { SelectableAnswer } from "./SelectableAnswer";
import { ThinkingBlock } from "./ThinkingBlock";
import { GlassMessageBubble } from "./GlassMessageBubble";
import { TurnBusyIndicator } from "./TurnBusyIndicator";

function SourceBody({ content }: { content: string }) {
  return (
    <pre className="fn-source-body" tabIndex={0}>
      {content}
    </pre>
  );
}

function ArchivePathRow({ archive }: { archive: ArchiveSnapshot }) {
  const { t } = useLocale();
  const projectRoot = useAppStore((s) => s.projectRoot);
  const [feedback, setFeedback] = useState<"idle" | "copied" | "failed">("idle");
  const rel = archive.filePath?.trim() || archiveRelativePath(archive);
  const abs = projectRoot ? joinProjectPath(projectRoot, rel) : null;
  const onDisk = archive.storage === "project" && Boolean(archive.filePath);

  const copyPath = async () => {
    const text = abs ?? rel;
    const ok = await copyTextToClipboard(text);
    setFeedback(ok ? "copied" : "failed");
    window.setTimeout(() => setFeedback("idle"), 1600);
  };

  const copyLabel =
    feedback === "copied"
      ? t("chat.copied")
      : feedback === "failed"
        ? t("chat.copyFailed")
        : t("archive.copyPath");

  return (
    <div className="fn-archive-path-row">
      {onDisk && abs ? (
        <>
          <code className="fn-archive-path" title={abs}>
            {rel}
          </code>
          <button
            type="button"
            className={`btn ghost sm${feedback === "failed" ? " is-copy-failed" : ""}`}
            onClick={() => void copyPath()}
            title={
              feedback === "failed"
                ? t("chat.copyFailed")
                : t("archive.copyPathTitle")
            }
            aria-label={copyLabel}
          >
            {copyLabel}
          </button>
        </>
      ) : (
        <span className="fn-archive-path-hint">
          {projectRoot
            ? t("archive.pathPending")
            : t("archive.pathNeedProject")}
        </span>
      )}
    </div>
  );
}

type AskBranch = (
  parentId: NodeId,
  parentContent: string,
  anchor: Anchor,
  question: string,
) => Promise<NodeId | void>;

const UserMessageRow = memo(function UserMessageRow({
  msg,
  onEditUserMessage,
}: {
  msg: ChatMessage;
  onEditUserMessage: (text: string) => void;
}) {
  return (
    <div data-msg-id={msg.id} className="fn-msg fn-msg-user">
      <GlassMessageBubble>
        <p>{msg.content}</p>
      </GlassMessageBubble>
      <MessageActions
        text={msg.content}
        align="end"
        onEdit={() => onEditUserMessage(msg.content)}
      />
    </div>
  );
});

const AssistantMessageRow = memo(function AssistantMessageRow({
  msg,
  sourceMode,
  loadingMain,
  loadingBranchId,
  showMainAgentActivity,
  lastThreadMessageId,
  openBranchId,
  onToggleBranch,
  onAskBranch,
  onCopyMessage,
  onDiagnoseMessage,
  pendingInline,
  pendingInlineAssistantId,
}: {
  msg: ChatMessage;
  sourceMode: boolean;
  loadingMain: boolean;
  loadingBranchId: NodeId | null;
  showMainAgentActivity: boolean;
  lastThreadMessageId: NodeId | undefined;
  openBranchId: NodeId | null;
  onToggleBranch: (branchId: NodeId | null) => void;
  onAskBranch: AskBranch;
  onCopyMessage: (messageId: NodeId) => void;
  onDiagnoseMessage: (messageId: NodeId) => Promise<boolean>;
  pendingInline: boolean;
  pendingInlineAssistantId: string | null | undefined;
}) {
  const { t } = useLocale();
  const isTail = msg.id === lastThreadMessageId;

  return (
    <div data-msg-id={msg.id} className="fn-msg fn-msg-assistant">
      {msg.reasoning?.trim() ? (
        <ThinkingBlock
          reasoning={msg.reasoning}
          seconds={msg.thinkingSeconds}
          streaming={loadingMain && isTail}
        />
      ) : null}
      {showMainAgentActivity && isTail ? <AgentActivityPanels /> : null}
      {msg.content ? (
        <>
          <div className="ds-bubble ds-bubble-assistant">
            {sourceMode ? (
              <SourceBody content={msg.content} />
            ) : (
              <SelectableAnswer
                parentId={msg.id}
                parentContent={msg.content}
                content={msg.content}
                branches={msg.children}
                onAskBranch={onAskBranch}
                branchLoading={
                  loadingBranchId !== null || (loadingMain && isTail)
                }
                contentStreaming={loadingMain && isTail}
                activeBranchId={openBranchId}
                onToggleBranch={onToggleBranch}
                compact
                pointVerdicts={msg.pointVerdicts}
                pointDoubts={msg.pointDoubts}
                pointAttributions={msg.pointAttributions}
              />
            )}
          </div>
          <div
            className="fn-msg-footer is-start"
            aria-busy={
              loadingMain && isTail && isAgentTurnPlaceholder(msg.content)
                ? true
                : undefined
            }
          >
            <MessageActions
              text={msg.content}
              align="start"
              onCopy={() => onCopyMessage(msg.id)}
              onDiagnose={() => onDiagnoseMessage(msg.id)}
            />
            {loadingMain && isTail && isAgentTurnPlaceholder(msg.content) ? (
              <TurnBusyIndicator label={t("chat.generating")} />
            ) : null}
          </div>
        </>
      ) : loadingMain && isTail ? (
        !msg.reasoning?.trim() ? (
          <div className="ds-typing" aria-label={t("main.thinking")}>
            <span />
            <span />
            <span />
          </div>
        ) : null
      ) : null}
      {pendingInline &&
      (pendingInlineAssistantId
        ? pendingInlineAssistantId === msg.id
        : isTail) ? (
        <InlineToolApproval scope={{ kind: "main" }} />
      ) : null}
    </div>
  );
});

export interface MainChatMessageListProps {
  scrollRef: RefObject<HTMLDivElement | null>;
  suppressEnterAnim: boolean;
  sourceMode: boolean;
  showArchiveDraft: boolean;
  archiveDraft: string;
  showArchiveDoc: boolean;
  activeArchive: ArchiveSnapshot | null | undefined;
  archiveAlreadyCurrent: boolean;
  loadingArchive: boolean;
  loadingMain: boolean;
  loadingBranchId: NodeId | null;
  showMainAgentActivity: boolean;
  visibleMessages: ChatMessage[];
  lastThreadMessageId: NodeId | undefined;
  openBranchId: NodeId | null;
  onToggleBranch: (branchId: NodeId | null) => void;
  onAskBranch: AskBranch;
  onEditUserMessage: (text: string) => void;
  onCopyMessage: (messageId: NodeId) => void;
  onDiagnoseMessage: (messageId: NodeId) => Promise<boolean>;
  onSwitchToLiveConversation: () => void;
}

/**
 * Memoized message scroller — intentionally omits composer `input` so typing
 * in MainPanel does not rebuild the thread DOM.
 */
export const MainChatMessageList = memo(function MainChatMessageList({
  scrollRef,
  suppressEnterAnim,
  sourceMode,
  showArchiveDraft,
  archiveDraft,
  showArchiveDoc,
  activeArchive,
  archiveAlreadyCurrent,
  loadingArchive,
  loadingMain,
  loadingBranchId,
  showMainAgentActivity,
  visibleMessages,
  lastThreadMessageId,
  openBranchId,
  onToggleBranch,
  onAskBranch,
  onEditUserMessage,
  onCopyMessage,
  onDiagnoseMessage,
  onSwitchToLiveConversation,
}: MainChatMessageListProps) {
  const { t } = useLocale();
  const { pending: pendingInline, assistantId: pendingInlineAssistantId } =
    usePendingInlineApproval({ kind: "main" });

  return (
    <div className="ds-chat-scroll" ref={scrollRef}>
      <div
        className={`ds-messages${suppressEnterAnim ? " is-no-enter" : ""}`}
      >
        {showArchiveDraft ? (
          <div className="fn-msg fn-msg-assistant">
            <article className="fn-archive-base" aria-busy="true">
              <span className="fn-archive-base-kicker">
                {t("main.archiveBaseKicker")}
              </span>
              <h2 className="fn-archive-base-title">{t("main.archiving")}</h2>
              {archiveDraft.trim() ? (
                <div className="answer-body">
                  {sourceMode ? (
                    <SourceBody content={archiveDraft} />
                  ) : (
                    <MarkdownBody content={archiveDraft} />
                  )}
                </div>
              ) : (
                <div className="fn-archive-loading" aria-busy="true">
                  <div
                    className="ds-typing"
                    aria-label={t("archive.generatingAria")}
                  >
                    <span />
                    <span />
                    <span />
                  </div>
                  <p>{t("archive.generating")}</p>
                </div>
              )}
            </article>
          </div>
        ) : null}
        {showArchiveDoc && activeArchive && !loadingArchive ? (
          <div className="fn-msg fn-msg-assistant">
            <article className="fn-archive-base">
              <div className="fn-archive-base-toolbar">
                <span className="fn-archive-base-kicker">
                  {t("main.archiveBaseKicker")}
                  {archiveAlreadyCurrent
                    ? ` · ${t("archive.hintUpToDateShort")}`
                    : ""}
                </span>
                <button
                  type="button"
                  className="btn ghost sm"
                  title={t("main.liveConversationTitle")}
                  onClick={onSwitchToLiveConversation}
                >
                  {t("main.liveConversation")}
                </button>
              </div>
              <h2 className="fn-archive-base-title">{activeArchive.title}</h2>
              <ArchivePathRow archive={activeArchive} />
              <div className="answer-body">
                {sourceMode ? (
                  <SourceBody content={activeArchive.content} />
                ) : (
                  <MarkdownBody content={activeArchive.content} />
                )}
              </div>
            </article>
            <MessageActions text={activeArchive.content} align="start" />
          </div>
        ) : null}
        {visibleMessages.map((msg) =>
          msg.role === "user" ? (
            <UserMessageRow
              key={msg.id}
              msg={msg}
              onEditUserMessage={onEditUserMessage}
            />
          ) : (
            <AssistantMessageRow
              key={msg.id}
              msg={msg}
              sourceMode={sourceMode}
              loadingMain={loadingMain}
              loadingBranchId={loadingBranchId}
              showMainAgentActivity={showMainAgentActivity}
              lastThreadMessageId={lastThreadMessageId}
              openBranchId={openBranchId}
              onToggleBranch={onToggleBranch}
              onAskBranch={onAskBranch}
              onCopyMessage={onCopyMessage}
              onDiagnoseMessage={onDiagnoseMessage}
              pendingInline={pendingInline}
              pendingInlineAssistantId={pendingInlineAssistantId}
            />
          ),
        )}
        {pendingInline &&
        pendingInlineAssistantId &&
        !visibleMessages.some((m) => m.id === pendingInlineAssistantId) ? (
          <InlineToolApproval scope={{ kind: "main" }} />
        ) : null}
      </div>
    </div>
  );
});
