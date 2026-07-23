import { create } from "zustand";
import {
  agentCallFromOpenAI,
  buildCodingToolsSystem,
  collectToolCalls,
  executeToolCall,
  inferCreateFilePath,
  MAX_AGENT_ROUNDS,
  nativeToolResultMessage,
  PROJECT_OPENAI_TOOLS,
  stripToolCalls,
  synthesizeWriteFromReply,
  toolResultMessage,
  type AgentActivity,
  type AgentFileChange,
  type AgentToolCall,
} from "../lib/agentTools";
import { buildBranchQuestionMessages, buildConversationMessages } from "../lib/contextBuilder";
import { createId } from "../lib/id";
import {
  isToolsUnsupportedError,
  streamChat,
  type ChatMessage as ApiChatMessage,
  type ToolCall,
} from "../lib/openai";
import { loadProjectPrefs, saveProjectPrefs } from "../lib/project";
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
import { isLikelyLocalEndpoint, loadSettings } from "../lib/settings";
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
  BranchNode,
  ChatMessage,
  ChatSession,
  FocusTarget,
  NodeId,
  PointDoubtMap,
  PointVerdict,
  PointVerdictMap,
  ThreadRoot,
} from "../types";

interface AppState {
  sessions: ChatSession[];
  activeSessionId: NodeId | null;
  thread: ThreadRoot | null;
  settings: ApiSettings;
  settingsOpen: boolean;
  projectOpen: boolean;
  focus: FocusTarget;
  loadingMain: boolean;
  loadingBranchId: NodeId | null;
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

  init: () => void;
  setSettings: (settings: ApiSettings) => void;
  setSettingsOpen: (open: boolean) => void;
  setProjectOpen: (open: boolean) => void;
  setSidecarUrl: (url: string) => void;
  openProject: (absPath: string, quiet?: boolean) => Promise<void>;
  disconnectProject: () => void;
  clearAgentLog: () => void;
  setFocus: (focus: FocusTarget) => void;
  clearError: () => void;
  /** Abort in-flight generation. Returns the stopped main prompt to restore in the composer. */
  stopGeneration: () => string | null;
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
  /** 重命名笔记；空标题拒绝。成功后锁定标题，不再被自动覆盖 */
  renameSession: (sessionId: NodeId, title: string) => boolean;

  askMain: (question: string) => Promise<void>;
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

// Module-level abort controllers — not in Zustand state (no re-render needed)
let mainAbortCtrl: AbortController | null = null;
let branchAbortCtrl: AbortController | null = null;

/** In-flight main turn — rolled back synchronously on Stop so UI doesn't wait on hung streams. */
let activeMainTurn: {
  userId: NodeId;
  assistantId: NodeId;
  prompt: string;
  ctrl: AbortController;
} | null = null;

function isAbortError(e: unknown): boolean {
  return (
    (e instanceof Error && e.name === "AbortError") ||
    (typeof DOMException !== "undefined" &&
      e instanceof DOMException &&
      e.name === "AbortError")
  );
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
  turn: { userId: NodeId; assistantId: NodeId },
): void {
  const current = get().thread;
  if (!current) return;
  const msgs = current.messages;
  const last = msgs[msgs.length - 1];
  const prev = msgs[msgs.length - 2];
  if (last?.id !== turn.assistantId || prev?.id !== turn.userId) return;

  const remaining = msgs.slice(0, -2);
  const nextThread: ThreadRoot | null =
    remaining.length === 0 ? null : { ...current, messages: remaining };
  const updatedSessions = upsertActiveSession(
    get().sessions,
    get().activeSessionId,
    nextThread,
  );
  persistSessions(updatedSessions, get().activeSessionId);
  set({
    thread: nextThread,
    sessions: updatedSessions,
    agentActivity: [],
    agentChanges: [],
  });
}

function requireApiKey(settings: ApiSettings): string | null {
  if (settings.apiKey.trim() || isLikelyLocalEndpoint(settings.baseUrl)) {
    return null;
  }
  return "Add a DeepSeek API Key in settings (platform.deepseek.com), or switch to a local model such as Ollama";
}

export const useAppStore = create<AppState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  thread: null,
  settings: loadSettings(),
  settingsOpen: false,
  projectOpen: false,
  focus: { type: "root" },
  loadingMain: false,
  loadingBranchId: null,
  error: null,
  branchFloatStack: [],
  floatOverlayDismissToken: 0,
  projectRoot: null,
  sidecarUrl: loadProjectPrefs().sidecarUrl,
  projectError: null,
  agentActivity: [],
  agentChanges: [],

