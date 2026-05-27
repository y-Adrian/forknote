import { create } from "zustand";
import {
  buildBranchQuestionMessages,
  buildMainQuestionMessages,
} from "../lib/contextBuilder";
import { createId } from "../lib/id";
import { streamChat } from "../lib/openai";
import {
  createEmptySession,
  loadSessionStore,
  saveSessionStore,
  sessionTitleFromThread,
} from "../lib/storage";
import { isLikelyLocalEndpoint, loadSettings } from "../lib/settings";
import type {
  Anchor,
  ApiSettings,
  BranchNode,
  ChatSession,
  FocusTarget,
  NodeId,
  ThreadRoot,
} from "../types";

interface AppState {
  sessions: ChatSession[];
  activeSessionId: NodeId | null;
  thread: ThreadRoot | null;
  settings: ApiSettings;
  settingsOpen: boolean;
  focus: FocusTarget;
  loadingMain: boolean;
  loadingBranchId: NodeId | null;
  error: string | null;

  init: () => void;
  setSettings: (settings: ApiSettings) => void;
  setSettingsOpen: (open: boolean) => void;
  setFocus: (focus: FocusTarget) => void;
  clearError: () => void;

  createSession: () => void;
  switchSession: (sessionId: NodeId) => void;
  deleteSession: (sessionId: NodeId) => void;

  askMain: (question: string) => Promise<void>;
  askBranch: (
    parentId: NodeId,
    parentContent: string,
    anchor: Anchor,
    question: string,
  ) => Promise<void>;
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
  return sessions.map((s) =>
    s.id === activeSessionId
      ? {
          ...s,
          thread,
          title: sessionTitleFromThread(thread),
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

function patchBranch(
  nodes: BranchNode[],
  branchId: NodeId,
  patch: Partial<BranchNode>,
): BranchNode[] {
  return nodes.map((node) => {
    if (node.id === branchId) {
      return { ...node, ...patch };
    }
    return {
      ...node,
      children: patchBranch(node.children, branchId, patch),
    };
  });
}

function findBranch(
  nodes: BranchNode[],
  id: NodeId,
): BranchNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findBranch(node.children, id);
    if (found) return found;
  }
  return undefined;
}

function requireApiKey(settings: ApiSettings): string | null {
  if (
    settings.apiKey ||
    import.meta.env.VITE_OPENAI_API_KEY ||
    isLikelyLocalEndpoint(settings.baseUrl)
  ) {
    return null;
  }
  return "请先在设置中填写 API Key";
}

export const useAppStore = create<AppState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  thread: null,
  settings: loadSettings(),
  settingsOpen: false,
  focus: { type: "root" },
  loadingMain: false,
  loadingBranchId: null,
  error: null,

  init: () => {
    const store = loadSessionStore();
    const active =
      store.sessions.find((s) => s.id === store.activeSessionId) ??
      store.sessions[0];
    set({
      sessions: store.sessions,
      activeSessionId: active?.id ?? null,
      thread: active?.thread ?? null,
    });
  },

  setSettings: (settings) => set({ settings }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setFocus: (focus) => set({ focus }),
  clearError: () => set({ error: null }),

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
    });
  },

  switchSession: (sessionId) => {
    const { sessions, activeSessionId, thread } = get();
    if (sessionId === activeSessionId) return;

    let nextSessions = upsertActiveSession(sessions, activeSessionId, thread);
    const target = nextSessions.find((s) => s.id === sessionId);
    if (!target) return;

    persistSessions(nextSessions, sessionId);
    set({
      sessions: nextSessions,
      activeSessionId: sessionId,
      thread: target.thread,
      focus: { type: "root" },
      error: null,
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

    persistSessions(nextSessions, nextActive);
    set({
      sessions: nextSessions,
      activeSessionId: nextActive,
      thread: active?.thread ?? null,
      focus: { type: "root" },
      error: null,
    });
  },

  askMain: async (question) => {
    const trimmed = question.trim();
    if (!trimmed) return;

    const { settings, activeSessionId, sessions } = get();
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
      set({
        sessions: currentSessions,
        activeSessionId: sessionId,
      });
    }

    const thread: ThreadRoot = {
      id: createId(),
      userQuestion: trimmed,
      assistantMessage: "",
      children: [],
      createdAt: Date.now(),
    };

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
    });

    try {
      const messages = buildMainQuestionMessages(trimmed);
      await streamChat(settings, messages, (delta) => {
        const current = get().thread;
        if (!current) return;
        const next = {
          ...current,
          assistantMessage: current.assistantMessage + delta,
        };
        const updatedSessions = upsertActiveSession(
          get().sessions,
          get().activeSessionId,
          next,
        );
        persistSessions(updatedSessions, get().activeSessionId);
        set({ thread: next, sessions: updatedSessions });
      });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "主回答请求失败",
      });
    } finally {
      set({ loadingMain: false });
    }
  },

  askBranch: async (parentId, parentContent, anchor, question) => {
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

    let nextThread: ThreadRoot;
    if (parentId === thread.id) {
      nextThread = {
        ...thread,
        children: [...thread.children, branch],
      };
    } else {
      nextThread = {
        ...thread,
        children: appendChild(thread.children, parentId, branch),
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
      focus: { type: "branch", branchId: branch.id },
    });

    try {
      const messages = buildBranchQuestionMessages(
        thread,
        parentContent,
        parentId,
        anchor.quotedText,
        trimmed,
      );
      await streamChat(settings, messages, (delta) => {
        const current = get().thread;
        if (!current) return;
        const updated: ThreadRoot = {
          ...current,
          children: patchBranch(current.children, branch.id, {
            assistantMessage:
              (findBranch(current.children, branch.id)?.assistantMessage ??
                "") + delta,
          }),
        };
        const updatedSessions = upsertActiveSession(
          get().sessions,
          get().activeSessionId,
          updated,
        );
        persistSessions(updatedSessions, get().activeSessionId);
        set({ thread: updated, sessions: updatedSessions });
      });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "分支回答请求失败",
      });
    } finally {
      set({ loadingBranchId: null });
    }
  },
}));
