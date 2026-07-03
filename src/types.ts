export type NodeId = string;

export interface Anchor {
  startOffset: number;
  endOffset: number;
  quotedText: string;
}

/** 用户对回答中某个分点的裁决 */
export type PointVerdict = "accept" | "unsure" | "reject";

/** key = 分点编号（回答中的 N） */
export type PointVerdictMap = Record<number, PointVerdict>;

export interface BranchNode {
  id: NodeId;
  parentId: NodeId;
  anchor: Anchor;
  userQuestion: string;
  assistantMessage: string;
  children: BranchNode[];
  createdAt: number;
  pointVerdicts?: PointVerdictMap;
}

export interface ChatMessage {
  id: NodeId;
  role: "user" | "assistant";
  content: string;
  /** 批注挂在某条助手回复上 */
  children: BranchNode[];
  createdAt: number;
  pointVerdicts?: PointVerdictMap;
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

/** 一条独立对话（可含批注分支） */
export interface ChatSession {
  id: NodeId;
  title: string;
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
