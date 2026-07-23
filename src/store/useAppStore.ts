import { create } from "zustand";
import {
  buildCodingToolsSystem,
  executeToolCall,
  MAX_AGENT_ROUNDS,
  parseToolCalls,
  stripToolCalls,
  toolResultMessage,
  type AgentActivity,
  type AgentFileChange,
} from "../lib/agentTools";
import { buildBranchQuestionMessages, buildConversationMessages } from "../lib/contextBuilder";
import { createId } from "../lib/id";
import { streamChat, type ChatMessage as ApiChatMessage } from "../lib/openai";
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
  stopGeneration: () => void;
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
    mainAbortCtrl?.abort();
    branchAbortCtrl?.abort();
    mainAbortCtrl = null;
    branchAbortCtrl = null;
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

    mainAbortCtrl?.abort();
    mainAbortCtrl = new AbortController();
    const signal = mainAbortCtrl.signal;

    const patchAssistantContent = (content: string) => {
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
      const codingToolsSystem = projectRoot
        ? buildCodingToolsSystem(projectRoot)
        : null;
      const apiMessages: ApiChatMessage[] = buildConversationMessages(thread, {
        projectRoot,
        codingToolsSystem,
      });

      let visibleContent = "";
      let round = 0;

      while (round < MAX_AGENT_ROUNDS) {
        if (signal.aborted) break;

        let roundText = "";
        await streamChat(
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
              patchAssistantContent("Using project tools…");
            }
          },
          signal,
        );

        const calls = projectRoot ? parseToolCalls(roundText) : [];
        const cleanedRound = stripToolCalls(roundText);

        if (calls.length === 0) {
          visibleContent = cleanedRound;
          patchAssistantContent(visibleContent);
          break;
        }

        // Persist assistant tool-call turn for the model, keep UI clean
        apiMessages.push({ role: "assistant", content: roundText });
        if (cleanedRound) {
          visibleContent = visibleContent
            ? `${visibleContent}\n\n${cleanedRound}`.trim()
            : cleanedRound;
          patchAssistantContent(visibleContent);
        } else {
          patchAssistantContent(
            visibleContent || "Using project tools…",
          );
        }

        for (const call of calls) {
          if (signal.aborted) break;
          const executed = await executeToolCall(call, sidecarUrl);
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
          apiMessages.push(toolResultMessage(call, executed.resultText));
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
      if ((e as Error)?.name !== "AbortError") {
        set({ error: e instanceof Error ? e.message : "Answer request failed" });
      }
    } finally {
      mainAbortCtrl = null;
      set({ loadingMain: false });
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
    branchAbortCtrl = new AbortController();
    const branchSignal = branchAbortCtrl.signal;

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
        if ((e as Error)?.name !== "AbortError") {
          set({ error: e instanceof Error ? e.message : "Fork answer request failed" });
        }
      } finally {
        branchAbortCtrl = null;
        set({ loadingBranchId: null });
      }
    })();

    return branchId;
  },
}));
