import { create } from "zustand";
import {
  type AgentActivity,
  type AgentFileChange,
} from "../lib/agentTools";
import {
  EMPTY_AGENT_ACTIVITY,
  EMPTY_AGENT_CHANGES,
  appendSessionAgentActivity,
  appendSessionAgentChange,
  clearSessionAgentUiMaps,
  projectAgentSessionUi,
} from "../lib/agentSessionActivity";
import { isAgentTurnPlaceholder } from "../lib/agentStatus";
import { withAgentPhaseModel } from "../lib/agentModelRouting";
import { saveArchiveMarkdownToProject } from "../lib/archiveFiles";
import {
  buildClarifyAddendumMessages,
  buildClarifyContinueAddendumMessages,
} from "../lib/contextBuilder";
import { getLocale, t } from "../lib/i18n";
import { createId } from "../lib/id";
import { isQuotaExceededError } from "../lib/browserStorage";
import {
  compressChatMessages,
  formatArchiveDraftAsCompressSource,
  isCompressAfterArchiveEnabled,
  loadContextMemoryPack,
  packThroughMessageId,
  parseCompressedOutput,
  saveContextMemoryPack,
} from "../lib/contextMemory";
import { streamChat } from "../lib/openai";
import {
  projectSessionJobUi,
  resolveSessionJobTarget,
  SessionJobRegistry,
} from "../lib/sessionJobRegistry";
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
  DEFAULT_SESSION_TITLE,
  flushScheduledSessionStoreSave,
  loadSessionStore,
  normalizeStoredSessionTitle,
  saveSessionStore,
  scheduleSessionStoreSave,
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
  patchBranchLastReplyInThread,
  patchBranchReplyInThread,
  patchMessage,
} from "../lib/thread";
import {
  applyAdoptNoteToContent,
  clearBranchAdoptFields,
  removeAdoptNoteFromContent,
  resolveBranchAdoptSource,
  truncateAdoptSummary,
} from "../lib/adoptBranch";
import { parseAnswerPoints, parseBranchReplyVerdictTarget } from "../lib/points";
import { saveProjectLearningPack } from "../lib/projectLearning";
import { createFeedbackEvent } from "../lib/feedback";
import {
  persistFeedbackIntoUserModel,
  seedPersistedUserModelFromSessions,
} from "../lib/userModelStore";
import {
  applySessionFeedbackOnce,
  commitSessionFeedbackSnapshot,
} from "../lib/sessionFeedbackCommit";
import {
  nextFloatZIndex,
  popBranchFloat,
  pushBranchFloat,
  type BranchFloatEntry,
} from "../lib/branchFloat";
import {
  canStartAskBranch,
  shouldClearPendingPlanForClarify,
  shouldQueueClarify,
  type PendingClarify,
} from "../lib/clarifyGate";
import type {
  Anchor,
  ApiSettings,
  ArchiveSnapshot,
  BranchNode,
  BranchReply,
  ChatMessage,
  ChatSession,
  ContextMemoryPack,
  ContextMode,
  ThreadView,
  FeedbackAttribution,
  FeedbackEvent,
  FocusTarget,
  NodeId,
  AgentPendingPlan,
  PointAttributionMap,
  PointDoubtMap,
  PointVerdict,
  PointVerdictMap,
  SessionStore,
  SessionApiOverride,
  SettingsTab,
  ThreadRoot,
} from "../types";

type RunAgentTurn = typeof import("../lib/agentTurn").runAgentTurn;
type RunAgentTurnOptions = Parameters<RunAgentTurn>[0];

async function runLoadedAgentTurn(options: RunAgentTurnOptions) {
  const { runAgentTurn } = await import("../lib/agentTurn");
  return runAgentTurn(options);
}

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
  /** At most one Clarify queued per session while a branch turn runs. */
  pendingClarifyBySession: Record<NodeId, PendingClarify>;
  /** Session currently streaming an archive draft, if any. */
  loadingArchiveSessionId: NodeId | null;
  /** Archive jobs keyed by session; the single id above projects the active session. */
  loadingArchiveBySession: Record<NodeId, boolean>;
  /** Session currently compressing context, if any. */
  loadingCompressSessionId: NodeId | null;
  /** Compress jobs keyed by session; the single id above projects the active session. */
  loadingCompressBySession: Record<NodeId, boolean>;
  archivePanelOpen: boolean;
  viewingArchiveId: NodeId | null;
  /** Streaming draft while archiveCurrent runs */
  archiveDraft: string;
  /** Streaming archive drafts keyed by their originating session. */
  archiveDraftBySession: Record<NodeId, string>;
  /**
   * Set when Archive is clicked but the latest snapshot already covers
   * the thread (no LLM). Cleared when the panel closes or a new archive starts.
   */
  archiveAlreadyCurrent: boolean;
  error: string | null;
  branchFloatStack: BranchFloatEntry[];
  /** 递增后关闭所有划选追问浮层 */
  floatOverlayDismissToken: number;

  /** Bound local project absolute path (via sidecar), or null */
  projectRoot: string | null;
  sidecarUrl: string;
  projectError: string | null;
  /** Mid-turn tool log keyed by session; `agentActivity` projects the active one. */
  agentActivityBySession: Record<NodeId, AgentActivity[]>;
  /** Mid-turn file changes keyed by session; `agentChanges` projects the active one. */
  agentChangesBySession: Record<NodeId, AgentFileChange[]>;
  /** Active-session projection of `agentActivityBySession`. */
  agentActivity: AgentActivity[];
  /** Active-session projection of `agentChangesBySession`. */
  agentChanges: AgentFileChange[];
  /** Plan awaiting user approval before tool execution (project agent). */
  agentPendingPlan: AgentPendingPlan | null;
  pendingFileIncludes: string[];

  init: () => void;
  setSettings: (settings: ApiSettings) => void;
  setSettingsOpen: (open: boolean, tab?: SettingsTab) => void;
  setSettingsTab: (tab: SettingsTab) => void;
  setProjectOpen: (open: boolean) => void;
  setSidecarUrl: (url: string) => void;
  openProject: (absPath: string, quiet?: boolean) => Promise<void>;
  disconnectProject: () => void;
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
   * Pass `sourceOverride` to reuse an archive draft (e.g. after Archive).
   */
  compressContext: (opts?: {
    sourceOverride?: string;
    /** Internal target used by archive follow-up after the active session changes. */
    sessionId?: NodeId;
  }) => Promise<void>;
  setContextMode: (mode: ContextMode, archiveId?: NodeId | null) => void;
  setThreadView: (view: ThreadView) => void;
  setArchivePanelOpen: (open: boolean) => void;
  setViewingArchiveId: (id: NodeId | null) => void;
  deleteArchive: (archiveId: NodeId) => void;
  /**
   * 对主消息或分支回答中的某个分点设置裁决；再次点击同一裁决则清除（回到默认沉默）。
   * 主动采纳 ≠ 沉默；切换离开存疑/不采纳时清掉备注与归因。
   */
  setPointVerdict: (
    targetId: NodeId,
    pointIndex: number,
    verdict: PointVerdict,
  ) => void;
  /**
   * 写入存疑可选备注。非空 → 保持/设为 unsure；空串仅清备注（保留 unsure + 归因）。
   */
  setPointDoubt: (
    targetId: NodeId,
    pointIndex: number,
    doubt: string,
  ) => void;
  /** 为存疑/不采纳确认 Agent 假设归因（对）。 */
  setPointAttribution: (
    targetId: NodeId,
    pointIndex: number,
    attribution: FeedbackAttribution,
  ) => void;
  /** 用户否认假设（不对）——记事件，不写归因，勿当轮自我合理化。 */
  denyPointHypothesis: (targetId: NodeId, pointIndex: number) => void;
  /** 被动使用信号：复制回答等（零成本强正信号）。 */
  recordPassiveCopy: (targetId: NodeId) => void;

  openBranchFloat: (
    branchId: NodeId,
    rect: DOMRect,
    parentBranchId?: NodeId | null,
    opts?: {
      skipEnterAnimation?: boolean;
      seedLeft?: number;
      seedTop?: number;
    },
  ) => void;
  closeBranchFloat: (branchId: NodeId) => void;
  closeAllBranchFloats: () => void;

  createSession: () => void;
  /** Ensure a note exists so memory pack / session import can persist (creates empty note if needed). */
  ensureActiveSessionForImport: () => NodeId;
  switchSession: (sessionId: NodeId) => void;
  deleteSession: (sessionId: NodeId) => void;
  /** Replace all notes with a single empty session (localStorage). */
  clearAllSessions: () => void;
  /** Replace the in-memory + persisted session store (e.g. after import). */
  replaceSessionStore: (store: SessionStore) => void;
  /** 重命名笔记；空标题拒绝。成功后锁定标题，不再被自动覆盖 */
  renameSession: (sessionId: NodeId, title: string) => boolean;
  /** Pin / unpin a note; pinned notes appear in a separate group (order still by createdAt). */
  togglePinSession: (sessionId: NodeId) => void;
  /** Set the model for the active session (snapshotted; empty clears to inherit settings). */
  setSessionApi: (api: SessionApiOverride | null) => void;
  clearSessionApi: () => void;
  setSessionMemory: (summary: string, sessionId?: NodeId) => void;
  /** Whether the session shares the project memory pack with other sessions. */
  setShareMemory: (sessionId: NodeId, share: boolean) => void;
  saveContextMemoryFields: (
    fields: {
      summary?: string;
      tasks?: string;
      decisions?: string;
    },
    opts?: { sessionId?: NodeId },
  ) => Promise<void>;
  addFileInclude: (path: string) => void;
  removeFileInclude: (path: string) => void;
  clearFileIncludes: () => void;

  askMain: (question: string) => Promise<"started" | "rejected">;
  askBranch: (
    parentId: NodeId,
    parentContent: string,
    anchor: Anchor,
    question: string,
    opts?: { openFloat?: boolean },
  ) => Promise<NodeId | void>;
  /** Drop a queued Clarify for the active session (or a given session). */
  clearPendingClarify: (sessionId?: NodeId | null) => void;
  /** Same-window Fork follow-up (does not create a nested float). */
  continueBranch: (branchId: NodeId, question: string) => Promise<void>;
  /** Adopt fork conclusion into the parent assistant message (non-destructive note). */
  adoptBranchIntoMain: (branchId: NodeId) => void;
  /** Remove an adopted clarification note from the parent main answer. */
  unadoptBranchFromMain: (branchId: NodeId) => void;
}

