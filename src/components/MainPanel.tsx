import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { messagesAfterArchive } from "../lib/archive";
import { countBranchesInThread } from "../lib/branches";
import {
  resolveConversationContext,
  resolveThreadView,
} from "../lib/conversationContext";
import { useLocale } from "../lib/i18n";
import {
  initMainThreadViewMode,
  setMainThreadViewMode,
  type MainThreadViewMode,
} from "../lib/mainThreadViewMode";
import { COMPRESS_SUGGEST_MESSAGE_THRESHOLD } from "../lib/settings";
import { displaySessionTitle } from "../lib/storage";
import {
  archiveRelativePath,
  joinProjectPath,
} from "../lib/archiveFiles";
import { copyTextToClipboard } from "../lib/clipboard";
import { useAppStore } from "../store/useAppStore";
import type { ArchiveSnapshot, ChatMessage, NodeId } from "../types";
import { ForkNoteLogo } from "./BranchLogo";
import { BranchRail } from "./BranchRail";
import { ForkHistoryMap } from "./ForkHistoryMap";
import { AgentPlanReview } from "./AgentPlanReview";
import {
  InlineToolApproval,
  usePendingInlineApproval,
} from "./InlineToolApproval";
import { ChatComposer } from "./ChatComposer";
import { MarkdownBody } from "./MarkdownBody";
import { MangaCloudBubble } from "./MangaCloudBubble";
import { MessageActions } from "./MessageActions";
import { ProjectStatusBar, AgentActivityPanels } from "./ProjectStatusBar";
import { SelectableAnswer } from "./SelectableAnswer";
import { SessionApiSettings } from "./SessionApiSettings";
import { NetworkAccessToggle } from "./NetworkAccessToggle";
import { ThinkingBlock } from "./ThinkingBlock";

function SourceBody({ content }: { content: string }) {
  return (
    <pre className="fn-source-body" tabIndex={0}>
      {content}
    </pre>
  );
}

