import { create } from "zustand";
import {
  agentCallFromOpenAI,
  buildCodingToolsSystem,
  buildMinimalCreatePlanHint,
  buildPlanningPhaseSystem,
  collectToolCalls,
  executeToolCall,
  inferCreateFilePath,
  inferExploreIntent,
  inferMultiStepPlan,
  inferOfficeCreateIntent,
  multiStepFollowUpHint,
  multiStepSystemHint,
  parseAgentPlan,
  planNeedsToolApproval,
  synthesizeExploreToolCall,
  synthesizeOfficeFromIntent,
  nativeToolResultMessage,
  PROJECT_OPENAI_TOOLS,
  stripToolCalls,
  synthesizeWriteFromReply,
  toolResultMessage,
  type AgentActivity,
  type AgentFileChange,
  type AgentToolCall,
} from "../lib/agentTools";
import {
  resolveAgentMaxRounds,
  resolveAgentRequireApproval,
} from "../lib/settings";
import {
  archiveSystemPrompt,
  archiveTitleFromContent,
  archiveUserPrompt,
  buildArchiveSource,
  lastNonEmptyMessageId,
} from "../lib/archive";
import { resolveConversationContext } from "../lib/conversationContext";
import { buildBranchQuestionMessages, buildConversationMessages } from "../lib/contextBuilder";
import { getLocale, t } from "../lib/i18n";
import { createId } from "../lib/id";
import {
  buildAgentMemoryAddendum,
  buildCompressSource,
  compressChatMessages,
  isCompressAfterArchiveEnabled,
  loadContextMemoryPack,
  packThroughMessageId,
  parseCompressedOutput,
  saveContextMemoryPack,
} from "../lib/contextMemory";
import {
  isToolsUnsupportedError,
  streamChat,
  type ChatMessage as ApiChatMessage,
  type ToolCall,
} from "../lib/openai";
import { mergeReasoningChannels } from "../lib/reasoning";
import { loadProjectPrefs, saveProjectPrefs } from "../lib/project";
import {
  flushActiveSession,
  patchSessionProject,
} from "../lib/sessionProject";
import {
  closeProject as sidecarCloseProject,
  openProject as sidecarOpenProject,
} from "../lib/sidecar";
import {
  createEmptySession,
  loadSessionStore,
  saveSessionStore,
  sessionTitleFromThread,
} from "../lib/storage";
import { patchSessionApi, settingsForSession } from "../lib/sessionApi";
import {
  isLikelyLocalEndpoint,
  isValidApiBaseUrl,
  loadSettings,
} from "../lib/settings";
import {
  appendBranchToMessage,
  findAssistantMessageForBranch,
  findBranchInThread,
  normalizeThread,
  patchBranchInThread,
  patchMessage,
} from "../lib/thread";
import {
  nextFloatZIndex,
  popBranchFloat,
  pushBranchFloat,
  type BranchFloatEntry,
} from "../lib/branchFloat";
import type {
  Anchor,
  ApiSettings,
  ArchiveSnapshot,
  BranchNode,
  ChatMessage,
  ChatSession,
  ContextMemoryPack,
  ContextMode,
  FocusTarget,
  NodeId,
  AgentPendingPlan,
  PointDoubtMap,
  PointVerdict,
  PointVerdictMap,
  SessionStore,
  SessionApiOverride,
  SettingsTab,
  ThreadRoot,
} from "../types";

interface AppState {
  sessions: ChatSession[];
  activeSessionId: NodeId | null;
  thread: ThreadRoot | null;
  settings: ApiSettings;
  settingsOpen: boolean;
  /** Active category inside System settings modal */
  settingsTab: SettingsTab;
  projectOpen: boolean;
  focus: FocusTarget;
  /** Sessions currently generating a main-thread answer (keyed by session id). */
  loadingMainBySession: Record<NodeId, boolean>;
  /** In-flight branch id per session (keyed by session id). */
  loadingBranchBySession: Record<NodeId, NodeId>;
  /** Session currently streaming an archive draft, if any. */
  loadingArchiveSessionId: NodeId | null;
  /** Session currently compressing context, if any. */
  loadingCompressSessionId: NodeId | null;
  archivePanelOpen: boolean;
  viewingArchiveId: NodeId | null;
  /** Streaming draft while archiveCurrent runs */
  archiveDraft: string;
  error: string | null;
  branchFloatStack: BranchFloatEntry[];
  /** 递增后关闭所有划选追问浮层 */
  floatOverlayDismissToken: number;

  /** Bound local project absolute path (via sidecar), or null */
  projectRoot: string | null;
  sidecarUrl: string;
  projectError: string | null;
  agentActivity: AgentActivity[];
  agentChanges: AgentFileChange[];
  /** Plan awaiting user approval before tool execution (project agent). */
  agentPendingPlan: AgentPendingPlan | null;

  init: () => void;
  setSettings: (settings: ApiSettings) => void;
  setSettingsOpen: (open: boolean, tab?: SettingsTab) => void;
  setSettingsTab: (tab: SettingsTab) => void;
  setProjectOpen: (open: boolean) => void;
  setSidecarUrl: (url: string) => void;
  openProject: (absPath: string, quiet?: boolean) => Promise<void>;
  disconnectProject: () => void;
  clearAgentLog: () => void;
  /** Approve pending agent plan and run tools. */
  approveAgentPlan: () => Promise<void>;
  /** Reject pending agent plan and roll back the turn. */
  rejectAgentPlan: () => void;
  setFocus: (focus: FocusTarget) => void;
  clearError: () => void;
  /** Abort in-flight generation. Returns the stopped main prompt to restore in the composer. */
  stopGeneration: () => string | null;
  archiveCurrent: () => Promise<void>;
  /**
   * Compress thread → SUMMARY.md + TASKS.md + DECISIONS.md
   * (project disk when bound, else session localStorage).
   */
  compressContext: () => Promise<void>;
  setContextMode: (mode: ContextMode, archiveId?: NodeId | null) => void;
  setArchivePanelOpen: (open: boolean) => void;
  setViewingArchiveId: (id: NodeId | null) => void;
  deleteArchive: (archiveId: NodeId) => void;
  /**
   * 对主消息或分支回答中的某个分点设置裁决；再次点击同一裁决则清除（回到默认采纳）。
   * 切换离开存疑时会清掉对应 doubt。
   */
  setPointVerdict: (
    targetId: NodeId,
    pointIndex: number,
    verdict: PointVerdict,
  ) => void;
  /**
   * 写入存疑文案。非空 → 保持/设为 unsure；空串 → 取消存疑（回到默认采纳）。
   */
  setPointDoubt: (
    targetId: NodeId,
    pointIndex: number,
    doubt: string,
  ) => void;

  openBranchFloat: (
    branchId: NodeId,
    rect: DOMRect,
    parentBranchId?: NodeId | null,
  ) => void;
  closeBranchFloat: (branchId: NodeId) => void;
  closeAllBranchFloats: () => void;

  createSession: () => void;
  switchSession: (sessionId: NodeId) => void;
  deleteSession: (sessionId: NodeId) => void;
  /** Replace all notes with a single empty session (localStorage). */
  clearAllSessions: () => void;
  /** Replace the in-memory + persisted session store (e.g. after import). */
  replaceSessionStore: (store: SessionStore) => void;
  /** 重命名笔记；空标题拒绝。成功后锁定标题，不再被自动覆盖 */
  renameSession: (sessionId: NodeId, title: string) => boolean;
  /** Set the model for the active session (snapshotted; empty clears to inherit settings). */
  setSessionApi: (api: SessionApiOverride | null) => void;
  clearSessionApi: () => void;

  askMain: (question: string) => Promise<"started" | "rejected" | "rolled_back">;
  askBranch: (
    parentId: NodeId,
    parentContent: string,
    anchor: Anchor,
    question: string,
  ) => Promise<NodeId | void>;
}

function getActiveSession(state: AppState): ChatSession | undefined {
  return state.sessions.find((s) => s.id === state.activeSessionId);
}

function persistSessions(
  sessions: ChatSession[],
  activeSessionId: NodeId | null,
): void {
  saveSessionStore({ sessions, activeSessionId });
}

function upsertActiveSession(
  sessions: ChatSession[],
  activeSessionId: NodeId | null,
  thread: ThreadRoot | null,
): ChatSession[] {
  if (!activeSessionId) return sessions;
  const now = Date.now();
  const normalized = thread ? normalizeThread(thread) : null;
  return sessions.map((s) =>
    s.id === activeSessionId
      ? {
          ...s,
          thread: normalized,
          // 用户重命名过的标题不再被首条消息覆盖
          title: s.titleLocked ? s.title : sessionTitleFromThread(normalized),
          updatedAt: now,
        }
      : s,
  );
}

/** Patch session fields (archives / context mode / memory) without replacing the thread. */
function patchActiveSessionMeta(
  sessions: ChatSession[],
  activeSessionId: NodeId | null,
  patch: Partial<
    Pick<
      ChatSession,
      "archives" | "contextMode" | "activeArchiveId" | "contextMemory"
    >
  >,
): ChatSession[] {
  if (!activeSessionId) return sessions;
  const now = Date.now();
  return sessions.map((s) =>
    s.id === activeSessionId ? { ...s, ...patch, updatedAt: now } : s,
  );
}