function getActiveSession(state: AppState): ChatSession | undefined {
  return state.sessions.find((s) => s.id === state.activeSessionId);
}

function persistSessions(
  sessions: ChatSession[],
  activeSessionId: NodeId | null,
  opts?: { mode?: "immediate" | "scheduled" },
): void {
  try {
    if (opts?.mode === "scheduled") {
      scheduleSessionStoreSave({ sessions, activeSessionId });
      return;
    }
    const result = saveSessionStore({ sessions, activeSessionId });
    if (!result.ok) {
      console.warn("[ForkNote] persistSessions failed", result.message);
      if (result.quotaExceeded) {
        useAppStore.setState({
          error: t("data.storageQuotaExceeded", undefined, getLocale()),
        });
      }
    }
  } catch (e) {
    // QuotaExceeded / private-mode write failures must not crash the agent turn.
    console.warn("[ForkNote] persistSessions failed", e);
    if (isQuotaExceededError(e)) {
      useAppStore.setState({
        error: t("data.storageQuotaExceeded", undefined, getLocale()),
      });
    }
  }
}

function flushSessionPersistence(): void {
  try {
    flushScheduledSessionStoreSave();
  } catch (e) {
    console.warn("[ForkNote] flushSessionPersistence failed", e);
    if (isQuotaExceededError(e)) {
      useAppStore.setState({
        error: t("data.storageQuotaExceeded", undefined, getLocale()),
      });
    }
  }
}

function resolvePointContent(
  thread: ThreadRoot,
  targetId: NodeId,
  pointIndex: number,
): string {
  const replyTarget = parseBranchReplyVerdictTarget(targetId);
  let content = "";
  if (replyTarget) {
    content =
      findBranchInThread(thread, replyTarget.branchId)?.replies?.[
        replyTarget.replyIndex
      ]?.assistantMessage ?? "";
  } else {
    content =
      thread.messages.find((m) => m.id === targetId)?.content ??
      findBranchInThread(thread, targetId)?.assistantMessage ??
      "";
  }
  const point = parseAnswerPoints(content).points.find(
    (p) => p.index === pointIndex,
  );
  return point?.content ?? content;
}

function applySessionFeedback(
  sessions: ChatSession[],
  activeSessionId: NodeId,
  event: ReturnType<typeof createFeedbackEvent>,
  strategyContent?: string,
): ChatSession[] {
  const next = applySessionFeedbackOnce(
    sessions,
    activeSessionId,
    event,
    strategyContent,
  );
  if (next.committed) {
    // Cross-session User Model confidence survives new notes / session delete.
    persistFeedbackIntoUserModel(event);
  }
  return next.sessions;
}