function ViewModeIcon({ mode }: { mode: MainThreadViewMode }) {
  if (mode === "source") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M8 7L3 12l5 5M16 7l5 5-5 5M13.5 4l-3 16"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 5.5h16M4 12h16M4 18.5h10"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArchivePathRow({ archive }: { archive: ArchiveSnapshot }) {
  const { t } = useLocale();
  const projectRoot = useAppStore((s) => s.projectRoot);
  const [copied, setCopied] = useState(false);
  const rel = archive.filePath?.trim() || archiveRelativePath(archive);
  const abs = projectRoot ? joinProjectPath(projectRoot, rel) : null;
  const onDisk = archive.storage === "project" && Boolean(archive.filePath);

  const copyPath = async () => {
    const text = abs ?? rel;
    const ok = await copyTextToClipboard(text);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="fn-archive-path-row">
      {onDisk && abs ? (
        <>
          <code className="fn-archive-path" title={abs}>
            {rel}
          </code>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => void copyPath()}
            title={t("archive.copyPathTitle")}
          >
            {copied ? t("chat.copied") : t("archive.copyPath")}
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

function TitleEditIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 20h4l10.5-10.5a1.5 1.5 0 0 0 0-2.12L16.62 5.5a1.5 1.5 0 0 0-2.12 0L4 16v4z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M13.5 6.5l4 4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

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
  const showMainAgentActivity = useAppStore((s) => {
    const sid = s.activeSessionId;
    if (!sid) return false;
    if (s.loadingMainBySession[sid]) return true;
    const plan = s.agentPendingPlan;
    return Boolean(plan && plan.sessionId === sid && !plan.branchId);
  });
  const { pending: pendingInline, assistantId: pendingInlineAssistantId } =
    usePendingInlineApproval({ kind: "main" });
  const error = useAppStore((s) => s.error);
  const pendingClarify = useAppStore((s) =>
    s.activeSessionId
      ? s.pendingClarifyBySession[s.activeSessionId] ?? null
      : null,
  );
  const clearPendingClarify = useAppStore((s) => s.clearPendingClarify);
  const recordPassiveCopy = useAppStore((s) => s.recordPassiveCopy);
  const projectRoot = useAppStore((s) => s.projectRoot);
  const sidecarUrl = useAppStore((s) => s.sidecarUrl);
  const pendingFileIncludes = useAppStore((s) => s.pendingFileIncludes);
  const addFileInclude = useAppStore((s) => s.addFileInclude);
  const removeFileInclude = useAppStore((s) => s.removeFileInclude);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const askMain = useAppStore((s) => s.askMain);
  const askBranch = useAppStore((s) => s.askBranch);
  const stopGeneration = useAppStore((s) => s.stopGeneration);
  const archiveCurrent = useAppStore((s) => s.archiveCurrent);
  const compressContext = useAppStore((s) => s.compressContext);
  const archiveDraft = useAppStore((s) => s.archiveDraft);
  const archiveAlreadyCurrent = useAppStore((s) => s.archiveAlreadyCurrent);
  const setContextMode = useAppStore((s) => s.setContextMode);
  const setThreadView = useAppStore((s) => s.setThreadView);
  const renameSession = useAppStore((s) => s.renameSession);

  const [input, setInput] = useState("");
  const [openBranchId, setOpenBranchId] = useState<NodeId | null>(null);
  const [modeNotice, setModeNotice] = useState<{
    archiveId: NodeId;
    title: string;
  } | null>(null);
  /** Per-session dismiss for the long-thread compress suggestion. */
  const [compressSuggestDismissedFor, setCompressSuggestDismissedFor] =
    useState<NodeId | null>(null);
  const [archiveHistoryOpen, setArchiveHistoryOpen] = useState(false);
  const [forkMapOpen, setForkMapOpen] = useState(false);
  const [threadViewMode, setThreadViewMode] = useState<MainThreadViewMode>(() =>
    initMainThreadViewMode(),
  );
  const sourceMode = threadViewMode === "source";
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const closeAllBranchFloats = useAppStore((s) => s.closeAllBranchFloats);
  const scrollRef = useRef<HTMLDivElement>(null);
  const archiveHistoryRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const skipTitleBlurCommit = useRef(false);
  /** Preserve viewport across Live/Archive/Evolution remounts. */
  const scrollAnchorRef = useRef<
    | { kind: "msg"; id: string; top: number }
    | { kind: "scroll"; scrollTop: number }
    | null
  >(null);
  const suppressEnterAnimRef = useRef(false);
  const [suppressEnterAnim, setSuppressEnterAnim] = useState(false);
  /** When true, keep the chat pinned to the latest message as content grows. */
  const stickToBottomRef = useRef(true);
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
  const threadView = resolveThreadView(activeSession, resolvedContext.mode);
  const showArchiveDoc =
    inArchiveMode && threadView === "archive" && Boolean(activeArchive);
  const showArchiveDraft = loadingArchive;

  const forkCount = useMemo(
    () => (thread ? countBranchesInThread(thread) : 0),
    [thread],
  );

  const hasThreadContent = useMemo(
    () => Boolean(thread?.messages.some((m) => m.content.trim())),
    [thread],
  );

  const visibleMessages: ChatMessage[] = useMemo(() => {
    if (!thread) return [];
    if (showArchiveDoc && activeArchive) {
      return messagesAfterArchive(thread, activeArchive);
    }
    return thread.messages;
  }, [thread, showArchiveDoc, activeArchive]);

  const lastThreadMessageId = thread?.messages[thread.messages.length - 1]?.id;

  const showCompressSuggest = useMemo(() => {
    if (!thread || !activeSessionId) return false;
    if (compressSuggestDismissedFor === activeSessionId) return false;
    if (loadingCompress) return false;
    const nonEmpty = thread.messages.filter((m) => m.content.trim()).length;
    if (nonEmpty < COMPRESS_SUGGEST_MESSAGE_THRESHOLD) return false;
    // Hide briefly after a successful compress on this note
    const packAt = activeSession?.contextMemory?.updatedAt;
    if (packAt && packAt > Date.now() - 5 * 60_000) return false;
    return true;
  }, [
    thread,
    activeSessionId,
    compressSuggestDismissedFor,
    loadingCompress,
    activeSession?.contextMemory?.updatedAt,
  ]);
  const showCompressSuggestBanner = showCompressSuggest && !inArchiveMode;

  const composerBusy =
    loadingMain ||
    loadingArchive ||
    loadingCompress ||
    Boolean(loadingBranchId);

  useEffect(() => {
    setInput("");
    setOpenBranchId(null);
    setModeNotice(null);
    setArchiveHistoryOpen(false);
    setForkMapOpen(false);
    setRenamingTitle(false);
    setDraftTitle("");
    closeAllBranchFloats();
    const session = useAppStore
      .getState()
      .sessions.find((s) => s.id === activeSessionId);
    prevArchiveCountRef.current = session?.archives?.length ?? 0;
    prevLoadingArchiveRef.current = false;
  }, [activeSessionId, closeAllBranchFloats]);

  useEffect(() => {
    if (!archiveHistoryOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = archiveHistoryRef.current;
      if (el && !el.contains(e.target as Node)) {
        setArchiveHistoryOpen(false);
      }
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setArchiveHistoryOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [archiveHistoryOpen]);

  useEffect(() => {
    if (!renamingTitle) return;
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [renamingTitle]);
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

  const scrollChatToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  // Track whether the user is reading older messages (unpin) vs staying at the end.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const NEAR_BOTTOM_PX = 96;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distance <= NEAR_BOTTOM_PX;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [activeSessionId]);

  // Reset pin when switching session, then jump once.
  // Do not scroll on Live/Archive/Evolution view swaps — that jerks the viewport.
  useEffect(() => {
    stickToBottomRef.current = true;
    requestAnimationFrame(() => scrollChatToBottom());
  }, [activeSessionId, scrollChatToBottom]);

  // New messages / inline approval: force pin and jump (no smooth scrollIntoView —
  // it races remounts and feels like a flash back to older answers).
  // Use thread length (not visibleMessages) so context-mode filters do not re-pin.
  useEffect(() => {
    stickToBottomRef.current = true;
    scrollChatToBottom();
  }, [thread?.messages.length, pendingInline, scrollChatToBottom]);

  // Follow streaming / markdown height growth while pinned.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const messages = root.querySelector(".ds-messages");
    if (!messages) return;
    const ro = new ResizeObserver(() => {
      if (stickToBottomRef.current) {
        root.scrollTop = root.scrollHeight;
      }
    });
    ro.observe(messages);
    return () => ro.disconnect();
  }, [activeSessionId, Boolean(thread)]);

  // Context-mode switches remount / resize the message list. Keep the scroll
  // frame from auto-jumping to the bottom while the layout settles — but only
  // when the session itself did not change (session switch re-pins above).
  const contextViewPinRef = useRef({
    sessionId: activeSessionId,
    showArchiveDoc,
    threadView,
  });
  useEffect(() => {
    const prev = contextViewPinRef.current;
    contextViewPinRef.current = {
      sessionId: activeSessionId,
      showArchiveDoc,
      threadView,
    };
    if (prev.sessionId !== activeSessionId) return;
    if (
      prev.showArchiveDoc === showArchiveDoc &&
      prev.threadView === threadView
    ) {
      return;
    }
    stickToBottomRef.current = false;
  }, [activeSessionId, showArchiveDoc, threadView]);

  const captureScrollAnchor = useCallback(() => {
    const root = scrollRef.current;
    if (!root) return;
    const rootTop = root.getBoundingClientRect().top;
    const nodes = root.querySelectorAll<HTMLElement>("[data-msg-id]");
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (rect.bottom > rootTop + 12) {
        const id = node.dataset.msgId;
        if (!id) continue;
        scrollAnchorRef.current = {
          kind: "msg",
          id,
          top: rect.top - rootTop,
        };
        suppressEnterAnimRef.current = true;
        setSuppressEnterAnim(true);
        return;
      }
    }
    // Archive doc has no data-msg-id — keep absolute scrollTop.
    scrollAnchorRef.current = {
      kind: "scroll",
      scrollTop: root.scrollTop,
    };
    suppressEnterAnimRef.current = true;
    setSuppressEnterAnim(true);
  }, []);

  // After Archive ↔ Live/Evolution remounts, re-align the first shared message
  // so inserting/removing content above does not shove the viewport.
  useLayoutEffect(() => {
    const root = scrollRef.current;
    const anchor = scrollAnchorRef.current;
    if (!root || !anchor) return;

    if (anchor.kind === "msg") {
      const node = root.querySelector<HTMLElement>(
        `[data-msg-id="${CSS.escape(anchor.id)}"]`,
      );
      if (node) {
        const rootTop = root.getBoundingClientRect().top;
        const delta = node.getBoundingClientRect().top - rootTop - anchor.top;
        if (delta !== 0) root.scrollTop += delta;
      }
    } else {
      root.scrollTop = anchor.scrollTop;
    }
    scrollAnchorRef.current = null;

    if (suppressEnterAnimRef.current) {
      const t = window.setTimeout(() => {
        suppressEnterAnimRef.current = false;
        setSuppressEnterAnim(false);
      }, 50);
      return () => window.clearTimeout(t);
    }
  }, [showArchiveDoc, threadView, visibleMessages]);

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

  const openArchiveOnMain = (archiveId?: NodeId | null) => {
    const targetId =
      archiveId ??
      activeSession?.activeArchiveId ??
      archives[archives.length - 1]?.id ??
      null;
    if (!targetId) return;
    captureScrollAnchor();
    setContextMode("archive", targetId);
  };

  const dismissModeNotice = () => {
    setModeNotice(null);
    if (modeNoticeTimerRef.current) {
      window.clearTimeout(modeNoticeTimerRef.current);
      modeNoticeTimerRef.current = null;
    }
  };

  const switchToArchive = (archiveId?: NodeId) => {
    const targetId =
      archiveId ??
      activeSession?.activeArchiveId ??
      archives[archives.length - 1]?.id;
    if (!targetId) return;
    captureScrollAnchor();
    setContextMode("archive", targetId);
  };

  const switchToLiveConversation = () => {
    captureScrollAnchor();
    setContextMode("live");
    dismissModeNotice();
  };

  const switchToEvolution = () => {
    captureScrollAnchor();
    setThreadView("evolution");
  };

  const submit = () => {
    const saved = input.trim();
    if (!saved) return;
    const state = useAppStore.getState();
    const sid = state.activeSessionId;
    if (sid && state.loadingMainBySession[sid]) return;
    // Stale pending plans are cleared inside askMain so a new request can proceed.
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

  const startTitleRename = () => {
    if (!activeSessionId || !activeSession) return;
    setDraftTitle(displaySessionTitle(activeSession.title));
    setRenamingTitle(true);
  };

  const cancelTitleRename = () => {
    setRenamingTitle(false);
    setDraftTitle("");
  };

  const commitTitleRename = () => {
    if (!activeSessionId) return;
    const ok = renameSession(activeSessionId, draftTitle);
    if (ok) cancelTitleRename();
    else titleInputRef.current?.focus();
  };

  const handleTitleBlur = () => {
    if (skipTitleBlurCommit.current) {
      skipTitleBlurCommit.current = false;
      return;
    }
    commitTitleRename();
  };

  const handleTitleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitTitleRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      skipTitleBlurCommit.current = true;
      cancelTitleRename();
    }
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

          <InlineToolApproval scope={{ kind: "main" }} />
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
            leading={
              <>
                <NetworkAccessToggle disabled={composerBusy} />
                <SessionApiSettings disabled={composerBusy} />
              </>
            }
            projectRoot={projectRoot}
            sidecarUrl={sidecarUrl}
            includedFiles={pendingFileIncludes}
            onIncludeFile={addFileInclude}
            onRemoveInclude={removeFileInclude}
          />
          {error && <p className="ds-error">{error}</p>}
        </div>
      </main>
    );
  }

  const title = displaySessionTitle(activeSession?.title ?? "");

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
          {t("main.notesKicker") ? (
            <span className="fn-chat-kicker">{t("main.notesKicker")}</span>
          ) : null}
          <div className="fn-chat-title-row">
            {renamingTitle ? (
              <input
                ref={titleInputRef}
                className="fn-chat-title-input"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onKeyDown={handleTitleKey}
                onBlur={handleTitleBlur}
                aria-label={t("sidebar.renameAria")}
                maxLength={80}
              />
            ) : (
              <>
                <button
                  type="button"
                  className="btn ghost fn-chat-title-edit"
                  title={t("main.renameTitle")}
                  aria-label={t("sidebar.renameAria")}
                  onClick={startTitleRename}
                >
                  <TitleEditIcon />
                </button>
                <h1 className="fn-chat-title" title={title}>
                  {title}
                </h1>
              </>
            )}
          </div>
        </div>
        {thread ? (
          <div className="fn-chat-header-meta">
            <button
              type="button"
              className="fn-fork-chip"
              title={t("main.forksTitle")}
              aria-haspopup="dialog"
              aria-expanded={forkMapOpen}
              onClick={() => setForkMapOpen(true)}
            >
              {t("main.forks", { count: forkCount })}
            </button>
            <button
              type="button"
              className={`fn-view-mode-chip${sourceMode ? " is-source" : ""}`}
              title={
                sourceMode
                  ? t("main.viewMode.toReadingTitle")
                  : t("main.viewMode.toSourceTitle")
              }
              aria-label={t("main.viewMode.aria")}
              aria-pressed={sourceMode}
              onClick={() => {
                const next = sourceMode ? "reading" : "source";
                setThreadViewMode(setMainThreadViewMode(next));
              }}
            >
              <ViewModeIcon mode={threadViewMode} />
              <span>
                {sourceMode
                  ? t("main.viewMode.source")
                  : t("main.viewMode.reading")}
              </span>
            </button>
          </div>
        ) : null}
      </header>

      {thread ? (
        <ForkHistoryMap
          thread={thread}
          open={forkMapOpen}
          onClose={() => setForkMapOpen(false)}
          scrollRef={scrollRef}
        />
      ) : null}

      <div className="ds-chat-body">
        <div className="ds-chat-column">
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
                    <h2 className="fn-archive-base-title">
                      {t("main.archiving")}
                    </h2>
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
                        <div className="ds-typing" aria-label={t("archive.generatingAria")}>
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
                        onClick={switchToLiveConversation}
                      >
                        {t("main.liveConversation")}
                      </button>
                    </div>
                    <h2 className="fn-archive-base-title">
                      {activeArchive.title}
                    </h2>
                    <ArchivePathRow archive={activeArchive} />
                    <div className="answer-body">
                      {sourceMode ? (
                        <SourceBody content={activeArchive.content} />
                      ) : (
                        <MarkdownBody content={activeArchive.content} />
                      )}
                    </div>
                  </article>
                  <MessageActions
                    text={activeArchive.content}
                    align="start"
                  />
                </div>
              ) : null}
              {visibleMessages.map((msg) =>
                msg.role === "user" ? (
                  <div
                    key={msg.id}
                    data-msg-id={msg.id}
                    className="fn-msg fn-msg-user"
                  >
                    <MangaCloudBubble>
                      <p>{msg.content}</p>
                    </MangaCloudBubble>
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
                          loadingMain && msg.id === lastThreadMessageId
                        }
                      />
                    ) : null}
                    {showMainAgentActivity &&
                    msg.id === lastThreadMessageId ? (
                      <AgentActivityPanels />
                    ) : null}
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
                              onAskBranch={askBranch}
                              branchLoading={
                                loadingBranchId !== null ||
                                (loadingMain && msg.id === lastThreadMessageId)
                              }
                              contentStreaming={
                                loadingMain && msg.id === lastThreadMessageId
                              }
                              activeBranchId={openBranchId}
                              onToggleBranch={toggleBranch}
                              compact
                              pointVerdicts={msg.pointVerdicts}
                              pointDoubts={msg.pointDoubts}
                              pointAttributions={msg.pointAttributions}
                            />
                          )}
                        </div>
                        <MessageActions
                          text={msg.content}
                          align="start"
                          onCopy={() => recordPassiveCopy(msg.id)}
                        />
                      </>
                    ) : loadingMain && msg.id === lastThreadMessageId ? (
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
                    {pendingInline &&
                    (pendingInlineAssistantId
                      ? pendingInlineAssistantId === msg.id
                      : msg.id === lastThreadMessageId) ? (
                      <InlineToolApproval scope={{ kind: "main" }} />
                    ) : null}
                  </div>
                ),
              )}
              {pendingInline &&
              pendingInlineAssistantId &&
              !thread.messages.some((m) => m.id === pendingInlineAssistantId) ? (
                <InlineToolApproval scope={{ kind: "main" }} />
              ) : null}
            </div>
          </div>

          <footer className="ds-chat-footer">
            {pendingClarify ? (
              <div className="fn-context-banner fn-context-banner-footer" role="status">
                <p className="fn-context-banner-text">
                  {t("clarify.queued")}
                </p>
                <div className="fn-context-banner-actions">
                  <button
                    type="button"
                    className="fn-context-banner-btn is-quiet"
                    onClick={() => clearPendingClarify()}
                  >
                    {t("clarify.queuedCancel")}
                  </button>
                </div>
              </div>
            ) : null}
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
                    onClick={() => {
                      openArchiveOnMain(modeNotice.archiveId);
                      dismissModeNotice();
                    }}
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

            {showCompressSuggest && (
              <div
                className={`fn-context-banner fn-context-banner-footer${showCompressSuggestBanner ? "" : " is-placeholder"}`}
                role="status"
                aria-hidden={!showCompressSuggestBanner}
              >
                <p className="fn-context-banner-text">
                  {t("main.compressSuggestText")}
                </p>
                <div className="fn-context-banner-actions">
                  <button
                    type="button"
                    className="fn-context-banner-btn"
                    disabled={composerBusy || !showCompressSuggestBanner}
                    tabIndex={showCompressSuggestBanner ? undefined : -1}
                    onClick={() => {
                      if (activeSessionId) {
                        setCompressSuggestDismissedFor(activeSessionId);
                      }
                      void compressContext();
                    }}
                  >
                    {t("main.compressSuggestAction")}
                  </button>
                  <button
                    type="button"
                    className="fn-context-banner-btn is-quiet"
                    disabled={!showCompressSuggestBanner}
                    tabIndex={showCompressSuggestBanner ? undefined : -1}
                    onClick={() => {
                      if (activeSessionId) {
                        setCompressSuggestDismissedFor(activeSessionId);
                      }
                    }}
                  >
                    {t("main.compressSuggestDismiss")}
                  </button>
                </div>
              </div>
            )}

            {hasArchives && (
              <p
                className={`fn-context-composer-hint${inArchiveMode ? "" : " is-placeholder"}`}
                aria-hidden={!inArchiveMode}
              >
                {inArchiveMode
                  ? threadView === "evolution"
                    ? t("main.evolutionComposerHint")
                    : t("main.archiveComposerHint")
                  : "\u00a0"}
              </p>
            )}

            <div className="fn-composer-toolbar">
              <div className="fn-composer-toolbar-row">
                <ProjectStatusBar onOpenProject={onOpenProject} part="row" />

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
                        className={`fn-context-seg${!inArchiveMode ? " is-active" : ""}`}
                        aria-pressed={!inArchiveMode}
                        disabled={composerBusy}
                        title={t("main.liveConversationTitle")}
                        onClick={switchToLiveConversation}
                      >
                        {t("main.liveConversation")}
                      </button>
                      <button
                        type="button"
                        className={`fn-context-seg${inArchiveMode && threadView === "archive" ? " is-active" : ""}`}
                        aria-pressed={inArchiveMode && threadView === "archive"}
                        disabled={composerBusy}
                        title={t("main.archiveContextTitle")}
                        onClick={() => switchToArchive()}
                      >
                        {t("main.archiveContext")}
                      </button>
                      <button
                        type="button"
                        className={`fn-context-seg${inArchiveMode && threadView === "evolution" ? " is-active" : ""}`}
                        aria-pressed={inArchiveMode && threadView === "evolution"}
                        disabled={composerBusy || !inArchiveMode}
                        title={t("main.fullThreadTitle")}
                        onClick={switchToEvolution}
                      >
                        {t("main.fullThread")}
                      </button>
                    </div>

                    {archives.length > 0 && (
                      <div
                        className="fn-archive-history"
                        ref={archiveHistoryRef}
                      >
                        <button
                          type="button"
                          className={`fn-archive-btn fn-archive-history-btn${archiveHistoryOpen ? " is-open" : ""}`}
                          disabled={composerBusy}
                          aria-expanded={archiveHistoryOpen}
                          aria-haspopup="listbox"
                          title={t("main.archivesViewTitle")}
                          onClick={() => setArchiveHistoryOpen((open) => !open)}
                        >
                          {t("main.archiveHistory")}
                          <span className="fn-archive-history-caret" aria-hidden>
                            ▾
                          </span>
                        </button>
                        {archiveHistoryOpen ? (
                          <div
                            className="fn-context-menu fn-archive-history-menu"
                            role="listbox"
                            aria-label={t("main.archiveHistory")}
                          >
                            {[...archives].reverse().map((a) => {
                              const active = a.id === activeArchive?.id;
                              return (
                                <button
                                  key={a.id}
                                  type="button"
                                  role="option"
                                  aria-selected={active}
                                  className={`fn-context-menu-item${active ? " is-active" : ""}`}
                                  onClick={() => {
                                    switchToArchive(a.id);
                                    setArchiveHistoryOpen(false);
                                  }}
                                >
                                  <span className="fn-context-menu-title">
                                    {a.title}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                )}

                {hasThreadContent && (
                  <div className="fn-composer-memory-actions">
                    <button
                      type="button"
                      className="fn-archive-btn"
                      disabled={composerBusy}
                      title={t("main.memoryTitle")}
                      onClick={() => setSettingsOpen(true, "memory")}
                    >
                      {t("main.memory")}
                    </button>
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
            </div>

            <AgentPlanReview scope={{ kind: "main" }} />

            <ChatComposer
              value={input}
              onChange={setComposerValue}
              onSubmit={submit}
              onStop={handleStop}
              loading={composerBusy}
              compact
              leading={
              <>
                <NetworkAccessToggle disabled={composerBusy} />
                <SessionApiSettings disabled={composerBusy} />
              </>
            }
              projectRoot={projectRoot}
              sidecarUrl={sidecarUrl}
              includedFiles={pendingFileIncludes}
              onIncludeFile={addFileInclude}
              onRemoveInclude={removeFileInclude}
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
