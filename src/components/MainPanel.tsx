import { useEffect, useMemo, useRef, useState } from "react";
import { countBranchesInThread } from "../lib/branches";
import { resolveConversationContext } from "../lib/conversationContext";
import { useLocale } from "../lib/i18n";
import { firstUserMessage } from "../lib/thread";
import { useAppStore } from "../store/useAppStore";
import type { NodeId } from "../types";
import { ForkNoteLogo } from "./BranchLogo";
import { BranchRail } from "./BranchRail";
import { AgentPlanReview } from "./AgentPlanReview";
import { ChatComposer } from "./ChatComposer";
import { MessageActions } from "./MessageActions";
import { ProjectStatusBar } from "./ProjectStatusBar";
import { SelectableAnswer } from "./SelectableAnswer";
import { SessionApiSettings } from "./SessionApiSettings";
import { ThinkingBlock } from "./ThinkingBlock";

interface Props {
  onOpenProject: () => void;
  showSidebarMenu?: boolean;
  onOpenSidebar?: () => void;
}

function SidebarMenuButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className="fn-sidebar-menu-btn"
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <ForkNoteLogo
        iconOnly
        iconHeight={22}
        className="fn-sidebar-menu-logo"
      />
    </button>
  );
}

export function MainPanel({
  onOpenProject,
  showSidebarMenu = false,
  onOpenSidebar,
}: Props) {
  const { t } = useLocale();
  const thread = useAppStore((s) => s.thread);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const loadingMain = useAppStore(
    (s) => Boolean(s.activeSessionId && s.loadingMainBySession[s.activeSessionId]),
  );
  const loadingArchive = useAppStore(
    (s) =>
      s.loadingArchiveSessionId != null &&
      s.loadingArchiveSessionId === s.activeSessionId,
  );
  const loadingCompress = useAppStore(
    (s) =>
      s.loadingCompressSessionId != null &&
      s.loadingCompressSessionId === s.activeSessionId,
  );
  const loadingBranchId = useAppStore((s) =>
    s.activeSessionId
      ? s.loadingBranchBySession[s.activeSessionId] ?? null
      : null,
  );
  const agentPendingPlan = useAppStore((s) =>
    s.agentPendingPlan && s.agentPendingPlan.sessionId === s.activeSessionId
      ? s.agentPendingPlan
      : null,
  );
  const error = useAppStore((s) => s.error);
  const projectRoot = useAppStore((s) => s.projectRoot);
  const askMain = useAppStore((s) => s.askMain);
  const askBranch = useAppStore((s) => s.askBranch);
  const stopGeneration = useAppStore((s) => s.stopGeneration);
  const archiveCurrent = useAppStore((s) => s.archiveCurrent);
  const compressContext = useAppStore((s) => s.compressContext);
  const setArchivePanelOpen = useAppStore((s) => s.setArchivePanelOpen);
  const setViewingArchiveId = useAppStore((s) => s.setViewingArchiveId);
  const setContextMode = useAppStore((s) => s.setContextMode);

  const [input, setInput] = useState("");
  const [openBranchId, setOpenBranchId] = useState<NodeId | null>(null);
  const [modeNotice, setModeNotice] = useState<{
    archiveId: NodeId;
    title: string;
  } | null>(null);
  const closeAllBranchFloats = useAppStore((s) => s.closeAllBranchFloats);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastSentPromptRef = useRef("");
  /** Ignore composer onChange briefly after send so IME/composition can't reinsert text. */
  const suppressComposerChangeRef = useRef(false);
  const suppressComposerTimerRef = useRef<number | null>(null);
  const prevLoadingArchiveRef = useRef(false);
  const prevArchiveCountRef = useRef(0);
  const modeNoticeTimerRef = useRef<number | null>(null);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId),
    [sessions, activeSessionId],
  );
  const archives = activeSession?.archives ?? [];
  const resolvedContext = useMemo(
    () => resolveConversationContext(activeSession),
    [activeSession],
  );
  const activeArchive = resolvedContext.archive;
  const hasArchives = archives.length > 0;
  /** Must match askMain: only true when archive snapshot resolves */
  const inArchiveMode = resolvedContext.mode === "archive";

  const forkCount = useMemo(
    () => (thread ? countBranchesInThread(thread) : 0),
    [thread],
  );

  const hasThreadContent = useMemo(
    () => Boolean(thread?.messages.some((m) => m.content.trim())),
    [thread],
  );

  const composerBusy =
    loadingMain ||
    loadingArchive ||
    loadingCompress ||
    Boolean(agentPendingPlan) ||
    Boolean(loadingBranchId);

  useEffect(() => {
    setInput("");
    setOpenBranchId(null);
    setModeNotice(null);
    closeAllBranchFloats();
    const session = useAppStore
      .getState()
      .sessions.find((s) => s.id === activeSessionId);
    prevArchiveCountRef.current = session?.archives?.length ?? 0;
    prevLoadingArchiveRef.current = false;
  }, [activeSessionId, closeAllBranchFloats]);

  useEffect(() => {
    return () => {
      if (suppressComposerTimerRef.current) {
        window.clearTimeout(suppressComposerTimerRef.current);
      }
      if (modeNoticeTimerRef.current) {
        window.clearTimeout(modeNoticeTimerRef.current);
      }
    };
  }, []);

  const setComposerValue = (value: string) => {
    if (suppressComposerChangeRef.current) return;
    setInput(value);
  };

  /** Clear input and briefly ignore IME/composition onChange that would reinsert text. */
  const clearComposerForSend = () => {
    suppressComposerChangeRef.current = true;
    setInput("");
    if (suppressComposerTimerRef.current) {
      window.clearTimeout(suppressComposerTimerRef.current);
    }
    suppressComposerTimerRef.current = window.setTimeout(() => {
      suppressComposerChangeRef.current = false;
      suppressComposerTimerRef.current = null;
    }, 200);
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread?.messages.length, loadingMain]);

  useEffect(() => {
    if (!loadingBranchId && openBranchId) {
      requestAnimationFrame(() => {
        const mark = document.querySelector(
          `mark.branch-highlight[data-branch-id="${openBranchId}"]`,
        );
        mark?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  }, [loadingBranchId, openBranchId]);

  // After a successful archive, briefly reinforce the new context mode.
  useEffect(() => {
    const wasLoading = prevLoadingArchiveRef.current;
    prevLoadingArchiveRef.current = loadingArchive;

    // While generating, keep the pre-archive count baseline so we can detect growth.
    if (loadingArchive) return;

    const grew = archives.length > prevArchiveCountRef.current;
    prevArchiveCountRef.current = archives.length;

    if (wasLoading && grew && inArchiveMode && activeArchive) {
      setModeNotice({
        archiveId: activeArchive.id,
        title: activeArchive.title,
      });
      if (modeNoticeTimerRef.current) {
        window.clearTimeout(modeNoticeTimerRef.current);
      }
      modeNoticeTimerRef.current = window.setTimeout(() => {
        setModeNotice(null);
        modeNoticeTimerRef.current = null;
      }, 9000);
    }
  }, [loadingArchive, archives.length, inArchiveMode, activeArchive]);

  useEffect(() => {
    return () => {
      if (modeNoticeTimerRef.current) {
        window.clearTimeout(modeNoticeTimerRef.current);
      }
    };
  }, []);

  const toggleBranch = (branchId: NodeId | null) => {
    setOpenBranchId(branchId);
  };

  const openArchivePanel = (archiveId?: NodeId | null) => {
    setViewingArchiveId(
      archiveId ??
        activeSession?.activeArchiveId ??
        archives[archives.length - 1]?.id ??
        null,
    );
    setArchivePanelOpen(true);
  };

  const dismissModeNotice = () => {
    setModeNotice(null);
    if (modeNoticeTimerRef.current) {
      window.clearTimeout(modeNoticeTimerRef.current);
      modeNoticeTimerRef.current = null;
    }
  };

  const switchToLive = () => {
    // Always write live so a stale archive id cannot leave askMain on archive
    setContextMode("live");
    dismissModeNotice();
  };

  const switchToArchive = (archiveId?: NodeId) => {
    const targetId =
      archiveId ??
      activeSession?.activeArchiveId ??
      archives[archives.length - 1]?.id;
    if (!targetId) return;
    setContextMode("archive", targetId);
  };

  const submit = () => {
    const saved = input.trim();
    if (!saved) return;
    const state = useAppStore.getState();
    const sid = state.activeSessionId;
    if (sid && state.loadingMainBySession[sid]) return;
    if (state.agentPendingPlan?.sessionId === sid) return;
    if (sid && state.loadingArchiveSessionId === sid) return;
    if (sid && state.loadingCompressSessionId === sid) return;
    lastSentPromptRef.current = saved;
    clearComposerForSend();
    void (async () => {
      const outcome = await askMain(saved);
      // Only put text back when the turn never ran / was rolled back before streaming
      if (
        (outcome === "rejected" || outcome === "rolled_back") &&
        lastSentPromptRef.current === saved
      ) {
        suppressComposerChangeRef.current = false;
        setInput(saved);
      }
    })();
  };

  const handleStop = () => {
    const restored = stopGeneration();
    const text = restored || lastSentPromptRef.current;
    if (text) {
      lastSentPromptRef.current = text;
      setInput(text);
    }
  };

  const editUserMessage = (text: string) => {
    lastSentPromptRef.current = text;
    setInput(text);
  };

  if (!thread) {
    return (
      <main className="ds-main ds-main-empty fn-main-empty">
        {showSidebarMenu && onOpenSidebar ? (
          <div className="fn-main-topbar">
            <SidebarMenuButton
              onClick={onOpenSidebar}
              label={t("sidebar.openList")}
            />
          </div>
        ) : null}
        <div className="fn-empty">
          <div className="fn-empty-brand">
            <ForkNoteLogo showWordmark className="fn-empty-logo" iconHeight={48} />
            <p className="fn-empty-tagline">{t("main.tagline")}</p>
          </div>

          <ol className="fn-empty-steps" aria-label={t("main.howTo")}>
            <li>
              <span className="fn-step-num">1</span>
              <span>{t("main.step1")}</span>
            </li>
            <li>
              <span className="fn-step-num">2</span>
              <span>{t("main.step2")}</span>
            </li>
            <li>
              <span className="fn-step-num">3</span>
              <span>{t("main.step3")}</span>
            </li>
          </ol>

          <ProjectStatusBar onOpenProject={onOpenProject} />

          <AgentPlanReview scope={{ kind: "main" }} />

          <ChatComposer
            value={input}
            onChange={setComposerValue}
            onSubmit={submit}
            onStop={handleStop}
            loading={composerBusy}
            placeholder={
              projectRoot ? t("main.placeholderProject") : undefined
            }
            leading={<SessionApiSettings disabled={composerBusy} />}
          />
          {error && <p className="ds-error">{error}</p>}
        </div>
      </main>
    );
  }

  const title = firstUserMessage(thread) || t("main.untitled");

  return (
    <main className="ds-main ds-main-chat">
      <header className="fn-chat-header">
        {showSidebarMenu && onOpenSidebar ? (
          <SidebarMenuButton
            onClick={onOpenSidebar}
            label={t("sidebar.openList")}
          />
        ) : null}
        <div className="fn-chat-header-main">
          <span className="fn-chat-kicker">{t("main.notesKicker")}</span>
          <h1 className="fn-chat-title" title={title}>
            {title}
          </h1>
        </div>
        {forkCount > 0 && (
          <div className="fn-chat-header-meta">
            <span
              className="fn-fork-chip"
              title={t("main.forksTitle")}
            >
              {t("main.forks", { count: forkCount })}
            </span>
          </div>
        )}
      </header>

      <div className="ds-chat-body">
        <div className="ds-chat-column">
          <div className="ds-chat-scroll" ref={scrollRef}>
            <div className="ds-messages">
              {thread.messages.map((msg, index) =>
                msg.role === "user" ? (
                  <div
                    key={msg.id}
                    data-msg-id={msg.id}
                    className="fn-msg fn-msg-user"
                  >
                    <div className="ds-bubble ds-bubble-user">
                      <p>{msg.content}</p>
                    </div>
                    <MessageActions
                      text={msg.content}
                      align="end"
                      onEdit={() => editUserMessage(msg.content)}
                    />
                  </div>
                ) : (
                  <div
                    key={msg.id}
                    data-msg-id={msg.id}
                    className="fn-msg fn-msg-assistant"
                  >
                    {msg.reasoning?.trim() ? (
                      <ThinkingBlock
                        reasoning={msg.reasoning}
                        seconds={msg.thinkingSeconds}
                        streaming={
                          loadingMain && index === thread.messages.length - 1
                        }
                      />
                    ) : null}
                    {msg.content ? (
                      <>
                        <div className="ds-bubble ds-bubble-assistant">
                          <SelectableAnswer
                            parentId={msg.id}
                            parentContent={msg.content}
                            content={msg.content}
                            branches={msg.children}
                            onAskBranch={askBranch}
                            branchLoading={loadingBranchId !== null}
                            activeBranchId={openBranchId}
                            onToggleBranch={toggleBranch}
                            compact
                            pointVerdicts={msg.pointVerdicts}
                            pointDoubts={msg.pointDoubts}
                          />
                        </div>
                        <MessageActions text={msg.content} align="start" />
                      </>
                    ) : loadingMain && index === thread.messages.length - 1 ? (
                      !msg.reasoning?.trim() ? (
                        <div
                          className="ds-typing"
                          aria-label={t("main.thinking")}
                        >
                          <span />
                          <span />
                          <span />
                        </div>
                      ) : null
                    ) : null}
                  </div>
                ),
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          <footer className="ds-chat-footer">
            {modeNotice && inArchiveMode && (
              <div className="fn-context-banner fn-context-banner-footer" role="status">
                <p className="fn-context-banner-text">
                  {t("main.bannerText")}
                  <span className="fn-context-banner-meta">
                    · {modeNotice.title}
                  </span>
                </p>
                <div className="fn-context-banner-actions">
                  <button
                    type="button"
                    className="fn-context-banner-btn"
                    onClick={() => openArchivePanel(modeNotice.archiveId)}
                  >
                    {t("main.viewArchive")}
                  </button>
                  <button
                    type="button"
                    className="fn-context-banner-btn is-quiet"
                    onClick={dismissModeNotice}
                  >
                    {t("main.gotIt")}
                  </button>
                </div>
              </div>
            )}

            {inArchiveMode && (
              <p className="fn-context-composer-hint">
                {t("main.archiveComposerHint")}
              </p>
            )}

            <div className="fn-composer-toolbar">
              <ProjectStatusBar onOpenProject={onOpenProject} />

              {hasArchives && (
                <span className="fn-composer-toolbar-sep" aria-hidden>
                  ·
                </span>
              )}

              {hasArchives && (
                <div
                  className="fn-context-mode"
                  role="group"
                  aria-label={t("main.contextModeAria")}
                >
                  <div
                    className="fn-context-segment"
                    aria-label={t("main.switchContextAria")}
                  >
                    <button
                      type="button"
                      className={`fn-context-seg${inArchiveMode ? " is-active" : ""}`}
                      aria-pressed={inArchiveMode}
                      disabled={composerBusy}
                      title={t("main.archiveContextTitle")}
                      onClick={() => switchToArchive()}
                    >
                      {t("main.archiveContext")}
                    </button>
                    <button
                      type="button"
                      className={`fn-context-seg${!inArchiveMode ? " is-active" : ""}`}
                      aria-pressed={!inArchiveMode}
                      disabled={composerBusy}
                      title={t("main.fullThreadTitle")}
                      onClick={switchToLive}
                    >
                      {t("main.fullThread")}
                    </button>
                  </div>

                  {archives.length > 1 && (
                    <button
                      type="button"
                      className="fn-archive-view-btn"
                      title={t("main.archivesViewTitle")}
                      onClick={() => openArchivePanel()}
                    >
                      {t("main.archivesCount", { count: archives.length })}
                    </button>
                  )}
                </div>
              )}

              {hasThreadContent && (
                <div className="fn-composer-memory-actions">
                  <button
                    type="button"
                    className="fn-archive-btn"
                    disabled={composerBusy}
                    title={t("main.compressTitle")}
                    onClick={() => void compressContext()}
                  >
                    {loadingCompress
                      ? t("main.compressing")
                      : t("main.compress")}
                  </button>
                  <button
                    type="button"
                    className="fn-archive-btn"
                    disabled={composerBusy}
                    title={t("main.archiveTitle")}
                    onClick={() => void archiveCurrent()}
                  >
                    {loadingArchive ? t("main.archiving") : t("main.archive")}
                  </button>
                </div>
              )}
            </div>

            <AgentPlanReview scope={{ kind: "main" }} />

            <ChatComposer
              value={input}
              onChange={setComposerValue}
              onSubmit={submit}
              onStop={handleStop}
              loading={composerBusy}
              compact
              leading={<SessionApiSettings disabled={composerBusy} />}
              placeholder={
                inArchiveMode
                  ? t("main.placeholderArchive")
                  : projectRoot
                    ? t("main.placeholderContinueProject")
                    : t("main.placeholderContinue")
              }
            />
          </footer>
        </div>
        <BranchRail thread={thread} scrollRef={scrollRef} />
      </div>

      {error && <p className="ds-error ds-error-bar">{error}</p>}
    </main>
  );
}
