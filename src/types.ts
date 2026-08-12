export type NodeId = string;

export interface Anchor {
  startOffset: number;
  endOffset: number;
  quotedText: string;
  /** When clarify started from a numbered point【N】 (one-click). */
  pointIndex?: number;
}

/** 用户对回答中某个分点的裁决；缺省（未点击）= 沉默弱正信号，≠ 主动采纳 */
export type PointVerdict = "accept" | "unsure" | "reject";

/** key = 分点编号（回答中的 N） */
export type PointVerdictMap = Record<number, PointVerdict>;

/** 存疑分点的可选自由备注；key = 分点编号 */
export type PointDoubtMap = Record<number, string>;

/**
 * 不采纳 / 存疑经二元确认后的归因（Agent 假设 + 用户确认）。
 * 与 Agent反馈信号闭环设计-优化版.md 对齐。
 */
export type FeedbackAttribution =
  | "goal_mismatch"
  | "constraint_conflict"
  | "unfamiliar_approach"
  | "user_expertise"
  | "style_dislike";

export type PointAttributionMap = Record<number, FeedbackAttribution>;

/** 结构化反馈事件（原始事件流，用于回溯与后续聚合） */
export interface FeedbackEvent {
  id: string;
  targetId: string;
  pointIndex: number;
  signal: PointVerdict;
  /** 仅主动点击 / 假设确认为 true；沉默默认不写事件 */
  explicit: boolean;
  weight: number;
  attribution?: FeedbackAttribution;
  note?: string;
  /** Content-class strategy id used for bandit updates. */
  strategyId?: string;
  /** How the event was produced (optimized closed-loop layers). */
  source?:
    | "explicit"
    | "hypothesis_confirm"
    | "hypothesis_deny"
    | "passive_copy";
  at: number;
}

/**
 * Session-scoped User Model subset: fast-updating policy weights + confidence.
 * (stable_profile / active_constraints can land later.)
 */
export interface SessionFeedbackPolicy {
  /** strategy_id → score in ~[0.05, 0.95], default 0.5 */
  weights: Record<string, number>;
  /** strategy/topic → confidence delta (negative = need verification) */
  confidence: Record<string, number>;
  updatedAt: number;
}

/** Follow-up turn on the same Fork (same float window), not a nested Clarify. */
export interface BranchReply {
  userQuestion: string;
  assistantMessage: string;
  createdAt: number;
  reasoning?: string;
  /** Best-effort reasoning span in seconds (excludes network / placeholder time). */
  thinkingSeconds?: number;
  pointVerdicts?: PointVerdictMap;
  pointDoubts?: PointDoubtMap;
  pointAttributions?: PointAttributionMap;
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
  pointAttributions?: PointAttributionMap;
  /** Chain-of-thought / reasoning channel, not shown as the answer body */
  reasoning?: string;
  /** Best-effort reasoning span in seconds (excludes network / placeholder time). */
  thinkingSeconds?: number;
  /**
   * Same-window follow-ups after the initial clarify turn.
   * Nested Clarify this still creates `children` + a new float.
   */
  replies?: BranchReply[];
  /** User adopted this fork's conclusion into the parent main answer. */
  adoptedAt?: number;
  /** Short summary written into the parent (for archive / re-adopt). */
  adoptedSummary?: string;
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
  pointAttributions?: PointAttributionMap;
  /** Chain-of-thought / reasoning channel, not shown as the answer body */
  reasoning?: string;
  /** Best-effort reasoning span in seconds (excludes network / placeholder time). */
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
   * How to render turns before the archive cutoff. Send context still
   * follows `contextMode` (archive log vs full thread).
   * - archive：主区显示归档正文 + 归档之后的新消息
   * - evolution：主区显示澄清/分点演进的完整记录
   */
  threadView?: ThreadView;
  /**
   * Compressed context pack (SUMMARY / TASKS / DECISIONS) when no project
   * write target is available. Project-bound packs live on disk under memoryDir.
   */
  contextMemory?: ContextMemoryPack | null;
  /**
   * Per-note session memory layer (short summary / working notes).
   * Separately injectable from the project pack and user preferences.
   */
  sessionMemory?: SessionMemory | null;
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
  /** Structured point-feedback event stream. */
  feedbackLog?: FeedbackEvent[];
  /** Learned policy weights from feedbackLog (simple bandit). */
  feedbackPolicy?: SessionFeedbackPolicy;
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

/** On-screen history while an archive exists (independent of send context). */
export type ThreadView = "archive" | "evolution";

export interface SessionStore {
  sessions: ChatSession[];
  activeSessionId: NodeId | null;
}

export type SettingsTab =
  | "general"
  | "api"
  | "memory"
  | "data"
  | "project"
  | "about";

/** User-wide preference entry (localStorage; injected as the preferences layer). */
export interface UserPreferenceEntry {
  id: string;
  text: string;
  updatedAt: number;
}

/** Per-note session memory layer. */
export interface SessionMemory {
  summary: string;
  updatedAt: number;
}

export interface ApiSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  useProxy: boolean;
  /**
   * Inject SUMMARY/TASKS/DECISIONS from the local memory pack into askMain.
   * Default true — no-op until a pack exists.
   * Alias of {@link memoryLayerProject}; kept for P0 settings compatibility.
   */
  contextMemoryEnabled?: boolean;
  /** Inject user preferences layer. Default true. */
  memoryLayerPreferences?: boolean;
  /**
   * Inject project memory pack (SUMMARY/TASKS/DECISIONS). Default true.
   * When unset, falls back to {@link contextMemoryEnabled}.
   */
  memoryLayerProject?: boolean;
  /** Inject per-note session summary. Default true. */
  memoryLayerSession?: boolean;
  /** After Archive succeeds, also run context compression. Default false. */
  compressAfterArchive?: boolean;
  /** Project-relative folder for the three MD files. Default `.forknote/memory` */
  memoryDir?: string;
  /**
   * Live-mode sliding window: keep this many recent user↔assistant turns full.
   * Older turns become a compact local summary. Default 12.
   */
  contextWindowTurns?: number;
  /**
   * When true (default), live mode injects a compact summary for turns outside
   * the sliding window instead of re-sending the full older thread.
   */
  contextAutoSummary?: boolean;
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
   * Preferred by InlineToolApproval over plan-prose parsing.
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