  init: () => {
    const store = loadSessionStore();
    const active =
      store.sessions.find((s) => s.id === store.activeSessionId) ??
      store.sessions[0];
    const thread = active?.thread ? normalizeThread(active.thread) : null;
    const prefs = loadProjectPrefs();
    set({
      sessions: store.sessions,
      activeSessionId: active?.id ?? null,
      thread,
      sidecarUrl: prefs.sidecarUrl,
    });
    // Best-effort reconnect to last project if sidecar is up
    if (prefs.lastPath) {
      void get().openProject(prefs.lastPath, true);
    }
  },

  setSettings: (settings) => set({ settings }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
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
    const { sidecarUrl } = get();
    try {
      const { root } = await sidecarOpenProject(path, sidecarUrl);
      saveProjectPrefs({ lastPath: root, sidecarUrl });
      set({
        projectRoot: root,
        projectError: null,
        agentActivity: [],
        agentChanges: [],
      });
    } catch (e) {
      set({
        projectRoot: null,
        projectError: quiet
          ? null
          : e instanceof Error
            ? e.message
            : "Could not reach sidecar (run npm run sidecar first)",
      });
    }
  },
  disconnectProject: () => {
    const { sidecarUrl } = get();
    void sidecarCloseProject(sidecarUrl).catch(() => undefined);
    set({
      projectRoot: null,
      projectError: null,
      agentActivity: [],
      agentChanges: [],
    });
  },
  clearAgentLog: () => set({ agentActivity: [], agentChanges: [] }),
  setFocus: (focus) => set({ focus }),
  clearError: () => set({ error: null }),