function commitDecisionFeedbackBatch(
  get: () => AppState,
  set: (partial: { sessions: ChatSession[] }) => void,
  sessionId: NodeId,
  events: FeedbackEvent[],
) {
  if (events.length === 0) return;
  let sessions = get().sessions;
  for (const event of events) {
    sessions = applySessionFeedback(sessions, sessionId, event);
  }
  persistSessions(sessions, get().activeSessionId);
  set({ sessions });
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
      | "archives"
      | "contextMode"
      | "activeArchiveId"
      | "threadView"
      | "contextMemory"
      | "sessionMemory"
      | "shareMemory"
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
    // Do not wipe per-session agent activity — generation may still be in flight.
    set({
      projectRoot: root,
      projectError,
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
      apply(null, e instanceof Error ? e.message : t("project.error.sidecar", undefined, getLocale())),
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
const archiveJobs = new SessionJobRegistry();
const compressJobs = new SessionJobRegistry();

function isAbortError(e: unknown): boolean {
  return (
    (e instanceof Error && e.name === "AbortError") ||
    (typeof DOMException !== "undefined" &&
      e instanceof DOMException &&
      e.name === "AbortError")
  );
}

type ThinkingTimingState = {
  requestStartedAt: number;
  firstReasoningAt: number | null;
  lastReasoningAt: number | null;
  firstAnswerAt: number | null;
};

function updateThinkingTiming(
  timing: ThinkingTimingState,
  patch: {
    content?: string;
    reasoning?: string;
  },
): number | undefined {
  const now = Date.now();

  if (patch.reasoning !== undefined && patch.reasoning.trim()) {
    if (timing.firstReasoningAt == null) timing.firstReasoningAt = now;
    timing.lastReasoningAt = now;
  }

  if (
    patch.content !== undefined &&
    patch.content.trim() &&
    timing.firstAnswerAt == null &&
    !isAgentTurnPlaceholder(patch.content)
  ) {
    timing.firstAnswerAt = now;
  }

  if (patch.reasoning === undefined && timing.firstReasoningAt == null) {
    return undefined;
  }

  if (timing.firstReasoningAt != null) {
    const endAt = Math.max(
      timing.firstReasoningAt,
      timing.lastReasoningAt ?? 0,
      timing.firstAnswerAt ?? 0,
    );
    return Math.max(
      1,
      Math.round((endAt - timing.firstReasoningAt) / 1000),
    );
  }

  if (timing.firstAnswerAt != null) {
    return Math.max(
      1,
      Math.round((timing.firstAnswerAt - timing.requestStartedAt) / 1000),
    );
  }

  return undefined;
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

function clearSessionSummaryLoading(
  set: (
    partial:
      | Partial<AppState>
      | ((state: AppState) => Partial<AppState>),
  ) => void,
  sessionId: NodeId,
): void {
  set((state) => {
    const loadingArchiveBySession = { ...state.loadingArchiveBySession };
    const loadingCompressBySession = { ...state.loadingCompressBySession };
    const archiveDraftBySession = { ...state.archiveDraftBySession };
    delete loadingArchiveBySession[sessionId];
    delete loadingCompressBySession[sessionId];
    delete archiveDraftBySession[sessionId];
    return {
      loadingArchiveBySession,
      loadingCompressBySession,
      archiveDraftBySession,
      ...(state.activeSessionId === sessionId
        ? {
            loadingArchiveSessionId: null,
            loadingCompressSessionId: null,
            archiveDraft: "",
          }
        : {}),
    };
  });
}

function clearPendingClarifyState(
  set: (
    partial:
      | Partial<AppState>
      | ((state: AppState) => Partial<AppState>),
  ) => void,
  sessionId?: NodeId | null,
): void {
  if (sessionId) {
    set((state) => {
      if (!state.pendingClarifyBySession[sessionId]) return {};
      const next = { ...state.pendingClarifyBySession };
      delete next[sessionId];
      return { pendingClarifyBySession: next };
    });
    return;
  }
  set({ pendingClarifyBySession: {} });
}

function defaultQueuedClarifyRect(): DOMRect {
  const w = 320;
  const h = 40;
  const left = Math.max(16, Math.round(window.innerWidth / 2 - w / 2));
  const top = Math.max(16, Math.round(window.innerHeight * 0.28));
  return new DOMRect(left, top, w, h);
}

function flushPendingClarify(
  get: () => AppState,
  set: (
    partial:
      | Partial<AppState>
      | ((state: AppState) => Partial<AppState>),
  ) => void,
  sessionId: NodeId,
): void {
  const pending = get().pendingClarifyBySession[sessionId];
  if (!pending) return;
  clearPendingClarifyState(set, sessionId);
  if (
    !canStartAskBranch({
      loadingMain: Boolean(get().loadingMainBySession[sessionId]),
      loadingBranch: Boolean(get().loadingBranchBySession[sessionId]),
    })
  ) {
    return;
  }
  void get().askBranch(
    pending.parentId,
    pending.parentContent,
    pending.anchor,
    pending.question,
    { openFloat: true },
  );
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
  persistMode: "immediate" | "scheduled" = "immediate",
): void {
  const state = get();
  const updatedSessions = upsertActiveSession(state.sessions, sessionId, next);
  persistSessions(updatedSessions, state.activeSessionId, { mode: persistMode });
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
  archiveJobs.abort(sessionId);
  compressJobs.abort(sessionId);
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
  archiveJobs.abortAll();
  compressJobs.abortAll();
  pendingAgentContinuations.clear();
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
  clearSessionAgentUi(set, turn.sessionId);
}

function clearSessionAgentUi(
  set: (
    partial:
      | Partial<AppState>
      | ((state: AppState) => Partial<AppState>),
  ) => void,
  sessionId: NodeId,
): void {
  set((state) => {
    const maps = clearSessionAgentUiMaps(
      state.agentActivityBySession,
      state.agentChangesBySession,
      sessionId,
    );
    return {
      ...maps,
      ...(state.activeSessionId === sessionId
        ? {
            agentActivity: EMPTY_AGENT_ACTIVITY,
            agentChanges: EMPTY_AGENT_CHANGES,
          }
        : {}),
    };
  });
}

function pushSessionAgentActivity(
  set: (
    partial:
      | Partial<AppState>
      | ((state: AppState) => Partial<AppState>),
  ) => void,
  sessionId: NodeId,
  activity: AgentActivity,
): void {
  set((state) => {
    const agentActivityBySession = appendSessionAgentActivity(
      state.agentActivityBySession,
      sessionId,
      activity,
    );
    return {
      agentActivityBySession,
      ...(state.activeSessionId === sessionId
        ? {
            agentActivity: agentActivityBySession[sessionId] ?? EMPTY_AGENT_ACTIVITY,
          }
        : {}),
    };
  });
}

function pushSessionAgentChange(
  set: (
    partial:
      | Partial<AppState>
      | ((state: AppState) => Partial<AppState>),
  ) => void,
  sessionId: NodeId,
  change: AgentFileChange,
): void {
  set((state) => {
    const agentChangesBySession = appendSessionAgentChange(
      state.agentChangesBySession,
      sessionId,
      change,
    );
    return {
      agentChangesBySession,
      ...(state.activeSessionId === sessionId
        ? {
            agentChanges: agentChangesBySession[sessionId] ?? EMPTY_AGENT_CHANGES,
          }
        : {}),
    };
  });
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
  pendingClarifyBySession: {},
  loadingArchiveSessionId: null,
  loadingArchiveBySession: {},
  loadingCompressSessionId: null,
  loadingCompressBySession: {},
  archivePanelOpen: false,
  viewingArchiveId: null,
  archiveDraft: "",
  archiveDraftBySession: {},
  archiveAlreadyCurrent: false,
  error: null,
  branchFloatStack: [],
  floatOverlayDismissToken: 0,
  projectRoot: null,
  sidecarUrl: loadProjectPrefs().sidecarUrl,
  projectError: null,
  agentActivityBySession: {},
  agentChangesBySession: {},
  agentActivity: EMPTY_AGENT_ACTIVITY,
  agentChanges: EMPTY_AGENT_CHANGES,
  agentPendingPlan: null,
  pendingFileIncludes: [],

  init: () => {
    const store = loadSessionStore();
    const active =
      store.sessions.find((s) => s.id === store.activeSessionId) ??
      store.sessions[0];
    const thread = active?.thread ? normalizeThread(active.thread) : null;
    const prefs = loadProjectPrefs();
    const sessionProject = active?.projectRoot?.trim() || null;
    // One-shot: fold historical feedback into cross-session User Model.
    seedPersistedUserModelFromSessions(
      store.sessions.map((s) => s.feedbackLog),
    );
    set({
      sessions: store.sessions,
      activeSessionId: active?.id ?? null,
      thread,
      sidecarUrl: prefs.sidecarUrl,
      projectRoot: sessionProject,
      projectError: null,
      agentActivityBySession: {},
      agentChangesBySession: {},
      agentActivity: EMPTY_AGENT_ACTIVITY,
      agentChanges: EMPTY_AGENT_CHANGES,
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
      if (!quiet) set({ projectError: t("project.error.needPath", undefined, getLocale()) });
      return;
    }
    // Bind to the session that initiated Connect — ignore UI if user switches mid-await.
    const { sidecarUrl, activeSessionId: bindingSessionId } = get();
    try {
      const { root } = await sidecarOpenProject(path, sidecarUrl);
      try {
        await saveProjectLearningPack({
          settings: get().settings,
          projectRoot: root,
          sidecarUrl,
        });
      } catch (e) {
        console.warn("[projectLearning] failed to refresh project pack", e);
      }
      saveProjectPrefs({ lastPath: root, sidecarUrl });
      const { sessions, activeSessionId } = get();
      const nextSessions = patchSessionProject(
        sessions,
        bindingSessionId,
        root,
      );
      persistSessions(nextSessions, activeSessionId);
      if (activeSessionId === bindingSessionId) {
        set((state) => {
          const maps = clearSessionAgentUiMaps(
            state.agentActivityBySession,
            state.agentChangesBySession,
            bindingSessionId!,
          );
          return {
            sessions: nextSessions,
            projectRoot: root,
            projectError: null,
            ...maps,
            agentActivity: EMPTY_AGENT_ACTIVITY,
            agentChanges: EMPTY_AGENT_CHANGES,
          };
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
              : t("project.error.sidecarHint", undefined, getLocale()),
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
    set((state) => {
      const maps = activeSessionId
        ? clearSessionAgentUiMaps(
            state.agentActivityBySession,
            state.agentChangesBySession,
            activeSessionId,
          )
        : {
            agentActivityBySession: {},
            agentChangesBySession: {},
          };
      return {
        sessions: nextSessions,
        projectRoot: null,
        projectError: null,
        ...maps,
        agentActivity: EMPTY_AGENT_ACTIVITY,
        agentChanges: EMPTY_AGENT_CHANGES,
      };
    });
  },

  approveAgentPlan: async () => {
    const plan = get().agentPendingPlan;
    const sessionId = plan?.sessionId;
    if (!plan || !sessionId) return;
    if (get().activeSessionId !== sessionId) return;
    const cont = pendingAgentContinuations.get(sessionId);
    if (!cont) return;

    const isBranch = Boolean(plan.branchId);
    const branchId = plan.branchId ?? null;
    // Decision-bound feedback: plan approval is a first-class signal.
    {
      const event = createFeedbackEvent({
        targetId: plan.assistantId ?? sessionId,
        pointIndex: 0,
        signal: "accept",
        source: "agent_decision",
        decisionId: `plan_${plan.id}`,
        decisionType: "plan_approval",
        turnId: plan.assistantId,
        phase: "await_approval",
        contextSnapshot: plan.steps.slice(0, 3).join(" | ").slice(0, 160),
      });
      const snapshot = get();
      const committed = commitSessionFeedbackSnapshot(
        {
          sessions: snapshot.sessions,
          activeSessionId: snapshot.activeSessionId,
        },
        sessionId,
        event,
        {
          persistSessions,
          persistUserModel: persistFeedbackIntoUserModel,
        },
      );
      if (committed.committed) {
        set({ sessions: committed.sessions });
      }
    }
    clearPendingAgentPlan(set, sessionId);
    if (isBranch && branchId) {
      setSessionBranchLoading(set, sessionId, branchId);
    } else {
      setSessionMainLoading(set, sessionId, true);
    }
    set({ error: null });

    try {
      await cont();
    } catch (e) {
      if (!isAbortError(e)) {
        set({
          error: e instanceof Error ? e.message : t("agent.error.execution", undefined, getLocale()),
        });
      }
    } finally {
      // Mirror askMain: if continueExecution re-presented a plan, keep turn
      // ownership so patches / the next Allow still work.
      const waitingPlan =
        get().agentPendingPlan?.sessionId === sessionId &&
        pendingAgentContinuations.has(sessionId);
      if (isBranch) {
        const owned = branchAbortBySession.get(sessionId);
        // Only clear if this session still owns the same branch turn
        if ((!owned || owned.branchId === branchId) && !waitingPlan) {
          branchAbortBySession.delete(sessionId);
          setSessionBranchLoading(set, sessionId, null);
        }
      } else if (!waitingPlan) {
        mainTurnsBySession.delete(sessionId);
        setSessionMainLoading(set, sessionId, false);
      }
    }
  },

  rejectAgentPlan: () => {
    const plan = get().agentPendingPlan;
    if (!plan) return;
    if (get().activeSessionId !== plan.sessionId) return;
    const sessionId = plan.sessionId;
    const isBranch = Boolean(plan.branchId);
    {
      const event = createFeedbackEvent({
        targetId: plan.assistantId ?? sessionId,
        pointIndex: 0,
        signal: "reject",
        source: "agent_decision",
        decisionId: `plan_${plan.id}`,
        decisionType: "plan_approval",
        turnId: plan.assistantId,
        phase: "await_approval",
        contextSnapshot: plan.steps.slice(0, 3).join(" | ").slice(0, 160),
      });
      const snapshot = get();
      const committed = commitSessionFeedbackSnapshot(
        {
          sessions: snapshot.sessions,
          activeSessionId: snapshot.activeSessionId,
        },
        sessionId,
        event,
        {
          persistSessions,
          persistUserModel: persistFeedbackIntoUserModel,
        },
      );
      if (committed.committed) {
        set({ sessions: committed.sessions });
      }
    }
    // Dismiss the approval bar only — keep the user's message (and the plan
    // reply) so Cancel never erases their question / fork.
    clearPendingAgentPlan(set, sessionId);
    if (isBranch) {
      branchAbortBySession.delete(sessionId);
      setSessionBranchLoading(set, sessionId, null);
    } else {
      mainTurnsBySession.delete(sessionId);
      setSessionMainLoading(set, sessionId, false);
    }
  },

  setFocus: (focus) => set({ focus }),
  clearError: () => set({ error: null }),

  stopGeneration: () => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return null;

    const turn = mainTurnsBySession.get(sessionId);
    const branch = branchAbortBySession.get(sessionId);
    const pendingPlanForSession =
      get().agentPendingPlan?.sessionId === sessionId
        ? get().agentPendingPlan
        : null;

    // Abort first so in-flight fetch/reader/tool calls start unwinding
    turn?.ctrl.abort();
    branch?.ctrl.abort();
    archiveJobs.abort(sessionId);
    compressJobs.abort(sessionId);

    if (pendingPlanForSession) {
      // Mirror rejectAgentPlan: dismiss approval UI / continuation, but keep the
      // user's question (and plan reply) in the thread.
      clearPendingAgentPlan(set, sessionId);
      mainTurnsBySession.delete(sessionId);
      branchAbortBySession.delete(sessionId);
      setSessionMainLoading(set, sessionId, false);
      setSessionBranchLoading(set, sessionId, null);
      clearSessionSummaryLoading(set, sessionId);
      clearSessionAgentUi(set, sessionId);
      flushSessionPersistence();
      return null;
    }

    // Roll back the incomplete main turn immediately (don't wait for hung finally)
    if (turn) {
      rollbackMainTurn(get, set, { ...turn, sessionId });
      mainTurnsBySession.delete(sessionId);
    }

    branchAbortBySession.delete(sessionId);
    setSessionMainLoading(set, sessionId, false);
    setSessionBranchLoading(set, sessionId, null);
    clearSessionSummaryLoading(set, sessionId);
    flushSessionPersistence();
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
            archiveAlreadyCurrent: false,
          }),
    });
  },

  setViewingArchiveId: (id) => set({ viewingArchiveId: id }),

  setThreadView: (view) => {
    const { sessions, activeSessionId } = get();
    if (!activeSessionId) return;
    const nextSessions = patchActiveSessionMeta(sessions, activeSessionId, {
      threadView: view,
    });
    persistSessions(nextSessions, activeSessionId);
    set({ sessions: nextSessions });
  },

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
      ...(mode === "archive" ? { threadView: "archive" as const } : {}),
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
      get().loadingArchiveBySession[sessionId] ||
      get().loadingMainBySession[sessionId] ||
      get().loadingCompressBySession[sessionId]
    ) {
      return;
    }

    const { settings, thread } = get();
    if (!thread) return;

    const hasContent = thread.messages.some((m) => m.content.trim());
    if (!hasContent) return;

    const {
      archiveHasNewMaterial,
      archiveSystemPrompt,
      archiveTitleFromContent,
      archiveUserPrompt,
      buildArchiveSource,
      buildIncrementalArchiveSource,
      incrementalArchiveSystemPrompt,
      incrementalArchiveUserPrompt,
      lastNonEmptyMessageId,
      resolveBaseArchive,
    } = await import("../lib/archive");

    const throughMessageId = lastNonEmptyMessageId(thread);
    if (!throughMessageId) return;

    const session = getActiveSession(get());
    const previous = resolveBaseArchive(
      session?.archives,
      session?.activeArchiveId,
    );
    const feedbackLog = session?.feedbackLog;

    // Already archived with no new interactions → show existing log inline (no LLM).
    if (previous && !archiveHasNewMaterial(thread, previous, feedbackLog)) {
      const nextSessions = patchActiveSessionMeta(get().sessions, sessionId, {
        contextMode: "archive",
        activeArchiveId: previous.id,
        threadView: "archive",
      });
      persistSessions(nextSessions, get().activeSessionId);
      set({
        sessions: nextSessions,
        archivePanelOpen: false,
        viewingArchiveId: previous.id,
        archiveDraft: "",
        loadingArchiveSessionId: null,
        archiveAlreadyCurrent: true,
        error: null,
      });
      return;
    }

    const llm = withAgentPhaseModel(
      settingsForSession(settings, session),
      "summary",
    );
    const authError = requireApiKey(llm);
    if (authError) {
      set({ error: authError, settingsOpen: true, settingsTab: "api" });
      return;
    }

    const incremental = Boolean(previous);
    const source = incremental
      ? buildIncrementalArchiveSource(previous!, thread, { feedbackLog })
      : buildArchiveSource(thread, { feedbackLog });
    if (!source.trim()) return;

    const ctrl = archiveJobs.start(sessionId);

    // Capture live (or prior archive) context so empty/failed/aborted
    // generation can restore instead of leaving stale archive-mode meta.
    const priorContextMode = session?.contextMode ?? "live";
    const priorThreadView = session?.threadView;
    const priorActiveArchiveId = session?.activeArchiveId ?? null;
    const priorViewingArchiveId = get().viewingArchiveId;
    let archiveCommitted = false;

    // Stream draft inline on the main page (no modal).
    set((state) => ({
      loadingArchiveBySession: {
        ...state.loadingArchiveBySession,
        [sessionId]: true,
      },
      archiveDraftBySession: {
        ...state.archiveDraftBySession,
        [sessionId]: "",
      },
      ...(state.activeSessionId === sessionId
        ? {
            loadingArchiveSessionId: sessionId,
            archivePanelOpen: false,
            archiveDraft: "",
            viewingArchiveId: null,
            archiveAlreadyCurrent: false,
            error: null,
          }
        : {}),
    }));
    // Switch main view to archive mode so the draft appears in-place.
    {
      const nextSessions = patchActiveSessionMeta(get().sessions, sessionId, {
        contextMode: "archive",
        threadView: "archive",
      });
      persistSessions(nextSessions, get().activeSessionId);
      set({ sessions: nextSessions });
    }

    try {
      let content = "";
      const locale = getLocale();
      await streamChat(
        llm,
        [
          {
            role: "system",
            content: incremental
              ? incrementalArchiveSystemPrompt(locale)
              : archiveSystemPrompt(locale),
          },
          {
            role: "user",
            content: incremental
              ? incrementalArchiveUserPrompt(source, locale)
              : archiveUserPrompt(source, locale),
          },
        ],
        (delta) => {
          if (!archiveJobs.owns(sessionId, ctrl)) return;
          content += delta;
          set((state) => ({
            archiveDraftBySession: {
              ...state.archiveDraftBySession,
              [sessionId]: content,
            },
            ...(state.activeSessionId === sessionId
              ? { archiveDraft: content }
              : {}),
          }));
        },
        { signal: ctrl.signal, temperature: 0.2 },
      );

      if (!archiveJobs.owns(sessionId, ctrl)) return;

      const trimmed = content.trim();
      if (!trimmed) {
        if (get().activeSessionId === sessionId) {
          set({ error: t("archive.error.empty", undefined, getLocale()) });
        }
        return;
      }

      const snapshot: ArchiveSnapshot = {
        id: createId(),
        createdAt: Date.now(),
        title: archiveTitleFromContent(trimmed, t("archive.defaultTitle", undefined, getLocale())),
        content: trimmed,
        throughMessageId,
        storage: "local",
      };

      // Persist UI immediately — project sidecar write must not delay compress / view.
      const { sessions } = get();
      const current = sessions.find((s) => s.id === sessionId);
      const archives = [...(current?.archives ?? []), snapshot];
      const nextSessions = patchActiveSessionMeta(sessions, sessionId, {
        archives,
        contextMode: "archive",
        activeArchiveId: snapshot.id,
        threadView: "archive",
      });
      persistSessions(nextSessions, get().activeSessionId);
      archiveCommitted = true;
      set({
        sessions: nextSessions,
        ...(get().activeSessionId === sessionId
          ? {
              viewingArchiveId: snapshot.id,
              archiveDraft: "",
              archivePanelOpen: false,
              archiveAlreadyCurrent: false,
            }
          : {}),
      });

      const currentSession = get().sessions.find((s) => s.id === sessionId);
      const projectRoot = currentSession?.projectRoot?.trim() || null;
      const { sidecarUrl } = get();
      if (projectRoot) {
        void saveArchiveMarkdownToProject({
          snapshot,
          projectRoot,
          sidecarUrl,
        }).then((filePath) => {
          if (!filePath) return;
          const latest = get().sessions;
          const sess = latest.find((s) => s.id === sessionId);
          if (!sess?.archives?.some((a) => a.id === snapshot.id)) return;
          const patched = patchActiveSessionMeta(latest, sessionId, {
            archives: (sess.archives ?? []).map((a) =>
              a.id === snapshot.id
                ? { ...a, filePath, storage: "project" as const }
                : a,
            ),
          });
          persistSessions(patched, get().activeSessionId);
          set({ sessions: patched });
        });
      }

      console.info(
        `[archive] sourceChars=${source.length} incremental=${incremental}`,
      );

      if (isCompressAfterArchiveEnabled(settings)) {
        // Reuse archive draft — do not re-summarize the same raw thread.
        // Defer until `finally` clears this session's archive loading entry.
        const packSource = formatArchiveDraftAsCompressSource(trimmed);
        queueMicrotask(() => {
          void get().compressContext({
            sourceOverride: packSource,
            sessionId,
          });
        });
      }
    } catch (e) {
      if (!isAbortError(e) && get().activeSessionId === sessionId) {
        set({
          error: e instanceof Error ? e.message : t("archive.error.request", undefined, getLocale()),
        });
      }
    } finally {
      // `abort()` removes the controller from the registry before the stream
      // unwinds, so `release` alone misses stop/cancel. Still clean up when
      // this job was aborted and nothing replaced it.
      const released = archiveJobs.release(sessionId, ctrl);
      const abortedWithoutReplacement =
        ctrl.signal.aborted && !released && !archiveJobs.has(sessionId);
      if (!released && !abortedWithoutReplacement) return;

      if (!archiveCommitted) {
        const restored = patchActiveSessionMeta(get().sessions, sessionId, {
          contextMode: priorContextMode,
          activeArchiveId: priorActiveArchiveId,
          ...(priorThreadView !== undefined
            ? { threadView: priorThreadView }
            : { threadView: "evolution" as const }),
        });
        persistSessions(restored, get().activeSessionId);
        set((state) => {
          const loadingArchiveBySession = {
            ...state.loadingArchiveBySession,
          };
          const archiveDraftBySession = { ...state.archiveDraftBySession };
          delete loadingArchiveBySession[sessionId];
          delete archiveDraftBySession[sessionId];
          return {
            sessions: restored,
            loadingArchiveBySession,
            archiveDraftBySession,
            ...(state.activeSessionId === sessionId
              ? {
                  loadingArchiveSessionId: null,
                  archiveDraft: "",
                  viewingArchiveId: priorViewingArchiveId,
                }
              : {}),
          };
        });
      } else {
        set((state) => {
          const loadingArchiveBySession = {
            ...state.loadingArchiveBySession,
          };
          const archiveDraftBySession = { ...state.archiveDraftBySession };
          delete loadingArchiveBySession[sessionId];
          delete archiveDraftBySession[sessionId];
          return {
            loadingArchiveBySession,
            archiveDraftBySession,
            ...(state.activeSessionId === sessionId
              ? { loadingArchiveSessionId: null, archiveDraft: "" }
              : {}),
          };
        });
      }
    }
  },

  compressContext: async (opts) => {
    const sessionId = resolveSessionJobTarget(
      get().activeSessionId,
      opts?.sessionId,
    );
    if (!sessionId) return;
    if (
      get().loadingCompressBySession[sessionId] ||
      get().loadingMainBySession[sessionId] ||
      get().loadingArchiveBySession[sessionId]
    ) {
      return;
    }

    const { settings, sidecarUrl } = get();
    const thread = getSessionThread(get, sessionId);
    if (!thread) return;

    const override = opts?.sourceOverride?.trim() ?? "";
    const hasContent =
      Boolean(override) || thread.messages.some((m) => m.content.trim());
    if (!hasContent) return;

    const session = get().sessions.find((item) => item.id === sessionId);
    if (!session) return;
    const projectRoot = session.projectRoot?.trim() || null;
    const llm = withAgentPhaseModel(
      settingsForSession(settings, session),
      "summary",
    );
    const authError = requireApiKey(llm);
    if (authError) {
      set({ error: authError, settingsOpen: true, settingsTab: "api" });
      return;
    }

    const {
      buildCompressSource,
      resolveCompressArchive,
    } = await import("../lib/contextCompressSource");
    const archive = resolveCompressArchive(session);
    const source =
      override ||
      buildCompressSource(thread, {
        feedbackLog: session.feedbackLog,
        archive,
      });
    if (!source.trim()) return;

    const ctrl = compressJobs.start(sessionId);

    set((state) => ({
      loadingCompressBySession: {
        ...state.loadingCompressBySession,
        [sessionId]: true,
      },
      ...(state.activeSessionId === sessionId
        ? { loadingCompressSessionId: sessionId, error: null }
        : {}),
    }));

    try {
      const cached = session?.contextMemory ?? null;
      const existing =
        cached &&
        (cached.summary.trim() ||
          cached.tasks.trim() ||
          cached.decisions.trim())
          ? cached
          : await loadContextMemoryPack({
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
          if (!compressJobs.owns(sessionId, ctrl)) return;
          content += delta;
        },
        { signal: ctrl.signal, temperature: 0.2 },
      );

      if (!compressJobs.owns(sessionId, ctrl)) return;

      const parsed = parseCompressedOutput(content);
      if (
        !parsed.summary.trim() &&
        !parsed.tasks.trim() &&
        !parsed.decisions.trim()
      ) {
        if (get().activeSessionId === sessionId) {
          set({ error: t("compress.error.empty", undefined, getLocale()) });
        }
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
        session: get().sessions.find((s) => s.id === sessionId) ?? session,
        projectRoot,
        sidecarUrl,
        signal: ctrl.signal,
      });

      if (!compressJobs.owns(sessionId, ctrl)) return;

      const nextSessions = patchActiveSessionMeta(get().sessions, sessionId, {
        contextMemory: saved,
        ...(saved.summary.trim()
          ? {
              sessionMemory: {
                summary: saved.summary.trim().slice(0, 2000),
                updatedAt: saved.updatedAt,
              },
            }
          : {}),
      });
      persistSessions(nextSessions, get().activeSessionId);
      set({ sessions: nextSessions });

      console.info(
        `[compress] sourceChars=${source.length} reusedArchive=${Boolean(override || archive?.content.trim())}`,
      );
    } catch (e) {
      if (!isAbortError(e) && get().activeSessionId === sessionId) {
        set({
          error:
            e instanceof Error ? e.message : t("compress.error.request", undefined, getLocale()),
        });
      }
    } finally {
      if (compressJobs.release(sessionId, ctrl)) {
        set((state) => {
          const loadingCompressBySession = {
            ...state.loadingCompressBySession,
          };
          delete loadingCompressBySession[sessionId];
          return {
            loadingCompressBySession,
            ...(state.activeSessionId === sessionId
              ? { loadingCompressSessionId: null }
              : {}),
          };
        });
      }
    }
  },

  setPointVerdict: (targetId, pointIndex, verdict) => {
    const { thread, sessions, activeSessionId } = get();
    if (!thread) return;

    type Maps = {
      pointVerdicts: PointVerdictMap;
      pointDoubts: PointDoubtMap;
      pointAttributions: PointAttributionMap;
    };

    let cleared = false;
    let nextSignal: PointVerdict | null = verdict;

    const apply = (
      currentVerdicts: PointVerdictMap | undefined,
      currentDoubts: PointDoubtMap | undefined,
      currentAttrs: PointAttributionMap | undefined,
    ): Maps => {
      const nextVerdicts = { ...(currentVerdicts ?? {}) };
      const nextDoubts = { ...(currentDoubts ?? {}) };
      const nextAttrs = { ...(currentAttrs ?? {}) };
      if (nextVerdicts[pointIndex] === verdict) {
        delete nextVerdicts[pointIndex];
        delete nextDoubts[pointIndex];
        delete nextAttrs[pointIndex];
        cleared = true;
        nextSignal = null;
      } else {
        nextVerdicts[pointIndex] = verdict;
        if (verdict === "accept") {
          delete nextDoubts[pointIndex];
          delete nextAttrs[pointIndex];
        } else if (verdict !== "unsure") {
          delete nextDoubts[pointIndex];
        }
      }
      return {
        pointVerdicts: nextVerdicts,
        pointDoubts: nextDoubts,
        pointAttributions: nextAttrs,
      };
    };

    let nextThread: ThreadRoot;
    const replyTarget = parseBranchReplyVerdictTarget(targetId);
    if (replyTarget) {
      const branch = findBranchInThread(thread, replyTarget.branchId);
      const reply = branch?.replies?.[replyTarget.replyIndex];
      if (!branch || !reply) return;
      nextThread = patchBranchReplyInThread(
        thread,
        replyTarget.branchId,
        replyTarget.replyIndex,
        apply(reply.pointVerdicts, reply.pointDoubts, reply.pointAttributions),
      );
    } else {
      const msg = thread.messages.find((m) => m.id === targetId);
      if (msg) {
        nextThread = patchMessage(
          thread,
          targetId,
          apply(msg.pointVerdicts, msg.pointDoubts, msg.pointAttributions),
        );
      } else {
        const branch = findBranchInThread(thread, targetId);
        if (!branch) return;
        nextThread = patchBranchInThread(
          thread,
          targetId,
          apply(
            branch.pointVerdicts,
            branch.pointDoubts,
            branch.pointAttributions,
          ),
        );
      }
    }

    let nextSessions = upsertActiveSession(
      sessions,
      activeSessionId,
      nextThread,
    );
    if (!cleared && nextSignal && activeSessionId) {
      const event = createFeedbackEvent({
        targetId,
        pointIndex,
        signal: nextSignal,
        decisionId: `${targetId}:${pointIndex}`,
        decisionType: "point_verdict",
        phase: "reflect",
        contextSnapshot: `point:${pointIndex}`,
      });
      const content = resolvePointContent(nextThread, targetId, pointIndex);
      nextSessions = applySessionFeedback(
        nextSessions,
        activeSessionId,
        event,
        content,
      );
    }
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
      currentAttrs: PointAttributionMap | undefined,
    ) => {
      const nextVerdicts = { ...(currentVerdicts ?? {}) };
      const nextDoubts = { ...(currentDoubts ?? {}) };
      const nextAttrs = { ...(currentAttrs ?? {}) };
      if (trimmed) {
        nextVerdicts[pointIndex] = "unsure";
        nextDoubts[pointIndex] = trimmed;
      } else {
        delete nextDoubts[pointIndex];
        // Keep unsure + attribution if still marked unsure
      }
      return {
        pointVerdicts: nextVerdicts,
        pointDoubts: nextDoubts,
        pointAttributions: nextAttrs,
      };
    };

    let nextThread: ThreadRoot;
    const replyTarget = parseBranchReplyVerdictTarget(targetId);
    if (replyTarget) {
      const branch = findBranchInThread(thread, replyTarget.branchId);
      const reply = branch?.replies?.[replyTarget.replyIndex];
      if (!branch || !reply) return;
      nextThread = patchBranchReplyInThread(
        thread,
        replyTarget.branchId,
        replyTarget.replyIndex,
        apply(reply.pointVerdicts, reply.pointDoubts, reply.pointAttributions),
      );
    } else {
      const msg = thread.messages.find((m) => m.id === targetId);
      if (msg) {
        nextThread = patchMessage(
          thread,
          targetId,
          apply(msg.pointVerdicts, msg.pointDoubts, msg.pointAttributions),
        );
      } else {
        const branch = findBranchInThread(thread, targetId);
        if (!branch) return;
        nextThread = patchBranchInThread(
          thread,
          targetId,
          apply(
            branch.pointVerdicts,
            branch.pointDoubts,
            branch.pointAttributions,
          ),
        );
      }
    }

    let nextSessions = upsertActiveSession(
      sessions,
      activeSessionId,
      nextThread,
    );
    if (trimmed && activeSessionId) {
      const event = createFeedbackEvent({
        targetId,
        pointIndex,
        signal: "unsure",
        note: trimmed,
        decisionId: `${targetId}:${pointIndex}`,
        decisionType: "point_verdict",
        phase: "reflect",
        contextSnapshot: `point:${pointIndex}`,
      });
      const content = resolvePointContent(nextThread, targetId, pointIndex);
      nextSessions = applySessionFeedback(
        nextSessions,
        activeSessionId,
        event,
        content,
      );
    }
    persistSessions(nextSessions, activeSessionId);
    set({ thread: nextThread, sessions: nextSessions });
  },

  setPointAttribution: (targetId, pointIndex, attribution) => {
    const { thread, sessions, activeSessionId } = get();
    if (!thread) return;

    let signal: PointVerdict | undefined;
    let note: string | undefined;

    const apply = (
      currentVerdicts: PointVerdictMap | undefined,
      currentDoubts: PointDoubtMap | undefined,
      currentAttrs: PointAttributionMap | undefined,
    ) => {
      const nextVerdicts = { ...(currentVerdicts ?? {}) };
      const nextDoubts = { ...(currentDoubts ?? {}) };
      const nextAttrs = { ...(currentAttrs ?? {}) };
      signal = nextVerdicts[pointIndex];
      note = nextDoubts[pointIndex];
      if (!signal || (signal !== "unsure" && signal !== "reject")) {
        return {
          pointVerdicts: nextVerdicts,
          pointDoubts: nextDoubts,
          pointAttributions: nextAttrs,
        };
      }
      nextAttrs[pointIndex] = attribution;
      return {
        pointVerdicts: nextVerdicts,
        pointDoubts: nextDoubts,
        pointAttributions: nextAttrs,
      };
    };

    let nextThread: ThreadRoot;
    const replyTarget = parseBranchReplyVerdictTarget(targetId);
    if (replyTarget) {
      const branch = findBranchInThread(thread, replyTarget.branchId);
      const reply = branch?.replies?.[replyTarget.replyIndex];
      if (!branch || !reply) return;
      nextThread = patchBranchReplyInThread(
        thread,
        replyTarget.branchId,
        replyTarget.replyIndex,
        apply(reply.pointVerdicts, reply.pointDoubts, reply.pointAttributions),
      );
    } else {
      const msg = thread.messages.find((m) => m.id === targetId);
      if (msg) {
        nextThread = patchMessage(
          thread,
          targetId,
          apply(msg.pointVerdicts, msg.pointDoubts, msg.pointAttributions),
        );
      } else {
        const branch = findBranchInThread(thread, targetId);
        if (!branch) return;
        nextThread = patchBranchInThread(
          thread,
          targetId,
          apply(
            branch.pointVerdicts,
            branch.pointDoubts,
            branch.pointAttributions,
          ),
        );
      }
    }

    let nextSessions = upsertActiveSession(
      sessions,
      activeSessionId,
      nextThread,
    );
    if (signal && (signal === "unsure" || signal === "reject") && activeSessionId) {
      const event = createFeedbackEvent({
        targetId,
        pointIndex,
        signal,
        attribution,
        note,
        source: "hypothesis_confirm",
      });
      const content = resolvePointContent(nextThread, targetId, pointIndex);
      nextSessions = applySessionFeedback(
        nextSessions,
        activeSessionId,
        event,
        content,
      );
    }
    persistSessions(nextSessions, activeSessionId);
    set({ thread: nextThread, sessions: nextSessions });
  },

  denyPointHypothesis: (targetId, pointIndex) => {
    const { thread, sessions, activeSessionId } = get();
    if (!thread || !activeSessionId) return;

    let signal: PointVerdict | undefined;
    const replyTarget = parseBranchReplyVerdictTarget(targetId);
    if (replyTarget) {
      const branch = findBranchInThread(thread, replyTarget.branchId);
      signal = branch?.replies?.[replyTarget.replyIndex]?.pointVerdicts?.[pointIndex];
    } else {
      const msg = thread.messages.find((m) => m.id === targetId);
      signal =
        msg?.pointVerdicts?.[pointIndex] ??
        findBranchInThread(thread, targetId)?.pointVerdicts?.[pointIndex];
    }
    if (signal !== "unsure" && signal !== "reject") return;

    const event = createFeedbackEvent({
      targetId,
      pointIndex,
      signal,
      source: "hypothesis_deny",
      note: "hypothesis_denied",
      weight: 0,
    });
    const content = resolvePointContent(thread, targetId, pointIndex);
    const nextSessions = applySessionFeedback(
      sessions,
      activeSessionId,
      event,
      content,
    );
    persistSessions(nextSessions, activeSessionId);
    set({ sessions: nextSessions });
  },

  recordPassiveCopy: (targetId) => {
    const { thread, sessions, activeSessionId } = get();
    if (!activeSessionId) return;
    const event = createFeedbackEvent({
      targetId,
      pointIndex: 0,
      signal: "accept",
      source: "passive_copy",
      note: "copied_answer",
    });
    const content =
      thread?.messages.find((m) => m.id === targetId)?.content ??
      (thread ? findBranchInThread(thread, targetId)?.assistantMessage : "") ??
      "";
    const nextSessions = applySessionFeedback(
      sessions,
      activeSessionId,
      event,
      content,
    );
    persistSessions(nextSessions, activeSessionId);
    set({ sessions: nextSessions });
  },

  openBranchFloat: (branchId, rect, parentBranchId = null, opts) => {
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
          opts,
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
    set((state) => {
      if (state.branchFloatStack.length === 0) return state;
      return {
        branchFloatStack: [],
        floatOverlayDismissToken: state.floatOverlayDismissToken + 1,
      };
    }),

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
      loadingArchiveSessionId: null,
      loadingCompressSessionId: null,
      projectRoot: null,
      projectError: null,
      agentActivity: EMPTY_AGENT_ACTIVITY,
      agentChanges: EMPTY_AGENT_CHANGES,
    });
    restoreSessionProject(get, set, session.id, null, sidecarUrl);
  },

  ensureActiveSessionForImport: () => {
    const { sessions, activeSessionId } = get();
    if (activeSessionId && sessions.some((s) => s.id === activeSessionId)) {
      return activeSessionId;
    }
    const session = createEmptySession();
    const nextSessions = [session, ...sessions];
    persistSessions(nextSessions, session.id);
    set({
      sessions: nextSessions,
      activeSessionId: session.id,
      thread: null,
      focus: { type: "root" },
      loadingArchiveSessionId: null,
      loadingCompressSessionId: null,
      archiveDraft: "",
    });
    return session.id;
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
      ...projectSessionJobUi(
        sessionId,
        get().loadingArchiveBySession,
        get().loadingCompressBySession,
        get().archiveDraftBySession,
      ),
      projectRoot: targetProject,
      projectError: null,
      ...projectAgentSessionUi(
        sessionId,
        get().agentActivityBySession,
        get().agentChangesBySession,
      ),
      pendingFileIncludes: [],
    });
    restoreSessionProject(get, set, sessionId, targetProject, sidecarUrl);
  },

  deleteSession: (sessionId) => {
    abortSessionGeneration(sessionId);
    clearPendingAgentPlan(set, sessionId);
    setSessionMainLoading(set, sessionId, false);
    setSessionBranchLoading(set, sessionId, null);
    clearSessionSummaryLoading(set, sessionId);

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
        agentActivityBySession: {},
        agentChangesBySession: {},
        agentActivity: EMPTY_AGENT_ACTIVITY,
        agentChanges: EMPTY_AGENT_CHANGES,
        loadingMainBySession: {},
        loadingBranchBySession: {},
        pendingClarifyBySession: {},
        loadingArchiveSessionId: null,
        loadingArchiveBySession: {},
        loadingCompressSessionId: null,
        loadingCompressBySession: {},
        archiveDraftBySession: {},
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
    set((state) => {
      const maps = clearSessionAgentUiMaps(
        state.agentActivityBySession,
        state.agentChangesBySession,
        sessionId,
      );
      return {
        sessions: nextSessions,
        activeSessionId: nextActive,
        thread: nextThread,
        ...projectSessionJobUi(
          nextActive,
          state.loadingArchiveBySession,
          state.loadingCompressBySession,
          state.archiveDraftBySession,
        ),
        focus: { type: "root" },
        error: null,
        ...maps,
        ...projectAgentSessionUi(
          nextActive,
          maps.agentActivityBySession,
          maps.agentChangesBySession,
        ),
        ...(sessionId === activeSessionId
          ? {
              projectRoot: nextProject,
              projectError: null,
            }
          : {}),
      };
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
      agentActivityBySession: {},
      agentChangesBySession: {},
      agentActivity: EMPTY_AGENT_ACTIVITY,
      agentChanges: EMPTY_AGENT_CHANGES,
      projectRoot: null,
      projectError: null,
      loadingMainBySession: {},
      loadingBranchBySession: {},
      pendingClarifyBySession: {},
      loadingArchiveSessionId: null,
      loadingArchiveBySession: {},
      loadingCompressSessionId: null,
      loadingCompressBySession: {},
      archiveDraftBySession: {},
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
      agentActivityBySession: {},
      agentChangesBySession: {},
      agentActivity: EMPTY_AGENT_ACTIVITY,
      agentChanges: EMPTY_AGENT_CHANGES,
      projectRoot: nextProject,
      projectError: null,
      loadingMainBySession: {},
      loadingBranchBySession: {},
      pendingClarifyBySession: {},
      loadingArchiveSessionId: null,
      loadingArchiveBySession: {},
      loadingCompressSessionId: null,
      loadingCompressBySession: {},
      archiveDraftBySession: {},
      agentPendingPlan: null,
    });
    if (activeSessionId) {
      restoreSessionProject(get, set, activeSessionId, nextProject, sidecarUrl);
    }
  },

  renameSession: (sessionId, title) => {
    const trimmed = normalizeStoredSessionTitle(title);
    if (!trimmed) return false;

    const isDefault = trimmed === DEFAULT_SESSION_TITLE;
    const display = isDefault
      ? DEFAULT_SESSION_TITLE
      : trimmed.length > 60
        ? `${trimmed.slice(0, 60)}…`
        : trimmed;
    const { sessions, activeSessionId } = get();
    const nextSessions = sessions.map((s) =>
      s.id === sessionId
        ? {
            ...s,
            title: display,
            titleLocked: !isDefault,
            updatedAt: Date.now(),
          }
        : s,
    );
    persistSessions(nextSessions, activeSessionId);
    set({ sessions: nextSessions });
    return true;
  },

  togglePinSession: (sessionId) => {
    const { sessions, activeSessionId } = get();
    const nextSessions = sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const pinned =
        typeof s.pinnedAt === "number" && s.pinnedAt > 0;
      return {
        ...s,
        pinnedAt: pinned ? null : Date.now(),
      };
    });
    persistSessions(nextSessions, activeSessionId);
    set({ sessions: nextSessions });
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

  setSessionMemory: (summary, sessionId) => {
    const { sessions, activeSessionId } = get();
    const targetId = sessionId ?? activeSessionId;
    if (!targetId || !sessions.some((s) => s.id === targetId)) return;
    const trimmed = summary.trim();
    const nextSessions = patchActiveSessionMeta(sessions, targetId, {
      sessionMemory: trimmed
        ? { summary: trimmed.slice(0, 4000), updatedAt: Date.now() }
        : null,
    });
    persistSessions(nextSessions, activeSessionId);
    set({ sessions: nextSessions });
  },

  saveContextMemoryFields: async (fields, opts) => {
    const { settings, sidecarUrl, sessions, activeSessionId } = get();
    const sessionId = opts?.sessionId ?? activeSessionId;
    if (!sessionId) return;
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const projectRoot =
      session.projectRoot?.trim() || get().projectRoot || null;
    const existing =
      (await loadContextMemoryPack({
        settings,
        session,
        projectRoot,
        sidecarUrl,
      })) ?? {
        summary: "",
        tasks: "",
        decisions: "",
        updatedAt: Date.now(),
        storage: "local" as const,
      };
    const pack = {
      ...existing,
      summary: fields.summary ?? existing.summary,
      tasks: fields.tasks ?? existing.tasks,
      decisions: fields.decisions ?? existing.decisions,
      updatedAt: Date.now(),
    };
    // Re-read the initiating session after awaits — do not retarget to the
    // currently active note if the user switched mid-import.
    const latestSession =
      get().sessions.find((s) => s.id === sessionId) ?? session;
    const saved = await saveContextMemoryPack({
      pack,
      settings,
      session: latestSession,
      projectRoot:
        latestSession.projectRoot?.trim() || get().projectRoot || null,
      sidecarUrl: get().sidecarUrl,
    });
    const nextSessions = patchActiveSessionMeta(get().sessions, sessionId, {
      contextMemory: saved,
    });
    persistSessions(nextSessions, get().activeSessionId);
    set({ sessions: nextSessions });
  },

  setShareMemory: (sessionId, share) => {
    const { sessions, activeSessionId } = get();
    if (!sessions.some((s) => s.id === sessionId)) return;
    const nextSessions = sessions.map((s) =>
      s.id === sessionId
        ? { ...s, shareMemory: share, updatedAt: Date.now() }
        : s,
    );
    persistSessions(nextSessions, activeSessionId);
    set({ sessions: nextSessions });
  },

  addFileInclude: (path) => {
    const cleaned = path.replace(/^\.\/+/, "").trim();
    if (!cleaned || cleaned.includes("..")) return;
    set((s) => {
      if (s.pendingFileIncludes.includes(cleaned)) return {};
      return { pendingFileIncludes: [...s.pendingFileIncludes, cleaned].slice(0, 4) };
    });
  },

  removeFileInclude: (path) => {
    set((s) => ({ pendingFileIncludes: s.pendingFileIncludes.filter((p) => p !== path) }));
  },

  clearFileIncludes: () => set({ pendingFileIncludes: [] }),

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
    // A new user message supersedes any stale pending plan from an earlier turn.
    if (get().agentPendingPlan?.sessionId === sessionId) {
      clearPendingAgentPlan(set, sessionId);
    }

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
    });
    clearSessionAgentUi(set, sessionId);
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

    const timing: ThinkingTimingState = {
      requestStartedAt: Date.now(),
      firstReasoningAt: null,
      lastReasoningAt: null,
      firstAnswerAt: null,
    };
    let apiReasoning = "";

    const isOwned = () => {
      const owned = mainTurnsBySession.get(sessionId);
      return Boolean(owned && owned.ctrl === ctrl && !signal.aborted);
    };

    const patchAssistantState = (patch: {
      content?: string;
      reasoning?: string;
        thinkingSeconds?: number;
    }) => {
      if (!isOwned()) return;
      const current = getSessionThread(get, sessionId);
      if (!current) return;
      const reasoningText =
        patch.reasoning !== undefined
          ? patch.reasoning.trim()
          : apiReasoning.trim();
      if (patch.reasoning !== undefined) {
        apiReasoning = patch.reasoning;
      }
      const thinkingSeconds =
        patch.thinkingSeconds ??
        (reasoningText
          ? updateThinkingTiming(timing, {
              ...patch,
              reasoning: reasoningText,
            })
          : undefined);
      const next = patchMessage(current, assistantId, {
        ...patch,
        ...(patch.reasoning !== undefined
          ? { reasoning: reasoningText || undefined }
          : {}),
        ...(thinkingSeconds != null ? { thinkingSeconds } : {}),
      });
      commitSessionThread(get, set, sessionId, next, "scheduled");
    };

    try {
      const { projectRoot, sidecarUrl, pendingFileIncludes } = get();
      const includeFiles = [...pendingFileIncludes];
      if (includeFiles.length > 0) {
        set({ pendingFileIncludes: [] });
      }
      await runLoadedAgentTurn({
        llm,
        settings,
        locale: getLocale(),
        session: getActiveSession(get()),
        userText: trimmed,
        thread,
        projectRoot,
        sidecarUrl,
        signal,
        isOwned,
        includeFiles,
        patchContent: patchAssistantState,
        onAgentActivity: (activity) => {
          pushSessionAgentActivity(set, sessionId, activity);
        },
        onAgentChange: (change) => {
          pushSessionAgentChange(set, sessionId, change);
        },
        onRepairContextToLive: () => {
          const repaired = patchActiveSessionMeta(get().sessions, sessionId, {
            contextMode: "live",
            activeArchiveId: null,
          });
          persistSessions(repaired, sessionId);
          set({ sessions: repaired });
        },
        onDecisionFeedback: (events) => {
          commitDecisionFeedbackBatch(get, set, sessionId, events);
        },
        onAwaitPlanApproval: ({
          planText,
          steps,
          commands,
          totalStepCount,
          continueExecution,
        }) => {
          pendingAgentContinuations.set(sessionId, continueExecution);
          setSessionMainLoading(set, sessionId, false);
          set({
            agentPendingPlan: {
              id: createId(),
              sessionId,
              planText,
              steps,
              commands,
              totalStepCount,
              userPrompt: trimmed,
              userId,
              assistantId,
            },
          });
        },
      });
    } catch (e) {
      if (!isAbortError(e)) {
        set({ error: e instanceof Error ? e.message : t("chat.error.answer", undefined, getLocale()) });
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
      flushSessionPersistence();
    }
    return "started";
  },

  askBranch: async (parentId, parentContent, anchor, question, opts) => {
    const trimmed = question.trim();
    if (!trimmed) return;

    const { settings, thread, activeSessionId, sessions } = get();
    if (!thread || !activeSessionId) return;
    const sessionId = activeSessionId;

    const loadingMain = Boolean(get().loadingMainBySession[sessionId]);
    const loadingBranch = Boolean(get().loadingBranchBySession[sessionId]);

    // Clarify can run while main is still streaming; if a branch turn is
    // already in flight, queue at most one Clarify and run it when free.
    if (!canStartAskBranch({ loadingMain, loadingBranch })) {
      if (shouldQueueClarify({ loadingMain, loadingBranch })) {
        set((state) => ({
          pendingClarifyBySession: {
            ...state.pendingClarifyBySession,
            [sessionId]: {
              parentId,
              parentContent,
              anchor,
              question: trimmed,
            },
          },
        }));
        return;
      }
      return;
    }

    clearPendingClarifyState(set, sessionId);

    const pending = get().agentPendingPlan;
    if (
      pending?.sessionId === sessionId &&
      shouldClearPendingPlanForClarify({
        loadingMain: Boolean(get().loadingMainBySession[sessionId]),
        pendingBranchId: pending.branchId ?? null,
      })
    ) {
      clearPendingAgentPlan(set, sessionId);
    }

    const llm = settingsForSession(settings, getActiveSession(get()));
    const authError = requireApiKey(llm);
    if (authError) {
      set({ error: authError, settingsOpen: true, settingsTab: "api" });
      return;
    }

    const locale = getLocale();
    let extraMessages;
    try {
      // Resolve clarify context before persisting a stub fork.
      extraMessages = buildClarifyAddendumMessages(
        thread,
        parentId,
        anchor.quotedText,
        trimmed,
        locale,
      );
    } catch (e) {
      set({
        error:
          e instanceof Error
            ? e.message
            : t("fork.error.context", undefined, getLocale()),
      });
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
    clearSessionAgentUi(set, sessionId);
    setSessionBranchLoading(set, sessionId, branch.id);

    const branchId = branch.id;

    const priorBranch = branchAbortBySession.get(sessionId);
    priorBranch?.ctrl.abort();
    const branchCtrl = new AbortController();
    branchAbortBySession.set(sessionId, { ctrl: branchCtrl, branchId });
    const branchSignal = branchCtrl.signal;

    const timing: ThinkingTimingState = {
      requestStartedAt: Date.now(),
      firstReasoningAt: null,
      lastReasoningAt: null,
      firstAnswerAt: null,
    };
    let apiReasoning = "";

    void (async () => {
      const isOwned = () => {
        const owned = branchAbortBySession.get(sessionId);
        return Boolean(
          owned && owned.ctrl === branchCtrl && !branchSignal.aborted,
        );
      };

      const patchBranchState = (patch: {
        content?: string;
        reasoning?: string;
        thinkingSeconds?: number;
      }) => {
        if (!isOwned()) return;
        const current = getSessionThread(get, sessionId);
        if (!current) return;
        const reasoningText =
          patch.reasoning !== undefined
            ? patch.reasoning.trim()
            : apiReasoning.trim();
        if (patch.reasoning !== undefined) {
          apiReasoning = patch.reasoning;
        }
        const thinkingSeconds =
          patch.thinkingSeconds ??
          (reasoningText
            ? updateThinkingTiming(timing, {
                ...patch,
                reasoning: reasoningText,
              })
            : undefined);
        const updated = patchBranchInThread(current, branchId, {
          ...(patch.content !== undefined
            ? { assistantMessage: patch.content }
            : {}),
          ...(patch.reasoning !== undefined
            ? { reasoning: reasoningText || undefined }
            : {}),
          ...(thinkingSeconds != null ? { thinkingSeconds } : {}),
        });
        commitSessionThread(get, set, sessionId, updated, "scheduled");
      };

      try {
        const { projectRoot, sidecarUrl } = get();
        await runLoadedAgentTurn({
          llm,
          settings,
          locale,
          session: getActiveSession(get()),
          userText: trimmed,
          thread: nextThread,
          projectRoot,
          sidecarUrl,
          signal: branchSignal,
          extraMessages,
          isOwned,
          patchContent: patchBranchState,
          onAgentActivity: (activity) => {
            pushSessionAgentActivity(set, sessionId, activity);
          },
          onAgentChange: (change) => {
            pushSessionAgentChange(set, sessionId, change);
          },
          onRepairContextToLive: () => {
            const repaired = patchActiveSessionMeta(get().sessions, sessionId, {
              contextMode: "live",
              activeArchiveId: null,
            });
            persistSessions(repaired, sessionId);
            set({ sessions: repaired });
          },
          onDecisionFeedback: (events) => {
            commitDecisionFeedbackBatch(get, set, sessionId, events);
          },
          onAwaitPlanApproval: ({
            planText,
            steps,
            commands,
            totalStepCount,
            continueExecution,
          }) => {
            pendingAgentContinuations.set(sessionId, continueExecution);
            setSessionBranchLoading(set, sessionId, null);
            set({
              agentPendingPlan: {
                id: createId(),
                sessionId,
                planText,
                steps,
                commands,
                totalStepCount,
                userPrompt: trimmed,
                branchId,
              },
            });
          },
        });
      } catch (e) {
        if (!isAbortError(e)) {
          set({
            error:
              e instanceof Error ? e.message : t("fork.error.answer", undefined, getLocale()),
          });
        }
      } finally {
        const waitingPlan =
          get().agentPendingPlan?.sessionId === sessionId &&
          pendingAgentContinuations.has(sessionId) &&
          get().agentPendingPlan?.branchId === branchId;
        const owned = branchAbortBySession.get(sessionId);
        if (owned?.ctrl === branchCtrl && !waitingPlan) {
          branchAbortBySession.delete(sessionId);
          setSessionBranchLoading(set, sessionId, null);
          queueMicrotask(() => flushPendingClarify(get, set, sessionId));
        }
        flushSessionPersistence();
      }
    })();

    if (opts?.openFloat) {
      get().openBranchFloat(branchId, defaultQueuedClarifyRect(), null);
    }

    return branchId;
  },

  clearPendingClarify: (sessionId) => {
    clearPendingClarifyState(set, sessionId ?? get().activeSessionId);
  },

  continueBranch: async (branchId, question) => {
    const trimmed = question.trim();
    if (!trimmed) return;

    const { settings, thread, activeSessionId, sessions } = get();
    if (!thread || !activeSessionId) return;
    const sessionId = activeSessionId;

    if (get().agentPendingPlan?.sessionId === sessionId) {
      clearPendingAgentPlan(set, sessionId);
    }
    if (get().loadingBranchBySession[sessionId]) return;

    const existing = findBranchInThread(thread, branchId);
    if (!existing) return;
    // Need an initial answer before same-window follow-up
    if (!existing.assistantMessage.trim()) return;

    const llm = settingsForSession(settings, getActiveSession(get()));
    const authError = requireApiKey(llm);
    if (authError) {
      set({ error: authError, settingsOpen: true, settingsTab: "api" });
      return;
    }

    const newReply: BranchReply = {
      userQuestion: trimmed,
      assistantMessage: "",
      createdAt: Date.now(),
    };
    const nextThread = patchBranchInThread(thread, branchId, {
      replies: [...(existing.replies ?? []), newReply],
    });

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
    clearSessionAgentUi(set, sessionId);
    setSessionBranchLoading(set, sessionId, branchId);

    const priorBranch = branchAbortBySession.get(sessionId);
    priorBranch?.ctrl.abort();
    const branchCtrl = new AbortController();
    branchAbortBySession.set(sessionId, { ctrl: branchCtrl, branchId });
    const branchSignal = branchCtrl.signal;

    const timing: ThinkingTimingState = {
      requestStartedAt: Date.now(),
      firstReasoningAt: null,
      lastReasoningAt: null,
      firstAnswerAt: null,
    };
    let apiReasoning = "";

    void (async () => {
      const isOwned = () => {
        const owned = branchAbortBySession.get(sessionId);
        return Boolean(
          owned && owned.ctrl === branchCtrl && !branchSignal.aborted,
        );
      };

      const patchReplyState = (patch: {
        content?: string;
        reasoning?: string;
        thinkingSeconds?: number;
      }) => {
        if (!isOwned()) return;
        const current = getSessionThread(get, sessionId);
        if (!current) return;
        const reasoningText =
          patch.reasoning !== undefined
            ? patch.reasoning.trim()
            : apiReasoning.trim();
        if (patch.reasoning !== undefined) {
          apiReasoning = patch.reasoning;
        }
        const thinkingSeconds =
          patch.thinkingSeconds ??
          (reasoningText
            ? updateThinkingTiming(timing, {
                ...patch,
                reasoning: reasoningText,
              })
            : undefined);
        const updated = patchBranchLastReplyInThread(current, branchId, {
          ...(patch.content !== undefined
            ? { assistantMessage: patch.content }
            : {}),
          ...(patch.reasoning !== undefined
            ? { reasoning: reasoningText || undefined }
            : {}),
          ...(thinkingSeconds != null ? { thinkingSeconds } : {}),
        });
        commitSessionThread(get, set, sessionId, updated, "scheduled");
      };

      try {
        const { projectRoot, sidecarUrl } = get();
        const locale = getLocale();
        let extraMessages;
        try {
          // History for the addendum is built from the branch *before* the empty reply
          // was conceptually "current" — use nextThread but the continue builder reads
          // the full branch including prior turns; the new empty reply has no answer yet.
          extraMessages = buildClarifyContinueAddendumMessages(
            nextThread,
            branchId,
            trimmed,
            locale,
          );
        } catch (e) {
          set({
            error:
              e instanceof Error ? e.message : t("fork.error.context", undefined, getLocale()),
          });
          return;
        }

        await runLoadedAgentTurn({
          llm,
          settings,
          locale,
          session: getActiveSession(get()),
          userText: trimmed,
          thread: nextThread,
          projectRoot,
          sidecarUrl,
          signal: branchSignal,
          extraMessages,
          isOwned,
          patchContent: patchReplyState,
          onAgentActivity: (activity) => {
            pushSessionAgentActivity(set, sessionId, activity);
          },
          onAgentChange: (change) => {
            pushSessionAgentChange(set, sessionId, change);
          },
          onRepairContextToLive: () => {
            const repaired = patchActiveSessionMeta(get().sessions, sessionId, {
              contextMode: "live",
              activeArchiveId: null,
            });
            persistSessions(repaired, sessionId);
            set({ sessions: repaired });
          },
          onDecisionFeedback: (events) => {
            commitDecisionFeedbackBatch(get, set, sessionId, events);
          },
          onAwaitPlanApproval: ({
            planText,
            steps,
            commands,
            totalStepCount,
            continueExecution,
          }) => {
            pendingAgentContinuations.set(sessionId, continueExecution);
            setSessionBranchLoading(set, sessionId, null);
            set({
              agentPendingPlan: {
                id: createId(),
                sessionId,
                planText,
                steps,
                commands,
                totalStepCount,
                userPrompt: trimmed,
                branchId,
              },
            });
          },
        });
      } catch (e) {
        if (!isAbortError(e)) {
          set({
            error:
              e instanceof Error ? e.message : t("fork.error.followUp", undefined, getLocale()),
          });
        }
      } finally {
        const waitingPlan =
          get().agentPendingPlan?.sessionId === sessionId &&
          pendingAgentContinuations.has(sessionId) &&
          get().agentPendingPlan?.branchId === branchId;
        const owned = branchAbortBySession.get(sessionId);
        if (owned?.ctrl === branchCtrl && !waitingPlan) {
          branchAbortBySession.delete(sessionId);
          setSessionBranchLoading(set, sessionId, null);
          queueMicrotask(() => flushPendingClarify(get, set, sessionId));
        }
        flushSessionPersistence();
      }
    })();
  },

  adoptBranchIntoMain: (branchId) => {
    const { thread, activeSessionId, sessions } = get();
    if (!thread || !activeSessionId) return;

    const branch = findBranchInThread(thread, branchId);
    const parent = findAssistantMessageForBranch(thread, branchId);
    if (!branch || !parent) return;

    const source = resolveBranchAdoptSource(branch);
    if (!source.trim()) return;

    const locale = getLocale();
    const summary = truncateAdoptSummary(source);
    const nextContent = applyAdoptNoteToContent(
      parent.content,
      branch,
      source,
      locale,
    );

    const pointIndex = branch.anchor.pointIndex;
    const parentPatch: Partial<ChatMessage> = { content: nextContent };
    if (pointIndex != null && parent.pointVerdicts?.[pointIndex] !== "accept") {
      const nextVerdicts = { ...(parent.pointVerdicts ?? {}) };
      const nextDoubts = { ...(parent.pointDoubts ?? {}) };
      const nextAttrs = { ...(parent.pointAttributions ?? {}) };
      nextVerdicts[pointIndex] = "accept";
      delete nextDoubts[pointIndex];
      delete nextAttrs[pointIndex];
      parentPatch.pointVerdicts = nextVerdicts;
      parentPatch.pointDoubts = nextDoubts;
      parentPatch.pointAttributions = nextAttrs;
    }

    let nextThread = patchMessage(thread, parent.id, parentPatch);
    nextThread = patchBranchInThread(nextThread, branchId, {
      adoptedAt: Date.now(),
      adoptedSummary: summary,
    });

    const nextSessions = upsertActiveSession(
      sessions,
      activeSessionId,
      nextThread,
    );
    persistSessions(nextSessions, get().activeSessionId);
    set({
      sessions: nextSessions,
      thread: nextThread,
      error: null,
    });
  },

  unadoptBranchFromMain: (branchId) => {
    const { thread, activeSessionId, sessions } = get();
    if (!thread || !activeSessionId) return;

    const branch = findBranchInThread(thread, branchId);
    const parent = findAssistantMessageForBranch(thread, branchId);
    if (!branch || !parent || !branch.adoptedAt) return;

    const nextContent = removeAdoptNoteFromContent(parent.content, branchId);
    let nextThread = patchMessage(thread, parent.id, { content: nextContent });
    nextThread = {
      ...nextThread,
      messages: nextThread.messages.map((m) =>
        m.id === parent.id
          ? {
              ...m,
              content: nextContent,
              children: clearBranchAdoptFields(m.children, branchId),
            }
          : {
              ...m,
              children: clearBranchAdoptFields(m.children, branchId),
            },
      ),
    };

    const nextSessions = upsertActiveSession(
      sessions,
      activeSessionId,
      nextThread,
    );
    persistSessions(nextSessions, get().activeSessionId);
    set({
      sessions: nextSessions,
      thread: nextThread,
      error: null,
    });
  },

}));
