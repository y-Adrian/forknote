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
}

export interface SessionStore {
  sessions: ChatSession[];
  activeSessionId: NodeId | null;
}

export interface ApiSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  useProxy: boolean;
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
