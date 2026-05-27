export type NodeId = string;

export interface Anchor {
  startOffset: number;
  endOffset: number;
  quotedText: string;
}

export interface BranchNode {
  id: NodeId;
  parentId: NodeId;
  anchor: Anchor;
  userQuestion: string;
  assistantMessage: string;
  children: BranchNode[];
  createdAt: number;
}

export interface ThreadRoot {
  id: NodeId;
  userQuestion: string;
  assistantMessage: string;
  children: BranchNode[];
  createdAt: number;
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