/** Sync sidecar to a session's bound project; ignores stale session switches. */
function restoreSessionProject(
  get: () => AppState,
  set: (
    partial:
      | Partial<AppState>
      | ((state: AppState) => Partial<AppState>),
  ) => void,
  sessionId: NodeId,
  projectRoot: string | null,
  sidecarUrl: string,
): void {
  const apply = (root: string | null, projectError: string | null) => {
    if (get().activeSessionId !== sessionId) return;
    set({
      projectRoot: root,
      projectError,
      agentActivity: [],
      agentChanges: [],
    });
  };

  if (!projectRoot) {
    void sidecarCloseProject(sidecarUrl)
      .catch(() => undefined)
      .finally(() => apply(null, null));
    return;
  }

  void sidecarOpenProject(projectRoot, sidecarUrl)
    .then(({ root }) => apply(root, null))
    .catch((e) =>
      apply(null, e instanceof Error ? e.message : "Could not reach sidecar"),
    );
}

function appendChild(
  nodes: BranchNode[],
  parentId: NodeId,
  child: BranchNode,
): BranchNode[] {
  if (nodes.some((n) => n.id === parentId)) {
    return nodes.map((n) =>
      n.id === parentId ? { ...n, children: [...n.children, child] } : n,
    );
  }
  return nodes.map((n) => ({
    ...n,
    children: appendChild(n.children, parentId, child),
  }));
}

// Module-level abort controllers — not in Zustand state (no re-render needed).
// Main / branch work is keyed by session so sessions can generate independently.
type MainTurn = {
  userId: NodeId;
  assistantId: NodeId;
  prompt: string;
  ctrl: AbortController;
};
const mainTurnsBySession = new Map<NodeId, MainTurn>();
const branchAbortBySession = new Map<
  NodeId,
  { ctrl: AbortController; branchId: NodeId }
>();
let archiveAbortCtrl: AbortController | null = null;
let archiveAbortSessionId: NodeId | null = null;
let compressAbortCtrl: AbortController | null = null;
let compressAbortSessionId: NodeId | null = null;

function isAbortError(e: unknown): boolean {
  return (
    (e instanceof Error && e.name === "AbortError") ||
    (typeof DOMException !== "undefined" &&
      e instanceof DOMException &&
      e.name === "AbortError")
  );
}

/** Resume tool execution after the user approves a pending plan (per session). */
const pendingAgentContinuations = new Map<NodeId, () => Promise<void>>();

function clearPendingAgentPlan(
  set: (
    partial:
      | Partial<AppState>
      | ((state: AppState) => Partial<AppState>),
  ) => void,
  sessionId?: NodeId | null,
): void {
  if (sessionId) {
    pendingAgentContinuations.delete(sessionId);
    set((state) =>
      state.agentPendingPlan?.sessionId === sessionId
        ? { agentPendingPlan: null }
        : {},
    );
    return;
  }
  pendingAgentContinuations.clear();
  set({ agentPendingPlan: null });
}

function setSessionMainLoading(
  set: (
    partial:
      | Partial<AppState>
      | ((state: AppState) => Partial<AppState>),
  ) => void,
  sessionId: NodeId,
  loading: boolean,
): void {
  set((state) => {
    const next = { ...state.loadingMainBySession };
    if (loading) next[sessionId] = true;
    else delete next[sessionId];
    return { loadingMainBySession: next };
  });
}

function setSessionBranchLoading(
  set: (
    partial:
      | Partial<AppState>
      | ((state: AppState) => Partial<AppState>),
  ) => void,
  sessionId: NodeId,
  branchId: NodeId | null,
): void {
  set((state) => {
    const next = { ...state.loadingBranchBySession };
    if (branchId) next[sessionId] = branchId;
    else delete next[sessionId];
    return { loadingBranchBySession: next };
  });
}

/** Thread for a session: live store thread when active, else persisted session.thread. */
function getSessionThread(
  get: () => AppState,
  sessionId: NodeId,
): ThreadRoot | null {
  const state = get();
  if (state.activeSessionId === sessionId) {
    return state.thread;
  }
  const session = state.sessions.find((s) => s.id === sessionId);
  return session?.thread ? normalizeThread(session.thread) : null;
}

/** Persist a session thread without clobbering another session's live view. */
function commitSessionThread(
  get: () => AppState,
  set: (
    partial:
      | Partial<AppState>
      | ((state: AppState) => Partial<AppState>),
  ) => void,
  sessionId: NodeId,
  next: ThreadRoot | null,
): void {
  const state = get();
  const updatedSessions = upsertActiveSession(state.sessions, sessionId, next);
  persistSessions(updatedSessions, state.activeSessionId);
  if (state.activeSessionId === sessionId) {
    set({ thread: next, sessions: updatedSessions });
  } else {
    set({ sessions: updatedSessions });
  }
}

function abortSessionGeneration(sessionId: NodeId): string | null {
  const turn = mainTurnsBySession.get(sessionId);
  const branch = branchAbortBySession.get(sessionId);
  turn?.ctrl.abort();
  branch?.ctrl.abort();
  if (archiveAbortSessionId === sessionId) {
    archiveAbortCtrl?.abort();
    archiveAbortCtrl = null;
    archiveAbortSessionId = null;
  }
  if (compressAbortSessionId === sessionId) {
    compressAbortCtrl?.abort();
    compressAbortCtrl = null;
    compressAbortSessionId = null;
  }
  mainTurnsBySession.delete(sessionId);
  branchAbortBySession.delete(sessionId);
  pendingAgentContinuations.delete(sessionId);
  return turn?.prompt ?? null;
}

function abortAllGenerations(): void {
  for (const id of [...mainTurnsBySession.keys()]) {
    abortSessionGeneration(id);
  }
  for (const id of [...branchAbortBySession.keys()]) {
    abortSessionGeneration(id);
  }
  archiveAbortCtrl?.abort();
  archiveAbortCtrl = null;
  archiveAbortSessionId = null;
  compressAbortCtrl?.abort();
  compressAbortCtrl = null;
  compressAbortSessionId = null;
  pendingAgentContinuations.clear();
}