  stopGeneration: () => {
    const turn = activeMainTurn;
    const ctrl = mainAbortCtrl;
    const branchCtrl = branchAbortCtrl;

    // Abort first so in-flight fetch/reader/tool calls start unwinding
    ctrl?.abort();
    branchCtrl?.abort();

    // Roll back the incomplete main turn immediately (don't wait for hung finally)
    if (turn && turn.ctrl === ctrl) {
      rollbackMainTurn(get, set, turn);
      activeMainTurn = null;
    }

    mainAbortCtrl = null;
    branchAbortCtrl = null;
    set({ loadingMain: false, loadingBranchId: null });
    return turn?.prompt ?? null;
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
    const { sessions, activeSessionId, thread } = get();
    let nextSessions = upsertActiveSession(sessions, activeSessionId, thread);
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
    });
  },

  switchSession: (sessionId) => {
    const { sessions, activeSessionId, thread } = get();
    if (sessionId === activeSessionId) return;

    let nextSessions = upsertActiveSession(sessions, activeSessionId, thread);
    const target = nextSessions.find((s) => s.id === sessionId);
    if (!target) return;

    const nextThread = target.thread ? normalizeThread(target.thread) : null;
    persistSessions(nextSessions, sessionId);
    set({
      sessions: nextSessions,
      activeSessionId: sessionId,
      thread: nextThread,
      focus: { type: "root" },
      error: null,
      branchFloatStack: [],
    });
  },

  deleteSession: (sessionId) => {
    const { sessions, activeSessionId, thread } = get();
    if (sessions.length <= 1) {
      const session = createEmptySession();
      persistSessions([session], session.id);
      set({
        sessions: [session],
        activeSessionId: session.id,
        thread: null,
        focus: { type: "root" },
        error: null,
        branchFloatStack: [],
      });
      return;
    }

    let nextSessions =
      sessionId === activeSessionId
        ? sessions
        : upsertActiveSession(sessions, activeSessionId, thread);
    nextSessions = nextSessions.filter((s) => s.id !== sessionId);

    const nextActive =
      sessionId === activeSessionId
        ? nextSessions[0]?.id ?? null
        : activeSessionId;
    const active = nextSessions.find((s) => s.id === nextActive);
    const nextThread = active?.thread ? normalizeThread(active.thread) : null;

    persistSessions(nextSessions, nextActive);
    set({
      sessions: nextSessions,
      activeSessionId: nextActive,
      thread: nextThread,
      focus: { type: "root" },
      error: null,
    });
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

  askMain: async (question) => {
    const trimmed = question.trim();
    if (!trimmed) return;

    // Prevent double-submit races (composer loading prop may lag one frame)
    if (get().loadingMain) return;

    const { settings, activeSessionId, sessions, thread: existingThread } =
      get();
    const authError = requireApiKey(settings);
    if (authError) {
      set({ error: authError, settingsOpen: true });
      return;
    }

    let sessionId = activeSessionId;
    let currentSessions = sessions;
    if (!sessionId || !getActiveSession(get())) {
      const session = createEmptySession();
      currentSessions = [session, ...currentSessions];
      sessionId = session.id;
      set({ sessions: currentSessions, activeSessionId: sessionId });
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

    let thread: ThreadRoot;
    if (existingThread) {
      thread = normalizeThread({
        ...existingThread,
        messages: [...existingThread.messages, userMsg, assistantMsg],
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
    persistSessions(nextSessions, sessionId);
    set({
      sessions: nextSessions,
      thread,
      loadingMain: true,
      error: null,
      focus: { type: "root" },
      agentActivity: [],
      agentChanges: [],
    });

    const assistantId = assistantMsg.id;
    const userId = userMsg.id;

    mainAbortCtrl?.abort();
    const ctrl = new AbortController();
    mainAbortCtrl = ctrl;
    activeMainTurn = {
      userId,
      assistantId,
      prompt: trimmed,
      ctrl,
    };
    const signal = ctrl.signal;

    const patchAssistantContent = (content: string) => {
      // Ignore late patches after this request was aborted/superseded
      if (activeMainTurn?.ctrl !== ctrl || signal.aborted) return;
      const current = get().thread;
      if (!current) return;
      const next = patchMessage(current, assistantId, { content });
      const updatedSessions = upsertActiveSession(
        get().sessions,
        get().activeSessionId,
        next,
      );
      persistSessions(updatedSessions, get().activeSessionId);
      set({ thread: next, sessions: updatedSessions });
    };

    try {
      const { projectRoot, sidecarUrl } = get();
      const createPathEarly = inferCreateFilePath(trimmed);
      if (createPathEarly && !projectRoot) {
        set({
          loadingMain: false,
          error:
            "Open a local project first (Open project), then ask to create the file — e.g. connect /Users/debris/cursor/code-test.",
        });
        // Roll back the empty turn so the prompt can stay editable
        rollbackMainTurn(get, set, { userId, assistantId });
        if (mainAbortCtrl === ctrl) {
          mainAbortCtrl = null;
          activeMainTurn = null;
        }
        return;
      }

      const codingToolsSystem = projectRoot
        ? buildCodingToolsSystem(projectRoot)
        : null;
      const apiMessages: ApiChatMessage[] = buildConversationMessages(thread, {
        projectRoot,
        codingToolsSystem,
      });

      const createPath = projectRoot ? inferCreateFilePath(trimmed) : null;
      if (createPath) {
        apiMessages.push({
          role: "system",
          content: `用户要求在项目中创建文件。你必须调用函数 write_file：path 必须精确为 "${createPath}"（相对项目根），content 为完整源码。禁止只输出 Markdown 代码块而不调用工具。`,
        });
      }

      let visibleContent = "";
      let round = 0;
      let useNativeTools = Boolean(projectRoot);
      let forcedWrite = Boolean(createPath && projectRoot);

      while (round < MAX_AGENT_ROUNDS) {
        if (signal.aborted) break;

        let roundText = "";
        let streamResult: Awaited<ReturnType<typeof streamChat>>;
        try {
          streamResult = await streamChat(
            settings,
            apiMessages,
            (delta) => {
              roundText += delta;
              const cleaned = stripToolCalls(roundText);
              if (cleaned.length > 0) {
                patchAssistantContent(
                  visibleContent
                    ? `${visibleContent}\n\n${cleaned}`.trim()
                    : cleaned,
                );
              } else if (!visibleContent && projectRoot) {
                patchAssistantContent(
                  createPath
                    ? `Creating ${createPath}…`
                    : "Using project tools…",
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
                  : useNativeTools
                    ? "auto"
                    : undefined,
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
              pending.push({ agent, native: tc });
            }
          }
        } else if (projectRoot) {
          for (const agent of collectToolCalls(roundText)) {
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

        const cleanedRound = stripToolCalls(roundText);

        if (pending.length === 0) {
          // One nudge if create intent and model ignored tools/fences
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
          visibleContent = cleanedRound;
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
              (createPath ? `Creating ${createPath}…` : "Using project tools…"),
          );
        }

        let wroteTarget = false;
        for (const item of pending) {
          if (signal.aborted) break;
          const executed = await abortable(
            executeToolCall(item.agent, sidecarUrl, signal, projectRoot),
            signal,
          );
          if (signal.aborted) break;
          if (
            item.agent.tool === "write_file" &&
            executed.ok &&
            (item.agent.path === createPath || !createPath)
          ) {
            wroteTarget = true;
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

        if (signal.aborted) break;

        // After a successful create-file write, ask for a short summary then stop looping tools
        if (createPath && wroteTarget) {
          apiMessages.push({
            role: "user",
            content: `文件 ${createPath} 已写入。请用一两句中文确认路径与作用，不要再调用工具。`,
          });
          forcedWrite = false;
        }

        round += 1;
        if (round >= MAX_AGENT_ROUNDS) {
          const note =
            "\n\n(Reached the tool-round limit. Continue from the results so far, or send another message.)";
          visibleContent = (visibleContent || cleanedRound) + note;
          patchAssistantContent(visibleContent.trim());
        }
      }
    } catch (e) {
      if (!isAbortError(e)) {
        set({ error: e instanceof Error ? e.message : "Answer request failed" });
      }
    } finally {
      // Stop may have already rolled back; this is a safety net if abort came from elsewhere
      if (signal.aborted && activeMainTurn?.ctrl === ctrl) {
        rollbackMainTurn(get, set, { userId, assistantId });
      }
      if (activeMainTurn?.ctrl === ctrl) {
        activeMainTurn = null;
      }
      // Don't clobber a newer in-flight request
      if (mainAbortCtrl === ctrl) {
        mainAbortCtrl = null;
        set({ loadingMain: false });
      }
    }
  },

  askBranch: async (parentId, _parentContent, anchor, question) => {
    const trimmed = question.trim();
    if (!trimmed) return;

    const { settings, thread, activeSessionId, sessions } = get();
    if (!thread) return;

    const authError = requireApiKey(settings);
    if (authError) {
      set({ error: authError, settingsOpen: true });
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
      activeSessionId,
      nextThread,
    );
    persistSessions(nextSessions, activeSessionId);
    set({
      sessions: nextSessions,
      thread: nextThread,
      loadingBranchId: branch.id,
      error: null,
    });

    const branchId = branch.id;

    branchAbortCtrl?.abort();
    const branchCtrl = new AbortController();
    branchAbortCtrl = branchCtrl;
    const branchSignal = branchCtrl.signal;

    void (async () => {
      try {
        const messages = buildBranchQuestionMessages(
          nextThread,
          parentId,
          anchor.quotedText,
          trimmed,
        );
        await streamChat(
          settings,
          messages,
          (delta) => {
          if (branchAbortCtrl !== branchCtrl || branchSignal.aborted) return;
          const current = get().thread;
          if (!current) return;
          const updated = patchBranchInThread(current, branchId, {
            assistantMessage:
              (findBranchInThread(current, branchId)?.assistantMessage ?? "") +
              delta,
          });
          const updatedSessions = upsertActiveSession(
            get().sessions,
            get().activeSessionId,
            updated,
          );
          persistSessions(updatedSessions, get().activeSessionId);
          set({ thread: updated, sessions: updatedSessions });
        },
          { signal: branchSignal, temperature: 0.3 },
        );
      } catch (e) {
        if (!isAbortError(e)) {
          set({ error: e instanceof Error ? e.message : "Fork answer request failed" });
        }
      } finally {
        if (branchAbortCtrl === branchCtrl) {
          branchAbortCtrl = null;
          set({ loadingBranchId: null });
        }
      }
    })();

    return branchId;
  },
}));
