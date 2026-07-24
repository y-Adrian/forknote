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
}

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
   * Inject SUMMARY/TASKS/DECISIONS (and optional mem0 hits) into askMain.
   * Default true — no-op until a pack exists.
   */
  contextMemoryEnabled?: boolean;
  /** After Archive succeeds, also run context compression. Default false. */
  compressAfterArchive?: boolean;
  /** Project-relative folder for the three MD files. Default `.forknote/memory` */
  memoryDir?: string;
  /**
   * Optional mem0 Platform memory (cloud). Off by default.
   * When enabled, main-turn / archive / compress snippets are sent to mem0 host.
   */
  mem0Enabled?: boolean;
  /** mem0 Platform API key (https://app.mem0.ai) */
  mem0ApiKey?: string;
  /** Optional entity id; blank → stable browser-local id */
  mem0UserId?: string;
  /** Override Platform host; default https://api.mem0.ai */
  mem0Host?: string;
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
}

/** Agent plan awaiting user approval before tool execution. */
export interface AgentPendingPlan {
  id: NodeId;
  userPrompt: string;
  planText: string;
  steps: string[];
  userId: NodeId;
  assistantId: NodeId;
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