/** Reject when `signal` aborts so tool fetches can be interrupted promptly. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

function rollbackMainTurn(
  get: () => AppState,
  set: (
    partial:
      | Partial<AppState>
      | ((state: AppState) => Partial<AppState>),
  ) => void,
  turn: { userId: NodeId; assistantId: NodeId; sessionId: NodeId },
): void {
  const current = getSessionThread(get, turn.sessionId);
  if (!current) return;
  const msgs = current.messages;
  const last = msgs[msgs.length - 1];
  const prev = msgs[msgs.length - 2];
  if (last?.id !== turn.assistantId || prev?.id !== turn.userId) return;

  const remaining = msgs.slice(0, -2);
  const nextThread: ThreadRoot | null =
    remaining.length === 0 ? null : { ...current, messages: remaining };
  commitSessionThread(get, set, turn.sessionId, nextThread);
  if (get().activeSessionId === turn.sessionId) {
    set({ agentActivity: [], agentChanges: [] });
  }
}

function requireApiKey(settings: ApiSettings): string | null {
  const locale = getLocale();
  if (!settings.baseUrl.trim()) {
    return t("api.missingBaseUrl", undefined, locale);
  }
  if (!isValidApiBaseUrl(settings.baseUrl)) {
    return t("api.invalidBaseUrl", undefined, locale);
  }
  if (!settings.model.trim()) {
    return t("api.missingModel", undefined, locale);
  }
  if (settings.apiKey.trim() || isLikelyLocalEndpoint(settings.baseUrl)) {
    return null;
  }
  return t("api.missingKey", undefined, locale);
}

export const useAppStore = create<AppState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  thread: null,
  settings: loadSettings(),
  settingsOpen: false,
  settingsTab: "general",
  projectOpen: false,
  focus: { type: "root" },
  loadingMainBySession: {},
  loadingBranchBySession: {},
  loadingArchiveSessionId: null,
  loadingCompressSessionId: null,
  archivePanelOpen: false,
  viewingArchiveId: null,
  archiveDraft: "",
  error: null,
  branchFloatStack: [],
  floatOverlayDismissToken: 0,
  projectRoot: null,
  sidecarUrl: loadProjectPrefs().sidecarUrl,
  projectError: null,
  agentActivity: [],
  agentChanges: [],
  agentPendingPlan: null,

  init: () => {
    const store = loadSessionStore();
    const active =
      store.sessions.find((s) => s.id === store.activeSessionId) ??
      store.sessions[0];
    const thread = active?.thread ? normalizeThread(active.thread) : null;
    const prefs = loadProjectPrefs();
    const sessionProject = active?.projectRoot?.trim() || null;
    set({
      sessions: store.sessions,
      activeSessionId: active?.id ?? null,
      thread,
      sidecarUrl: prefs.sidecarUrl,
      projectRoot: sessionProject,
      projectError: null,
      agentActivity: [],
      agentChanges: [],
    });
    if (active?.id) {
      restoreSessionProject(
        get,
        set,
        active.id,
        sessionProject,
        prefs.sidecarUrl,
      );
    }
  },

  setSettings: (settings) => set({ settings }),
  setSettingsOpen: (open, tab) =>
    set({
      settingsOpen: open,
      ...(tab ? { settingsTab: tab } : {}),
    }),
  setSettingsTab: (tab) => set({ settingsTab: tab }),
  setProjectOpen: (open) => set({ projectOpen: open }),
  setSidecarUrl: (url) => {
    const next = url.trim() || "/sidecar";
    saveProjectPrefs({ sidecarUrl: next });
    set({ sidecarUrl: next });
  },
  openProject: async (absPath, quiet = false) => {
    const path = absPath.trim();
    if (!path) {
      if (!quiet) set({ projectError: "Enter a project absolute path" });
      return;
    }
    // Bind to the session that initiated Connect — ignore UI if user switches mid-await.
    const { sidecarUrl, activeSessionId: bindingSessionId } = get();
    try {
      const { root } = await sidecarOpenProject(path, sidecarUrl);
      saveProjectPrefs({ lastPath: root, sidecarUrl });
      const { sessions, activeSessionId } = get();
      const nextSessions = patchSessionProject(
        sessions,
        bindingSessionId,
        root,
      );
      persistSessions(nextSessions, activeSessionId);
      if (activeSessionId === bindingSessionId) {
        set({
          sessions: nextSessions,
          projectRoot: root,
          projectError: null,
          agentActivity: [],
          agentChanges: [],
        });
      } else {
        set({ sessions: nextSessions });
      }
    } catch (e) {
      const { sessions, activeSessionId } = get();
      const nextSessions = patchSessionProject(
        sessions,
        bindingSessionId,
        null,
      );
      persistSessions(nextSessions, activeSessionId);
      if (activeSessionId === bindingSessionId) {
        set({
          sessions: nextSessions,
          projectRoot: null,
          projectError: quiet
            ? null
            : e instanceof Error
              ? e.message
              : "Could not reach sidecar (run npm run sidecar first)",
        });
      } else {
        set({ sessions: nextSessions });
      }
    }
  },
  disconnectProject: () => {
    const { sidecarUrl, activeSessionId, sessions } = get();
    void sidecarCloseProject(sidecarUrl).catch(() => undefined);
    const nextSessions = patchSessionProject(sessions, activeSessionId, null);
    persistSessions(nextSessions, activeSessionId);
    set({
      sessions: nextSessions,
      projectRoot: null,
      projectError: null,
      agentActivity: [],
      agentChanges: [],
    });
  },
  clearAgentLog: () => set({ agentActivity: [], agentChanges: [] }),

  approveAgentPlan: async () => {
    const plan = get().agentPendingPlan;
    const sessionId = plan?.sessionId;
    if (!plan || !sessionId) return;
    if (get().activeSessionId !== sessionId) return;
    const cont = pendingAgentContinuations.get(sessionId);
    if (!cont) return;

    clearPendingAgentPlan(set, sessionId);
    setSessionMainLoading(set, sessionId, true);
    set({ error: null });

    try {
      await cont();
    } catch (e) {
      if (!isAbortError(e)) {
        set({
          error: e instanceof Error ? e.message : "Agent execution failed",
        });
      }
    } finally {
      mainTurnsBySession.delete(sessionId);
      setSessionMainLoading(set, sessionId, false);
    }
  },

  rejectAgentPlan: () => {
    const plan = get().agentPendingPlan;
    if (!plan) return;
    if (get().activeSessionId !== plan.sessionId) return;
    // Dismiss the approval bar only — keep the user's message (and the plan
    // reply in chat) so Cancel never erases their question.
    clearPendingAgentPlan(set, plan.sessionId);
    mainTurnsBySession.delete(plan.sessionId);
    setSessionMainLoading(set, plan.sessionId, false);
  },

  setFocus: (focus) => set({ focus }),
  clearError: () => set({ error: null }),

  stopGeneration: () => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return null;

    const turn = mainTurnsBySession.get(sessionId);
    const branch = branchAbortBySession.get(sessionId);
    const archiveOwned = archiveAbortSessionId === sessionId;
    const compressOwned = compressAbortSessionId === sessionId;
    const archiveCtrl = archiveOwned ? archiveAbortCtrl : null;
    const compressCtrl = compressOwned ? compressAbortCtrl : null;

    // Abort first so in-flight fetch/reader/tool calls start unwinding
    turn?.ctrl.abort();
    branch?.ctrl.abort();
    archiveCtrl?.abort();
    compressCtrl?.abort();

    if (get().agentPendingPlan?.sessionId === sessionId) {
      clearPendingAgentPlan(set, sessionId);
    }

    // Roll back the incomplete main turn immediately (don't wait for hung finally)
    if (turn) {
      rollbackMainTurn(get, set, { ...turn, sessionId });
      mainTurnsBySession.delete(sessionId);
    }

    branchAbortBySession.delete(sessionId);
    if (archiveOwned) {
      archiveAbortCtrl = null;
      archiveAbortSessionId = null;
    }
    if (compressOwned) {
      compressAbortCtrl = null;
      compressAbortSessionId = null;
    }
    setSessionMainLoading(set, sessionId, false);
    setSessionBranchLoading(set, sessionId, null);
    set((state) => ({
      ...(state.loadingArchiveSessionId === sessionId
        ? { loadingArchiveSessionId: null, archiveDraft: "" }
        : {}),
      ...(state.loadingCompressSessionId === sessionId
        ? { loadingCompressSessionId: null }
        : {}),
    }));
    return turn?.prompt ?? null;
  },

  setArchivePanelOpen: (open) => {
    set({
      archivePanelOpen: open,
      ...(open
        ? {}
        : {
            archiveDraft:
              get().loadingArchiveSessionId != null ? get().archiveDraft : "",
          }),
    });
  },

  setViewingArchiveId: (id) => set({ viewingArchiveId: id }),

  setContextMode: (mode, archiveId) => {
    const { sessions, activeSessionId } = get();
    if (!activeSessionId) return;

    const session = getActiveSession(get());
    let nextArchiveId: NodeId | null | undefined = archiveId;
    if (mode === "live") {
      nextArchiveId = null;
    } else if (mode === "archive") {
      if (nextArchiveId === undefined) {
        nextArchiveId =
          session?.activeArchiveId ??
          session?.archives?.[session.archives.length - 1]?.id ??
          null;
      }
      if (!nextArchiveId) return;
      const exists = session?.archives?.some((a) => a.id === nextArchiveId);
      if (!exists) return;
    }

    const nextSessions = patchActiveSessionMeta(sessions, activeSessionId, {
      contextMode: mode,
      activeArchiveId: nextArchiveId ?? null,
    });
    persistSessions(nextSessions, activeSessionId);
    set({
      sessions: nextSessions,
      viewingArchiveId:
        mode === "archive" && nextArchiveId
          ? nextArchiveId
          : get().viewingArchiveId,
    });
  },

  deleteArchive: (archiveId) => {
    const { sessions, activeSessionId, viewingArchiveId } = get();
    if (!activeSessionId) return;
    const session = getActiveSession(get());
    if (!session?.archives?.length) return;

    const archives = session.archives.filter((a) => a.id !== archiveId);
    const wasActive = session.activeArchiveId === archiveId;
    const nextSessions = patchActiveSessionMeta(sessions, activeSessionId, {
      archives,
      ...(wasActive
        ? { contextMode: "live" as const, activeArchiveId: null }
        : {}),
    });
    persistSessions(nextSessions, activeSessionId);
    set({
      sessions: nextSessions,
      viewingArchiveId:
        viewingArchiveId === archiveId
          ? archives[archives.length - 1]?.id ?? null
          : viewingArchiveId,
    });
  },

  archiveCurrent: async () => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;
    if (
      get().loadingArchiveSessionId === sessionId ||
      get().loadingMainBySession[sessionId] ||
      get().loadingCompressSessionId === sessionId
    ) {
      return;
    }

    const { settings, thread } = get();
    if (!thread) return;

    const hasContent = thread.messages.some((m) => m.content.trim());
    if (!hasContent) return;

    const throughMessageId = lastNonEmptyMessageId(thread);
    if (!throughMessageId) return;

    const llm = settingsForSession(settings, getActiveSession(get()));
    const authError = requireApiKey(llm);
    if (authError) {
      set({ error: authError, settingsOpen: true, settingsTab: "api" });
      return;
    }

    const source = buildArchiveSource(thread);
    if (!source.trim()) return;

    if (archiveAbortSessionId === sessionId) {
      archiveAbortCtrl?.abort();
    }
    const ctrl = new AbortController();
    archiveAbortCtrl = ctrl;
    archiveAbortSessionId = sessionId;

    set({
      loadingArchiveSessionId: sessionId,
      archivePanelOpen: true,
      archiveDraft: "",
      viewingArchiveId: null,
      error: null,
    });

    try {
      let content = "";
      const locale = getLocale();
      await streamChat(
        llm,
        [
          { role: "system", content: archiveSystemPrompt(locale) },
          {
            role: "user",
            content: archiveUserPrompt(source, locale),
          },
        ],
        (delta) => {
          if (
            archiveAbortCtrl !== ctrl ||
            archiveAbortSessionId !== sessionId ||
            ctrl.signal.aborted
          ) {
            return;
          }
          content += delta;
          if (get().activeSessionId === sessionId) {
            set({ archiveDraft: content });
          }
        },
        { signal: ctrl.signal, temperature: 0.3 },
      );

      if (ctrl.signal.aborted) return;

      const trimmed = content.trim();
      if (!trimmed) {
        set({ error: "Archive came back empty — try again" });
        return;
      }

      const snapshot: ArchiveSnapshot = {
        id: createId(),
        createdAt: Date.now(),
        title: archiveTitleFromContent(trimmed, "Dev log draft"),
        content: trimmed,
        throughMessageId,
      };

      const { sessions } = get();
      const session = sessions.find((s) => s.id === sessionId);
      const archives = [...(session?.archives ?? []), snapshot];
      const nextSessions = patchActiveSessionMeta(sessions, sessionId, {
        archives,
        contextMode: "archive",
        activeArchiveId: snapshot.id,
      });
      persistSessions(nextSessions, get().activeSessionId);
      set({
        sessions: nextSessions,
        ...(get().activeSessionId === sessionId
          ? {
              viewingArchiveId: snapshot.id,
              archiveDraft: "",
              archivePanelOpen: true,
            }
          : {}),
      });

      if (isCompressAfterArchiveEnabled(settings)) {
        // Fire after archive UI settles; compress uses its own loading flag
        if (get().activeSessionId === sessionId) {
          void get().compressContext();
        }
      }
    } catch (e) {
      if (!isAbortError(e)) {
        set({
          error: e instanceof Error ? e.message : "Archive request failed",
        });
      }
    } finally {
      if (archiveAbortCtrl === ctrl) {
        archiveAbortCtrl = null;
        archiveAbortSessionId = null;
        set((state) =>
          state.loadingArchiveSessionId === sessionId
            ? { loadingArchiveSessionId: null }
            : {},
        );
      }
    }
  },

  compressContext: async () => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;
    if (
      get().loadingCompressSessionId === sessionId ||
      get().loadingMainBySession[sessionId] ||
      get().loadingArchiveSessionId === sessionId
    ) {
      return;
    }

    const { settings, thread, projectRoot, sidecarUrl } = get();
    if (!thread) return;

    const hasContent = thread.messages.some((m) => m.content.trim());
    if (!hasContent) return;

    const llm = settingsForSession(settings, getActiveSession(get()));
    const authError = requireApiKey(llm);
    if (authError) {
      set({ error: authError, settingsOpen: true, settingsTab: "api" });
      return;
    }

    const source = buildCompressSource(thread);
    if (!source.trim()) return;

    if (compressAbortSessionId === sessionId) {
      compressAbortCtrl?.abort();
    }
    const ctrl = new AbortController();
    compressAbortCtrl = ctrl;
    compressAbortSessionId = sessionId;

    set({ loadingCompressSessionId: sessionId, error: null });

    try {
      const session = get().sessions.find((s) => s.id === sessionId);
      const existing = await loadContextMemoryPack({
        settings,
        session,
        projectRoot,
        sidecarUrl,
        signal: ctrl.signal,
      });

      let content = "";
      const locale = getLocale();
      await streamChat(
        llm,
        compressChatMessages(source, existing, locale),
        (delta) => {
          if (
            compressAbortCtrl !== ctrl ||
            compressAbortSessionId !== sessionId ||
            ctrl.signal.aborted
          ) {
            return;
          }
          content += delta;
        },
        { signal: ctrl.signal, temperature: 0.3 },
      );

      if (ctrl.signal.aborted) return;

      const parsed = parseCompressedOutput(content);
      if (
        !parsed.summary.trim() &&
        !parsed.tasks.trim() &&
        !parsed.decisions.trim()
      ) {
        set({ error: "Context compress came back empty — try again" });
        return;
      }

      const sessionThread = getSessionThread(get, sessionId);
      if (!sessionThread) return;
      const throughMessageId = packThroughMessageId(sessionThread) ?? undefined;
      const draft: ContextMemoryPack = {
        ...parsed,
        throughMessageId,
      };

      const saved = await saveContextMemoryPack({
        pack: draft,
        settings,
        projectRoot,
        sidecarUrl,
        signal: ctrl.signal,
      });

      if (ctrl.signal.aborted) return;

      const nextSessions = patchActiveSessionMeta(get().sessions, sessionId, {
        contextMemory: saved,
      });
      persistSessions(nextSessions, get().activeSessionId);
      set({ sessions: nextSessions });
    } catch (e) {
      if (!isAbortError(e)) {
        set({
          error:
            e instanceof Error ? e.message : "Context compress request failed",
        });
      }
    } finally {
      if (compressAbortCtrl === ctrl) {
        compressAbortCtrl = null;
        compressAbortSessionId = null;
        set((state) =>
          state.loadingCompressSessionId === sessionId
            ? { loadingCompressSessionId: null }
            : {},
        );
      }
    }
  },

  setPointVerdict: (targetId, pointIndex, verdict) => {
    const { thread, sessions, activeSessionId } = get();
    if (!thread) return;

    const apply = (
      currentVerdicts: PointVerdictMap | undefined,
      currentDoubts: PointDoubtMap | undefined,
    ): { pointVerdicts: PointVerdictMap; pointDoubts: PointDoubtMap } => {
      const nextVerdicts = { ...(currentVerdicts ?? {}) };
      const nextDoubts = { ...(currentDoubts ?? {}) };
      if (nextVerdicts[pointIndex] === verdict) {
        delete nextVerdicts[pointIndex];
        delete nextDoubts[pointIndex];
      } else {
        nextVerdicts[pointIndex] = verdict;
        if (verdict !== "unsure") {
          delete nextDoubts[pointIndex];
        }
      }
      return { pointVerdicts: nextVerdicts, pointDoubts: nextDoubts };
    };

    let nextThread: ThreadRoot;
    const msg = thread.messages.find((m) => m.id === targetId);
    if (msg) {
      nextThread = patchMessage(
        thread,
        targetId,
        apply(msg.pointVerdicts, msg.pointDoubts),
      );
    } else {
      const branch = findBranchInThread(thread, targetId);
      if (!branch) return;
      nextThread = patchBranchInThread(
        thread,
        targetId,
        apply(branch.pointVerdicts, branch.pointDoubts),
      );
    }

    const nextSessions = upsertActiveSession(
      sessions,
      activeSessionId,
      nextThread,
    );
    persistSessions(nextSessions, activeSessionId);
    set({ thread: nextThread, sessions: nextSessions });
  },

  setPointDoubt: (targetId, pointIndex, doubt) => {
    const { thread, sessions, activeSessionId } = get();
    if (!thread) return;

    const trimmed = doubt.trim();

    const apply = (
      currentVerdicts: PointVerdictMap | undefined,
      currentDoubts: PointDoubtMap | undefined,
    ): { pointVerdicts: PointVerdictMap; pointDoubts: PointDoubtMap } => {
      const nextVerdicts = { ...(currentVerdicts ?? {}) };
      const nextDoubts = { ...(currentDoubts ?? {}) };
      if (trimmed) {
        nextVerdicts[pointIndex] = "unsure";
        nextDoubts[pointIndex] = trimmed;
      } else {
        delete nextVerdicts[pointIndex];
        delete nextDoubts[pointIndex];
      }
      return { pointVerdicts: nextVerdicts, pointDoubts: nextDoubts };
    };

    let nextThread: ThreadRoot;
    const msg = thread.messages.find((m) => m.id === targetId);
    if (msg) {
      nextThread = patchMessage(
        thread,
        targetId,
        apply(msg.pointVerdicts, msg.pointDoubts),
      );
    } else {
      const branch = findBranchInThread(thread, targetId);
      if (!branch) return;
      nextThread = patchBranchInThread(
        thread,
        targetId,
        apply(branch.pointVerdicts, branch.pointDoubts),
      );
    }

    const nextSessions = upsertActiveSession(
      sessions,
      activeSessionId,
      nextThread,
    );
    persistSessions(nextSessions, activeSessionId);
    set({ thread: nextThread, sessions: nextSessions });
  },

  openBranchFloat: (branchId, rect, parentBranchId = null) => {
    if (typeof document !== "undefined") {
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
    set((state) => {
      const zIndex = nextFloatZIndex(state.branchFloatStack);
      return {
        branchFloatStack: pushBranchFloat(
          state.branchFloatStack,
          branchId,
          rect,
          parentBranchId,
          zIndex,
        ),
        floatOverlayDismissToken: state.floatOverlayDismissToken + 1,
      };
    });
  },

  closeBranchFloat: (branchId) => {
    set((state) => ({
      branchFloatStack: popBranchFloat(state.branchFloatStack, branchId),
    }));
  },

  closeAllBranchFloats: () =>
    set((state) => ({
      branchFloatStack: [],
      floatOverlayDismissToken: state.floatOverlayDismissToken + 1,
    })),

  createSession: () => {
    const { sessions, activeSessionId, thread, projectRoot, sidecarUrl } =
      get();
    let nextSessions = flushActiveSession(
      sessions,
      activeSessionId,
      thread,
      projectRoot,
      upsertActiveSession,
    );
    const session = createEmptySession();
    nextSessions = [session, ...nextSessions];
    persistSessions(nextSessions, session.id);
    set({
      sessions: nextSessions,
      activeSessionId: session.id,
      thread: null,
      focus: { type: "root" },
      error: null,
      branchFloatStack: [],
      archivePanelOpen: false,
      viewingArchiveId: null,
      archiveDraft: "",
      projectRoot: null,
      projectError: null,
      agentActivity: [],
      agentChanges: [],
    });
    restoreSessionProject(get, set, session.id, null, sidecarUrl);
  },

  switchSession: (sessionId) => {
    const { sessions, activeSessionId, thread, projectRoot, sidecarUrl } =
      get();
    if (sessionId === activeSessionId) return;

    const nextSessions = flushActiveSession(
      sessions,
      activeSessionId,
      thread,
      projectRoot,
      upsertActiveSession,
    );
    const target = nextSessions.find((s) => s.id === sessionId);
    if (!target) return;

    const nextThread = target.thread ? normalizeThread(target.thread) : null;
    const targetProject = target.projectRoot?.trim() || null;
    persistSessions(nextSessions, sessionId);
    set({
      sessions: nextSessions,
      activeSessionId: sessionId,
      thread: nextThread,
      focus: { type: "root" },
      error: null,
      branchFloatStack: [],
      archivePanelOpen: false,
      viewingArchiveId: null,
      archiveDraft:
        get().loadingArchiveSessionId === sessionId ? get().archiveDraft : "",
      projectRoot: targetProject,
      projectError: null,
      agentActivity: [],
      agentChanges: [],
    });
    restoreSessionProject(get, set, sessionId, targetProject, sidecarUrl);
  },

  deleteSession: (sessionId) => {
    abortSessionGeneration(sessionId);
    clearPendingAgentPlan(set, sessionId);
    setSessionMainLoading(set, sessionId, false);
    setSessionBranchLoading(set, sessionId, null);
    set((state) => ({
      ...(state.loadingArchiveSessionId === sessionId
        ? { loadingArchiveSessionId: null, archiveDraft: "" }
        : {}),
      ...(state.loadingCompressSessionId === sessionId
        ? { loadingCompressSessionId: null }
        : {}),
    }));

    const { sessions, activeSessionId, thread, projectRoot, sidecarUrl } =
      get();
    if (sessions.length <= 1) {
      abortAllGenerations();
      clearPendingAgentPlan(set);
      const session = createEmptySession();
      persistSessions([session], session.id);
      set({
        sessions: [session],
        activeSessionId: session.id,
        thread: null,
        focus: { type: "root" },
        error: null,
        branchFloatStack: [],
        projectRoot: null,
        projectError: null,
        agentActivity: [],
        agentChanges: [],
        loadingMainBySession: {},
        loadingBranchBySession: {},
        loadingArchiveSessionId: null,
        loadingCompressSessionId: null,
        agentPendingPlan: null,
      });
      restoreSessionProject(get, set, session.id, null, sidecarUrl);
      return;
    }

    let nextSessions =
      sessionId === activeSessionId
        ? sessions
        : flushActiveSession(
            sessions,
            activeSessionId,
            thread,
            projectRoot,
            upsertActiveSession,
          );
    nextSessions = nextSessions.filter((s) => s.id !== sessionId);

    const nextActive =
      sessionId === activeSessionId
        ? nextSessions[0]?.id ?? null
        : activeSessionId;
    const active = nextSessions.find((s) => s.id === nextActive);
    const nextThread = active?.thread ? normalizeThread(active.thread) : null;
    const nextProject = active?.projectRoot?.trim() || null;

    persistSessions(nextSessions, nextActive);
    set({
      sessions: nextSessions,
      activeSessionId: nextActive,
      thread: nextThread,
      focus: { type: "root" },
      error: null,
      agentActivity: [],
      agentChanges: [],
      ...(sessionId === activeSessionId
        ? {
            projectRoot: nextProject,
            projectError: null,
          }
        : {}),
    });
    if (sessionId === activeSessionId && nextActive) {
      restoreSessionProject(get, set, nextActive, nextProject, sidecarUrl);
    }
  },

  clearAllSessions: () => {
    abortAllGenerations();
    clearPendingAgentPlan(set);
    const { sidecarUrl } = get();
    const session = createEmptySession();
    persistSessions([session], session.id);
    set({
      sessions: [session],
      activeSessionId: session.id,
      thread: null,
      focus: { type: "root" },
      error: null,
      branchFloatStack: [],
      archivePanelOpen: false,
      viewingArchiveId: null,
      archiveDraft: "",
      agentActivity: [],
      agentChanges: [],
      projectRoot: null,
      projectError: null,
      loadingMainBySession: {},
      loadingBranchBySession: {},
      loadingArchiveSessionId: null,
      loadingCompressSessionId: null,
      agentPendingPlan: null,
    });
    restoreSessionProject(get, set, session.id, null, sidecarUrl);
  },

  replaceSessionStore: (store) => {
    abortAllGenerations();
    clearPendingAgentPlan(set);
    const sessions = store.sessions.length
      ? store.sessions
      : [createEmptySession()];
    const activeSessionId =
      (store.activeSessionId &&
        sessions.some((s) => s.id === store.activeSessionId) &&
        store.activeSessionId) ||
      sessions[0].id;
    const active = sessions.find((s) => s.id === activeSessionId);
    const nextThread = active?.thread ? normalizeThread(active.thread) : null;
    const nextProject = active?.projectRoot?.trim() || null;
    const { sidecarUrl } = get();
    persistSessions(sessions, activeSessionId);
    set({
      sessions,
      activeSessionId,
      thread: nextThread,
      focus: { type: "root" },
      error: null,
      branchFloatStack: [],
      archivePanelOpen: false,
      viewingArchiveId: null,
      archiveDraft: "",
      agentActivity: [],
      agentChanges: [],
      projectRoot: nextProject,
      projectError: null,
      loadingMainBySession: {},
      loadingBranchBySession: {},
      loadingArchiveSessionId: null,
      loadingCompressSessionId: null,
      agentPendingPlan: null,
    });
    if (activeSessionId) {
      restoreSessionProject(get, set, activeSessionId, nextProject, sidecarUrl);
    }
  },

  renameSession: (sessionId, title) => {
    const trimmed = title.trim().replace(/\s+/g, " ");
    if (!trimmed) return false;

    const display =
      trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;
    const { sessions, activeSessionId } = get();
    const nextSessions = sessions.map((s) =>
      s.id === sessionId
        ? {
            ...s,
            title: display,
            titleLocked: true,
            updatedAt: Date.now(),
          }
        : s,
    );
    persistSessions(nextSessions, activeSessionId);
    set({ sessions: nextSessions });
    return true;
  },

  setSessionApi: (api) => {
    const { sessions, activeSessionId } = get();
    if (!activeSessionId) return;
    const nextSessions = patchSessionApi(sessions, activeSessionId, api);
    persistSessions(nextSessions, activeSessionId);
    set({ sessions: nextSessions });
  },

  clearSessionApi: () => {
    const { sessions, activeSessionId } = get();
    if (!activeSessionId) return;
    const nextSessions = patchSessionApi(sessions, activeSessionId, null);
    persistSessions(nextSessions, activeSessionId);
    set({ sessions: nextSessions });
  },

  askMain: async (question) => {
    const trimmed = question.trim();
    if (!trimmed) return "rejected";

    const { settings, activeSessionId, sessions, thread: existingThread } =
      get();
    let sessionId = activeSessionId;
    let currentSessions = sessions;
    if (!sessionId || !getActiveSession(get())) {
      const session = createEmptySession();
      currentSessions = [session, ...currentSessions];
      sessionId = session.id;
      set({ sessions: currentSessions, activeSessionId: sessionId });
    }

    // Prevent double-submit on the same session (other sessions may still generate)
    if (get().loadingMainBySession[sessionId]) return "rejected";
    if (get().agentPendingPlan?.sessionId === sessionId) return "rejected";

    const llm = settingsForSession(settings, getActiveSession(get()));
    const authError = requireApiKey(llm);
    if (authError) {
      set({ error: authError, settingsOpen: true, settingsTab: "api" });
      return "rejected";
    }

    const now = Date.now();
    const userMsg: ChatMessage = {
      id: createId(),
      role: "user",
      content: trimmed,
      children: [],
      createdAt: now,
    };
    const assistantMsg: ChatMessage = {
      id: createId(),
      role: "assistant",
      content: "",
      children: [],
      createdAt: now,
    };

    // Prefer in-memory thread; fall back to persisted session.thread if desynced
    const sessionForThread = currentSessions.find((s) => s.id === sessionId);
    const priorThread =
      existingThread ??
      (sessionForThread?.thread
        ? normalizeThread(sessionForThread.thread)
        : null);

    let thread: ThreadRoot;
    if (priorThread) {
      thread = normalizeThread({
        ...priorThread,
        messages: [...priorThread.messages, userMsg, assistantMsg],
      });
    } else {
      thread = {
        id: createId(),
        messages: [userMsg, assistantMsg],
        createdAt: now,
      };
    }

    const nextSessions = upsertActiveSession(
      currentSessions,
      sessionId,
      thread,
    );
    persistSessions(nextSessions, get().activeSessionId ?? sessionId);
    set({
      sessions: nextSessions,
      thread,
      error: null,
      focus: { type: "root" },
      agentActivity: [],
      agentChanges: [],
    });
    setSessionMainLoading(set, sessionId, true);

    const assistantId = assistantMsg.id;
    const userId = userMsg.id;

    // Abort only this session's prior main turn (leave other sessions alone)
    const priorTurn = mainTurnsBySession.get(sessionId);
    priorTurn?.ctrl.abort();
    const ctrl = new AbortController();
    mainTurnsBySession.set(sessionId, {
      userId,
      assistantId,
      prompt: trimmed,
      ctrl,
    });
    const signal = ctrl.signal;

    const requestStartedAt = Date.now();
    let firstAnswerAt: number | null = null;
    let apiReasoning = "";

    const patchAssistantState = (patch: {
      content?: string;
      reasoning?: string;
    }) => {
      // Ignore late patches after this request was aborted/superseded
      const owned = mainTurnsBySession.get(sessionId);
      if (!owned || owned.ctrl !== ctrl || signal.aborted) return;
      const current = getSessionThread(get, sessionId);
      if (!current) return;
      // Elapsed Thought (Ns) only once answer tokens start — and only if real reasoning exists.
      const reasoningText =
        patch.reasoning !== undefined
          ? patch.reasoning.trim()
          : apiReasoning.trim();
      const thinkingSeconds =
        reasoningText && firstAnswerAt != null
          ? Math.max(1, Math.round((firstAnswerAt - requestStartedAt) / 1000))
          : undefined;
      const next = patchMessage(current, assistantId, {
        ...patch,
        ...(patch.reasoning !== undefined
          ? { reasoning: reasoningText || undefined }
          : {}),
        ...(thinkingSeconds != null ? { thinkingSeconds } : {}),
      });
      commitSessionThread(get, set, sessionId, next);
    };

    const patchAssistantContent = (content: string) => {
      patchAssistantState({ content });
    };

    try {
      const { projectRoot, sidecarUrl } = get();
      const createPathEarly = inferCreateFilePath(trimmed);
      const officeIntentEarly = inferOfficeCreateIntent(trimmed);
      if ((createPathEarly || officeIntentEarly) && !projectRoot) {
        setSessionMainLoading(set, sessionId, false);
        set({
          error:
            "Open a local project first (Open project), then ask to create files — e.g. connect /Users/debris/cursor/code-test.",
        });
        // Roll back the empty turn so the prompt can stay editable
        rollbackMainTurn(get, set, { userId, assistantId, sessionId });
        const owned = mainTurnsBySession.get(sessionId);
        if (owned?.ctrl === ctrl) {
          mainTurnsBySession.delete(sessionId);
        }
        return "rolled_back";
      }

      const agentMaxRounds = resolveAgentMaxRounds(settings);

      const codingToolsSystem = projectRoot
        ? buildCodingToolsSystem(projectRoot)
        : null;
      const session = getActiveSession(get());
      const resolved = resolveConversationContext(session);
      // Keep UI toggle and API path aligned when archive id is missing/stale
      if (resolved.repairedToLive && sessionId) {
        const repaired = patchActiveSessionMeta(get().sessions, sessionId, {
          contextMode: "live",
          activeArchiveId: null,
        });
        persistSessions(repaired, sessionId);
        set({ sessions: repaired });
      }
      const memoryAddendum = await buildAgentMemoryAddendum({
        settings,
        query: trimmed,
        session: getActiveSession(get()),
        projectRoot,
        sidecarUrl,
        signal,
      });

      const apiMessages: ApiChatMessage[] = buildConversationMessages(thread, {
        projectRoot,
        codingToolsSystem,
        contextMode: resolved.mode,
        activeArchive: resolved.archive,
        locale: getLocale(),
        memoryAddendum,
      });

      const createPath = projectRoot ? inferCreateFilePath(trimmed) : null;
      const officeIntent = projectRoot
        ? inferOfficeCreateIntent(trimmed)
        : null;
      const multiStepPlan = projectRoot ? inferMultiStepPlan(trimmed) : [];
      // create / office win over explore — only force list/read/search when neither applies
      const exploreIntent =
        projectRoot && !createPath && !officeIntent
          ? inferExploreIntent(trimmed)
          : null;
      const explorePlaceholder =
        exploreIntent?.kind === "list"
          ? `Listing ${exploreIntent.path}…`
          : exploreIntent?.kind === "read"
            ? `Reading ${exploreIntent.path}…`
            : exploreIntent?.kind === "search"
              ? `Searching ${exploreIntent.query}…`
              : null;
      const locale = getLocale();
      const requireApproval =
        Boolean(projectRoot) && resolveAgentRequireApproval(settings);

      const addExecutionHints = () => {
        if (createPath) {
          apiMessages.push({
            role: "system",
            content: `用户要求在项目中创建文件。你必须调用函数 write_file：path 必须精确为 "${createPath}"（相对项目根），content 为完整源码。禁止只输出 Markdown 代码块而不调用工具。`,
          });
        } else if (officeIntent) {
          apiMessages.push({
            role: "system",
            content:
              officeIntent.tool === "write_xlsx"
                ? `用户要求创建 Excel。你必须调用函数 write_xlsx：path="${officeIntent.path}"，rows 为二维数组（首行可为表头）。禁止只把 JSON/表格贴在 Markdown 里让用户自己执行。禁止用 write_file。`
                : `用户要求创建 Word。你必须调用函数 write_docx：path="${officeIntent.path}"，paragraphs 为段落数组（空白文档用 [] 或 [""]）。禁止只把 JSON 贴在 Markdown 里；禁止未调用工具就声称已创建。禁止用 write_file。`,
          });
        } else if (exploreIntent) {
          apiMessages.push({
            role: "system",
            content:
              exploreIntent.kind === "list"
                ? `用户要求查看目录。你必须调用函数 list_dir：path 必须为 "${exploreIntent.path}"（相对项目根；根目录用 "."）。禁止凭猜测罗列文件。`
                : exploreIntent.kind === "read"
                  ? `用户要求阅读文件。你必须调用函数 read_file：path 必须为 "${exploreIntent.path}"。禁止编造文件内容。`
                  : `用户要求搜索代码。你必须调用函数 search_files：query 必须为 "${exploreIntent.query}"。禁止凭记忆假装已搜索。`,
          });
        } else if (multiStepPlan.length >= 2) {
          apiMessages.push({
            role: "system",
            content: multiStepSystemHint(multiStepPlan),
          });
        }
      };

      let visibleContent = "";
      let round = 0;
      let useNativeTools = Boolean(projectRoot);
      let forcedWrite = Boolean(createPath && projectRoot);
      let forcedExploreTool =
        exploreIntent?.kind === "list"
          ? "list_dir"
          : exploreIntent?.kind === "read"
            ? "read_file"
            : exploreIntent?.kind === "search"
              ? "search_files"
              : null;
      let officeFallbackUsed = false;
      let exploreFallbackUsed = false;
      let officeToolFailed = false;
      let toolBatchesExecuted = 0;

      const executeTools = async (): Promise<string> => {
        addExecutionHints();

      // Pre-flight list_dir so the model cannot hallucinate a directory listing
      const preflightList =
        projectRoot &&
        !signal.aborted &&
        (exploreIntent?.kind === "list" ||
          multiStepPlan[0]?.tool === "list_dir");
      if (preflightList) {
        const listCall: AgentToolCall =
          exploreIntent?.kind === "list"
            ? synthesizeExploreToolCall(exploreIntent)
            : { tool: "list_dir", path: multiStepPlan[0]?.path ?? "." };
        patchAssistantContent("Listing project root…");
        const pre = await abortable(
          executeToolCall(listCall, sidecarUrl, signal, projectRoot),
          signal,
        );
        if (!signal.aborted) {
          set((s) => ({
            agentActivity: [
              ...s.agentActivity,
              {
                id: createId(),
                at: Date.now(),
                ...pre.activity,
              },
            ],
          }));
          toolBatchesExecuted = 1;
          exploreFallbackUsed = true;
          forcedExploreTool = null;
          apiMessages.push({
            role: "user",
            content: pre.ok
              ? `【工具结果：list_dir path="${listCall.path ?? "."}"】\n${pre.resultText}\n\n（以上为真实磁盘 listing，不是猜测。）\n用户任务：${trimmed}\n请据此继续后续步骤（如 read_file package.json、修改 README）；未完成则继续调工具，完成后再中文总结。`
              : `【list_dir 失败】${pre.resultText}\n\n请向用户说明 sidecar/项目绑定问题，不要编造目录内容。`,
          });
          if (!pre.ok) {
            patchAssistantContent(
              `Could not list directory: ${pre.resultText}`,
            );
          }
        }
      }

      // Pre-flight planned read_file steps (do not skip just because file absent from listing)
      if (multiStepPlan.length >= 2 && projectRoot && !signal.aborted) {
        for (const step of multiStepPlan) {
          if (step.tool !== "read_file" || !step.path) continue;
          patchAssistantContent(`Reading ${step.path}…`);
          const readExec = await abortable(
            executeToolCall(step, sidecarUrl, signal, projectRoot),
            signal,
          );
          if (signal.aborted) break;
          set((s) => ({
            agentActivity: [
              ...s.agentActivity,
              {
                id: createId(),
                at: Date.now(),
                ...readExec.activity,
              },
            ],
          }));
          toolBatchesExecuted += 1;
          apiMessages.push({
            role: "user",
            content: `【工具结果：read_file path="${step.path}"】\n${readExec.resultText}`,
          });
        }
        const followUp = multiStepFollowUpHint(trimmed);
        if (followUp) {
          apiMessages.push({ role: "user", content: followUp });
        }
      }

      const forcedOfficeTool = officeIntent?.tool ?? null;

      while (round < agentMaxRounds) {
        if (signal.aborted) break;

        let roundText = "";
        let streamResult: Awaited<ReturnType<typeof streamChat>>;
        try {
          streamResult = await streamChat(
            llm,
            apiMessages,
            (delta) => {
              // Content channel is already peeled of think-tags inside streamChat.
              roundText += delta;
              const cleaned = stripToolCalls(roundText);
              if (cleaned.length > 0) {
                if (firstAnswerAt == null) firstAnswerAt = Date.now();
                patchAssistantState({
                  content: visibleContent
                    ? `${visibleContent}\n\n${cleaned}`.trim()
                    : cleaned,
                  ...(apiReasoning.trim()
                    ? { reasoning: apiReasoning }
                    : {}),
                });
              } else if (!visibleContent && projectRoot) {
                patchAssistantContent(
                  createPath
                    ? `Creating ${createPath}…`
                    : officeIntent
                      ? `Creating ${officeIntent.path}…`
                      : explorePlaceholder || "Using project tools…",
                );
              }
            },
            {
              signal,
              temperature: projectRoot ? 0.2 : 0.6,
              tools: useNativeTools ? PROJECT_OPENAI_TOOLS : undefined,
              toolChoice:
                useNativeTools && forcedWrite && round === 0
                  ? { type: "function", function: { name: "write_file" } }
                  : useNativeTools && forcedOfficeTool && round === 0
                    ? {
                        type: "function",
                        function: { name: forcedOfficeTool },
                      }
                    : useNativeTools && forcedExploreTool && round === 0
                      ? {
                          type: "function",
                          function: { name: forcedExploreTool },
                        }
                      : useNativeTools
                        ? "auto"
                        : undefined,
              onReasoningDelta: (piece) => {
                apiReasoning += piece;
                if (apiReasoning.trim()) {
                  patchAssistantState({ reasoning: apiReasoning });
                }
              },
            },
          );
        } catch (e) {
          if (useNativeTools && isToolsUnsupportedError(e)) {
            // Provider rejected tools — fall back to text protocol once.
            useNativeTools = false;
            forcedWrite = false;
            continue;
          }
          throw e;
        }

        if (signal.aborted) break;

        roundText = streamResult.content || roundText;
        // Prefer streamChat totals (API channel + any think-tags peeled live).
        if (streamResult.reasoning.length >= apiReasoning.length) {
          apiReasoning = streamResult.reasoning;
        }
        {
          // Safety net if a provider left residual tags in content.
          const merged = mergeReasoningChannels(
            apiReasoning,
            stripToolCalls(roundText),
          );
          apiReasoning = merged.reasoning;
          roundText = merged.content;
          if (apiReasoning.trim()) {
            patchAssistantState({
              reasoning: apiReasoning,
              ...(roundText
                ? {
                    content: visibleContent
                      ? `${visibleContent}\n\n${roundText}`.trim()
                      : roundText,
                  }
                : {}),
            });
          }
        }

        type PendingCall = {
          agent: AgentToolCall;
          native?: ToolCall;
        };
        const pending: PendingCall[] = [];

        if (streamResult.toolCalls.length > 0) {
          for (const tc of streamResult.toolCalls) {
            const agent = agentCallFromOpenAI(tc);
            if (agent) {
              // If user named a file, pin write_file path to it when model omits/wrong path
              if (
                createPath &&
                agent.tool === "write_file" &&
                (!agent.path || agent.path === "." || agent.path === "file")
              ) {
                agent.path = createPath;
              }
              if (
                officeIntent &&
                agent.tool === officeIntent.tool &&
                (!agent.path || agent.path === "." || agent.path === "file")
              ) {
                agent.path = officeIntent.path;
              }
              if (
                exploreIntent?.kind === "list" &&
                agent.tool === "list_dir" &&
                (!agent.path || agent.path === "file")
              ) {
                agent.path = exploreIntent.path;
              }
              if (
                exploreIntent?.kind === "read" &&
                agent.tool === "read_file" &&
                (!agent.path || agent.path === "." || agent.path === "file")
              ) {
                agent.path = exploreIntent.path;
              }
              if (
                exploreIntent?.kind === "search" &&
                agent.tool === "search_files" &&
                !agent.query?.trim()
              ) {
                agent.query = exploreIntent.query;
              }
              pending.push({ agent, native: tc });
            }
          }
        } else if (projectRoot) {
          for (const agent of collectToolCalls(roundText, trimmed, apiReasoning)) {
            if (
              officeIntent &&
              agent.tool === officeIntent.tool &&
              (!agent.path || agent.path === ".")
            ) {
              agent.path = officeIntent.path;
            }
            if (
              exploreIntent?.kind === "list" &&
              agent.tool === "list_dir" &&
              (!agent.path || agent.path === "file")
            ) {
              agent.path = exploreIntent.path;
            }
            if (
              exploreIntent?.kind === "read" &&
              agent.tool === "read_file" &&
              (!agent.path || agent.path === "." || agent.path === "file")
            ) {
              agent.path = exploreIntent.path;
            }
            if (
              exploreIntent?.kind === "search" &&
              agent.tool === "search_files" &&
              !agent.query?.trim()
            ) {
              agent.query = exploreIntent.query;
            }
            pending.push({ agent });
          }
        }

        // Guaranteed fallback: user asked for a named file, model only pasted code
        if (
          createPath &&
          projectRoot &&
          !pending.some((p) => p.agent.tool === "write_file")
        ) {
          const synthetic = synthesizeWriteFromReply(trimmed, roundText);
          if (synthetic) {
            pending.push({ agent: synthetic });
          }
        }

        // Explore: model pasted {"path":"."} or skipped native tool_calls
        if (
          exploreIntent &&
          projectRoot &&
          !exploreFallbackUsed &&
          toolBatchesExecuted === 0 &&
          !pending.some(
            (p) =>
              p.agent.tool ===
              (exploreIntent.kind === "list"
                ? "list_dir"
                : exploreIntent.kind === "read"
                  ? "read_file"
                  : "search_files"),
          )
        ) {
          pending.push({
            agent: synthesizeExploreToolCall(exploreIntent),
          });
          exploreFallbackUsed = true;
        }

        // Office: model often claims success without calling write_docx / write_xlsx
        if (
          officeIntent &&
          projectRoot &&
          !officeFallbackUsed &&
          !officeToolFailed &&
          !pending.some((p) => p.agent.tool === officeIntent.tool)
        ) {
          pending.push({
            agent: synthesizeOfficeFromIntent(officeIntent, trimmed),
          });
          officeFallbackUsed = true;
        }

        const cleanedRound = stripToolCalls(roundText);

        if (pending.length === 0) {
          // Specific round-0 nudges when model ignored tools
          if (createPath && projectRoot && round === 0) {
            apiMessages.push({
              role: "assistant",
              content: cleanedRound || roundText || "",
            });
            apiMessages.push({
              role: "user",
              content: `请立刻调用 write_file，path="${createPath}"，content=完整源码。不要只贴代码。`,
            });
            visibleContent = cleanedRound;
            patchAssistantContent(
              visibleContent || `Creating ${createPath}…`,
            );
            round += 1;
            forcedWrite = useNativeTools;
            continue;
          }
          if (
            officeIntent &&
            projectRoot &&
            round === 0 &&
            toolBatchesExecuted === 0
          ) {
            apiMessages.push({
              role: "assistant",
              content: cleanedRound || roundText || "",
            });
            apiMessages.push({
              role: "user",
              content:
                officeIntent.tool === "write_xlsx"
                  ? `不要把工具 JSON 贴给用户。请立刻调用函数 write_xlsx，path="${officeIntent.path}"，rows=完整二维数组。`
                  : `不要把工具 JSON 贴给用户。请立刻调用函数 write_docx，path="${officeIntent.path}"，paragraphs 为段落数组（空白文档可用 []）。`,
            });
            visibleContent = cleanedRound;
            patchAssistantContent(
              visibleContent || `Creating ${officeIntent.path}…`,
            );
            round += 1;
            continue;
          }
          if (exploreIntent && projectRoot && round === 0) {
            apiMessages.push({
              role: "assistant",
              content: cleanedRound || roundText || "",
            });
            apiMessages.push({
              role: "user",
              content:
                exploreIntent.kind === "list"
                  ? `请立刻调用 list_dir，path="${exploreIntent.path}"。不要凭猜测列目录。`
                  : exploreIntent.kind === "read"
                    ? `请立刻调用 read_file，path="${exploreIntent.path}"。不要编造文件内容。`
                    : `请立刻调用 search_files，query="${exploreIntent.query}"。不要假装已搜索。`,
            });
            visibleContent = cleanedRound;
            patchAssistantContent(
              visibleContent || explorePlaceholder || "Using project tools…",
            );
            round += 1;
            continue;
          }

          // General project task: model replied with text but never ran tools yet
          if (projectRoot && toolBatchesExecuted === 0 && round < 2) {
            apiMessages.push({
              role: "assistant",
              content: cleanedRound || roundText || "",
            });
            apiMessages.push({
              role: "user",
              content:
                "请立刻调用工具执行（list_dir / read_file / write_file / search_replace / write_docx 等），根据工具返回结果继续；全部完成后再用中文总结。不要只描述计划或假装已完成。",
            });
            visibleContent = cleanedRound;
            patchAssistantContent(
              visibleContent || "Using project tools…",
            );
            round += 1;
            continue;
          }

          // Tools already ran but model returned empty — ask for final summary
          if (
            projectRoot &&
            toolBatchesExecuted > 0 &&
            !cleanedRound.trim() &&
            round < agentMaxRounds - 1
          ) {
            apiMessages.push({
              role: "user",
              content:
                "工具已执行。请根据上述工具结果给出最终中文总结，不要再调用工具。",
            });
            round += 1;
            continue;
          }

          visibleContent = cleanedRound || visibleContent;
          patchAssistantContent(visibleContent);
          break;
        }

        if (streamResult.toolCalls.length > 0) {
          apiMessages.push({
            role: "assistant",
            content: cleanedRound || "",
            tool_calls: streamResult.toolCalls,
          });
        } else {
          apiMessages.push({ role: "assistant", content: roundText || "" });
        }

        if (cleanedRound) {
          visibleContent = visibleContent
            ? `${visibleContent}\n\n${cleanedRound}`.trim()
            : cleanedRound;
          patchAssistantContent(visibleContent);
        } else {
          patchAssistantContent(
            visibleContent ||
              (createPath
                ? `Creating ${createPath}…`
                : officeIntent
                  ? `Creating ${officeIntent.path}…`
                  : explorePlaceholder || "Using project tools…"),
          );
        }

        let wroteTarget = false;
        let batchHadTools = pending.length > 0;
        let batchHadSuccess = false;
        for (const item of pending) {
          if (signal.aborted) break;
          const executed = await abortable(
            executeToolCall(item.agent, sidecarUrl, signal, projectRoot),
            signal,
          );
          if (signal.aborted) break;
          if (executed.ok) {
            batchHadSuccess = true;
          }
          if (
            item.agent.tool === "write_file" &&
            executed.ok &&
            (item.agent.path === createPath || !createPath)
          ) {
            wroteTarget = true;
          }
          if (
            officeIntent &&
            item.agent.tool === officeIntent.tool &&
            executed.ok
          ) {
            wroteTarget = true;
          }
          if (
            officeIntent &&
            item.agent.tool === officeIntent.tool &&
            !executed.ok
          ) {
            officeToolFailed = true;
          }
          const activity: AgentActivity = {
            id: createId(),
            at: Date.now(),
            ...executed.activity,
          };
          set((s) => ({
            agentActivity: [...s.agentActivity, activity],
            agentChanges: executed.change
              ? [
                  ...s.agentChanges,
                  { ...executed.change, at: Date.now() },
                ]
              : s.agentChanges,
          }));

          if (item.native) {
            apiMessages.push(
              nativeToolResultMessage(
                item.native.id,
                item.native.function.name,
                executed.resultText,
              ),
            );
          } else {
            apiMessages.push(toolResultMessage(item.agent, executed.resultText));
          }
        }

        if (batchHadTools) {
          toolBatchesExecuted += 1;
        }

        if (signal.aborted) break;

        // After a successful create-file write, ask for a short summary then stop looping tools
        if (createPath && wroteTarget) {
          apiMessages.push({
            role: "user",
            content: `文件 ${createPath} 已写入。请用一两句中文确认路径与作用，不要再调用工具。`,
          });
          forcedWrite = false;
        } else if (officeIntent && wroteTarget) {
          apiMessages.push({
            role: "user",
            content: `文件 ${officeIntent.path} 已写入磁盘。请用一两句中文确认路径，不要再调用工具，也不要把工具 JSON 贴给用户。`,
          });
        } else if (
          projectRoot &&
          toolBatchesExecuted > 0 &&
          batchHadTools &&
          batchHadSuccess &&
          !wroteTarget &&
          !createPath &&
          !officeIntent
        ) {
          // After a read/list/search batch, nudge the model to continue or summarize
          apiMessages.push({
            role: "user",
            content:
              "请根据上述工具结果判断：若用户任务已完成，请给出最终中文总结且不要再调用工具；仅当原请求仍有未完成的必要步骤时才继续调工具。禁止添加用户未要求的验证操作（如多余的 list_dir）。",
          });
        } else if (officeIntent && officeToolFailed) {
          visibleContent =
            (visibleContent || cleanedRound) +
            `\n\n（创建 ${officeIntent.path} 失败：${officeIntent.tool} 未成功写入。请确认 npm run dev 已启动 sidecar，或重启 dev 后再试。）`;
          patchAssistantContent(visibleContent.trim());
          break;
        }

        round += 1;
        if (round >= agentMaxRounds) {
          const note =
            `\n\n(Reached the tool-round limit (${agentMaxRounds}). Continue from the results so far, or send another message.)`;
          visibleContent = (visibleContent || cleanedRound) + note;
          patchAssistantContent(visibleContent.trim());
        }
      }

        return visibleContent;
      };

      if (requireApproval && !signal.aborted) {
        apiMessages.push({
          role: "system",
          content: buildPlanningPhaseSystem(locale),
        });
        if (createPath) {
          apiMessages.push({
            role: "system",
            content: buildMinimalCreatePlanHint(createPath, locale),
          });
        }
        patchAssistantContent(
          locale === "zh" ? "正在制定计划…" : "Drafting plan…",
        );

        let planRaw = "";
        await streamChat(
          llm,
          apiMessages,
          (delta) => {
            planRaw += delta;
            const cleaned = stripToolCalls(planRaw);
            if (cleaned.length > 0) {
              patchAssistantContent(cleaned);
            }
          },
          { signal, temperature: 0.3 },
        );

        if (signal.aborted) {
          return "started";
        }

        const { planText, steps } = parseAgentPlan(planRaw);
        const displayPlan = planText || planRaw.trim();
        patchAssistantContent(displayPlan);
        apiMessages.push({ role: "assistant", content: displayPlan });

        // Clarification / no-tools: stay in chat only — no Approve & run bar
        if (!planNeedsToolApproval(displayPlan, steps)) {
          mainTurnsBySession.delete(sessionId);
          setSessionMainLoading(set, sessionId, false);
          return "started";
        }

        const approvedPlanText = displayPlan;
        pendingAgentContinuations.set(sessionId, async () => {
          apiMessages.push({
            role: "user",
            content:
              locale === "zh"
                ? `用户已批准以下计划。请立即按计划执行，只调用完成该计划所必需的工具；不要额外添加验证步骤（如未经要求的 list_dir）。若计划写明无需工具，则只总结、不要调工具。\n\n${approvedPlanText}`
                : `User approved the plan. Execute it now with only the tools required by the plan; do not add extra verification steps (e.g. unrequested list_dir). If the plan says no tools are needed, summarize only and do not call tools.\n\n${approvedPlanText}`,
          });
          await executeTools();
        });

        setSessionMainLoading(set, sessionId, false);
        set({
          agentPendingPlan: {
            id: createId(),
            sessionId,
            planText: displayPlan,
            steps,
            userPrompt: trimmed,
            userId,
            assistantId,
          },
        });
        return "started";
      }

      visibleContent = await executeTools();
    } catch (e) {
      if (!isAbortError(e)) {
        set({ error: e instanceof Error ? e.message : "Answer request failed" });
      }
    } finally {
      // Stop may have already rolled back; this is a safety net if abort came from elsewhere
      const waitingPlan =
        get().agentPendingPlan?.sessionId === sessionId &&
        pendingAgentContinuations.has(sessionId);
      const isCurrent = mainTurnsBySession.get(sessionId)?.ctrl === ctrl;
      if (signal.aborted && isCurrent) {
        rollbackMainTurn(get, set, { userId, assistantId, sessionId });
      }
      // Don't clobber a newer in-flight request for this session
      if (isCurrent && !waitingPlan) {
        mainTurnsBySession.delete(sessionId);
        setSessionMainLoading(set, sessionId, false);
      }
    }
    return "started";
  },

  askBranch: async (parentId, _parentContent, anchor, question) => {
    const trimmed = question.trim();
    if (!trimmed) return;

    const { settings, thread, activeSessionId, sessions } = get();
    if (!thread || !activeSessionId) return;
    const sessionId = activeSessionId;

    const llm = settingsForSession(settings, getActiveSession(get()));
    const authError = requireApiKey(llm);
    if (authError) {
      set({ error: authError, settingsOpen: true, settingsTab: "api" });
      return;
    }

    const branch: BranchNode = {
      id: createId(),
      parentId,
      anchor,
      userQuestion: trimmed,
      assistantMessage: "",
      children: [],
      createdAt: Date.now(),
    };

    const parentMessage = thread.messages.find((m) => m.id === parentId);
    let nextThread: ThreadRoot;

    if (parentMessage) {
      nextThread = appendBranchToMessage(thread, parentId, branch);
    } else {
      const rootMsg = findAssistantMessageForBranch(thread, parentId);
      if (!rootMsg) return;
      nextThread = {
        ...thread,
        messages: thread.messages.map((m) =>
          m.id === rootMsg.id
            ? {
                ...m,
                children: appendChild(m.children, parentId, branch),
              }
            : m,
        ),
      };
    }

    const nextSessions = upsertActiveSession(
      sessions,
      sessionId,
      nextThread,
    );
    persistSessions(nextSessions, get().activeSessionId);
    set({
      sessions: nextSessions,
      thread: nextThread,
      error: null,
    });
    setSessionBranchLoading(set, sessionId, branch.id);

    const branchId = branch.id;

    const priorBranch = branchAbortBySession.get(sessionId);
    priorBranch?.ctrl.abort();
    const branchCtrl = new AbortController();
    branchAbortBySession.set(sessionId, { ctrl: branchCtrl, branchId });
    const branchSignal = branchCtrl.signal;

    void (async () => {
      try {
        const messages = buildBranchQuestionMessages(
          nextThread,
          parentId,
          anchor.quotedText,
          trimmed,
          getLocale(),
        );
        await streamChat(
          llm,
          messages,
          (delta) => {
            const owned = branchAbortBySession.get(sessionId);
            if (
              !owned ||
              owned.ctrl !== branchCtrl ||
              branchSignal.aborted
            ) {
              return;
            }
            const current = getSessionThread(get, sessionId);
            if (!current) return;
            const updated = patchBranchInThread(current, branchId, {
              assistantMessage:
                (findBranchInThread(current, branchId)?.assistantMessage ??
                  "") + delta,
            });
            commitSessionThread(get, set, sessionId, updated);
          },
          { signal: branchSignal, temperature: 0.3 },
        );
      } catch (e) {
        if (!isAbortError(e)) {
          set({
            error:
              e instanceof Error ? e.message : "Fork answer request failed",
          });
        }
      } finally {
        const owned = branchAbortBySession.get(sessionId);
        if (owned?.ctrl === branchCtrl) {
          branchAbortBySession.delete(sessionId);
          setSessionBranchLoading(set, sessionId, null);
        }
      }
    })();

    return branchId;
  },
}));
