export type NodeId = string;

export interface Anchor {
  startOffset: number;
  endOffset: number;
  quotedText: string;
}

/** 用户对回答中某个分点的裁决；缺省（未点击）视为采纳 */
export type PointVerdict = "accept" | "unsure" | "reject";

/** key = 分点编号（回答中的 N） */
export type PointVerdictMap = Record<number, PointVerdict>;

/** 存疑分点的用户疑问文案；key = 分点编号 */
export type PointDoubtMap = Record<number, string>;

/** Follow-up turn on the same Fork (same float window), not a nested Clarify. */
export interface BranchReply {
  userQuestion: string;
  assistantMessage: string;
  createdAt: number;
  reasoning?: string;
  thinkingSeconds?: number;
}

export interface BranchNode {
  id: NodeId;
  parentId: NodeId;
  anchor: Anchor;
  userQuestion: string;
  assistantMessage: string;
  children: BranchNode[];
  createdAt: number;
  pointVerdicts?: PointVerdictMap;
  pointDoubts?: PointDoubtMap;
  /** Chain-of-thought / reasoning channel, not shown as the answer body */
  reasoning?: string;
  /** Seconds from request start until first visible answer token */
  thinkingSeconds?: number;
  /**
   * Same-window follow-ups after the initial clarify turn.
   * Nested Clarify this still creates `children` + a new float.
   */
  replies?: BranchReply[];
}

export interface ChatMessage {
  id: NodeId;
  role: "user" | "assistant";
  content: string;
  /** 批注挂在某条助手回复上 */
  children: BranchNode[];
  createdAt: number;
  pointVerdicts?: PointVerdictMap;
  pointDoubts?: PointDoubtMap;
  /** Chain-of-thought / reasoning channel, not shown as the answer body */
  reasoning?: string;
  /** Seconds from request start until first visible answer token */
  thinkingSeconds?: number;
}

export interface ThreadRoot {
  id: NodeId;
  messages: ChatMessage[];
  createdAt: number;
  /** @deprecated 仅用于旧数据迁移 */
  userQuestion?: string;
  assistantMessage?: string;
  children?: BranchNode[];
}

/** 一条独立笔记（可含澄清分支） */
export interface ChatSession {
  id: NodeId;
  title: string;
  /** 用户手动重命名后为 true，后续消息不再自动覆盖标题 */
  titleLocked?: boolean;
  /**
   * When set, session is pinned and sorts above unpinned notes.
   * Timestamp of when it was pinned (ms); clear / omit to unpin.
   */
  pinnedAt?: number | null;
  thread: ThreadRoot | null;
  createdAt: number;
  updatedAt: number;
  /** 归档成的开发日志草稿（可多次归档） */
  archives?: ArchiveSnapshot[];
  /**
   * 后续主线对话用的上下文模式：
   * - live：完整主线 + 分支裁决（默认）
   * - archive：以某篇归档文为底座，只附加归档之后的新消息
   */
  contextMode?: ContextMode;
  /** contextMode === "archive" 时使用的归档 id */
  activeArchiveId?: NodeId | null;
  /**
   * Compressed context pack (SUMMARY / TASKS / DECISIONS) when no project
   * write target is available. Project-bound packs live on disk under memoryDir.
   */
  contextMemory?: ContextMemoryPack | null;
  /** Bound local project absolute path for this session (via sidecar), or null */
  projectRoot?: string | null;
  /**
   * Per-session API overrides (connection + model).
   * Missing / empty → inherit all from system Settings → API (live).
   * Only fields that differ from globals are stored.
   */
  api?: SessionApiOverride | null;
  /**
   * @deprecated Legacy model-only field; migrated into `api.model` on load.
   */
  model?: string | null;
}

/** Connection/model fields a note may override (subset of ApiSettings). */
export type SessionApiOverride = Partial<{
  baseUrl: string;
  apiKey: string;
  model: string;
  useProxy: boolean;
}>;

/** LLM-compressed long-term context for agent recovery */
export interface ContextMemoryPack {
  summary: string;
  tasks: string;
  decisions: string;
  updatedAt: number;
  throughMessageId?: NodeId;
  /** project = sidecar files; local = session localStorage */
  storage: "project" | "local";
  /** Relative dir under project root, e.g. `.forknote/memory` */
  dir?: string;
}

/** 一次归档生成的归纳文 / 开发日志草稿 */
export interface ArchiveSnapshot {
  id: NodeId;
  createdAt: number;
  title: string;
  /** Markdown 正文 */
  content: string;
  /** 归档所覆盖到的最后一条主线消息 id */
  throughMessageId: NodeId;
}

export type ContextMode = "live" | "archive";

export interface SessionStore {
  sessions: ChatSession[];
  activeSessionId: NodeId | null;
}

export type SettingsTab = "general" | "api" | "data" | "project" | "about";

export interface ApiSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  useProxy: boolean;
  /**
   * Inject SUMMARY/TASKS/DECISIONS from the local memory pack into askMain.
   * Default true — no-op until a pack exists.
   */
  contextMemoryEnabled?: boolean;
  /** After Archive succeeds, also run context compression. Default false. */
  compressAfterArchive?: boolean;
  /** Project-relative folder for the three MD files. Default `.forknote/memory` */
  memoryDir?: string;
  /**
   * Max model↔tool loop rounds per main-turn when a project is bound.
   * Task ends early when the model finishes without calling more tools.
   */
  agentMaxRounds?: number;
  /**
   * When a project is bound, ask the model for a plan first and wait for user
   * approval before running tools. Default true.
   */
  agentRequireApproval?: boolean;
  /**
   * When a project is bound, expose the `run_terminal` agent tool.
   * Default true — mutating commands still gated by plan approval when enabled;
   * read-only commands (ls/pwd/…) may skip approval.
   */
  agentAllowTerminal?: boolean;
}

/** Agent plan awaiting user approval before tool execution. */
export interface AgentPendingPlan {
  id: NodeId;
  /** Session that owns this plan — UI must only show it for that session. */
  sessionId: NodeId;
  userPrompt: string;
  planText: string;
  steps: string[];
  /**
   * Exact shell commands from inferred / prefetch `run_terminal` args.
   * Preferred by InlineTerminalApproval over plan-prose parsing.
   */
  commands?: string[];
  /**
   * Total steps before chunking. When greater than `steps.length`, the UI
   * shows that only this round’s chunk is up for approval.
   */
  totalStepCount?: number;
  /** Main-thread turn ids (when plan came from askMain). */
  userId?: NodeId;
  assistantId?: NodeId;
  /** Fork branch id (when plan came from askBranch). */
  branchId?: NodeId;
}

export interface SelectionInfo {
  quotedText: string;
  startOffset: number;
  endOffset: number;
  rect: DOMRect;
}

export type FocusTarget =
  | { type: "root" }
  | { type: "branch"; branchId: NodeId };
