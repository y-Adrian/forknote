import type {
  BranchNode,
  BranchReply,
  ChatMessage,
  ThreadRoot,
} from "../types";
import { createId } from "./id";

export function normalizeThread(raw: ThreadRoot): ThreadRoot {
  if (raw.messages?.length) {
    return {
      ...raw,
      messages: raw.messages.map((m) => ({
        ...m,
        children: m.children ?? [],
      })),
    };
  }

  const legacyChildren = raw.children ?? [];
  const userQ = raw.userQuestion ?? "";
  const assistantA = raw.assistantMessage ?? "";
  const createdAt = raw.createdAt ?? Date.now();
  const assistantId = createId();

  const messages: ChatMessage[] = [];
  if (userQ) {
    messages.push({
      id: createId(),
      role: "user",
      content: userQ,
      children: [],
      createdAt,
    });
  }
  if (userQ || assistantA) {
    messages.push({
      id: assistantId,
      role: "assistant",
      content: assistantA,
      children: legacyChildren,
      createdAt,
    });
  }

  return {
    id: raw.id,
    messages,
    createdAt,
  };
}

export function findMessage(
  thread: ThreadRoot,
  messageId: string,
): ChatMessage | undefined {
  return thread.messages.find((m) => m.id === messageId);
}

export function patchMessage(
  thread: ThreadRoot,
  messageId: string,
  patch: Partial<ChatMessage>,
): ThreadRoot {
  return {
    ...thread,
    messages: thread.messages.map((m) =>
      m.id === messageId ? { ...m, ...patch } : m,
    ),
  };
}

export function appendBranchToMessage(
  thread: ThreadRoot,
  messageId: string,
  branch: BranchNode,
): ThreadRoot {
  return patchMessage(thread, messageId, {
    children: [
      ...(findMessage(thread, messageId)?.children ?? []),
      branch,
    ],
  });
}

/** Drop a provisional Fork stub (and its subtree) after a failed clarify start. */
export function removeBranchFromThread(
  thread: ThreadRoot,
  branchId: string,
): ThreadRoot {
  const removeInNodes = (nodes: BranchNode[]): BranchNode[] =>
    nodes
      .filter((node) => node.id !== branchId)
      .map((node) => ({
        ...node,
        children: removeInNodes(node.children),
      }));

  return {
    ...thread,
    messages: thread.messages.map((m) => ({
      ...m,
      children: removeInNodes(m.children ?? []),
    })),
  };
}

export function patchBranchInThread(
  thread: ThreadRoot,
  branchId: string,
  patch: Partial<BranchNode>,
): ThreadRoot {
  const patchInNodes = (nodes: BranchNode[]): BranchNode[] =>
    nodes.map((node) => {
      if (node.id === branchId) return { ...node, ...patch };
      return { ...node, children: patchInNodes(node.children) };
    });

  return {
    ...thread,
    messages: thread.messages.map((m) => ({
      ...m,
      children: patchInNodes(m.children),
    })),
  };
}

/** Patch a same-window follow-up reply by index on a Fork branch. */
export function patchBranchReplyInThread(
  thread: ThreadRoot,
  branchId: string,
  replyIndex: number,
  patch: Partial<BranchReply>,
): ThreadRoot {
  const patchInNodes = (nodes: BranchNode[]): BranchNode[] =>
    nodes.map((node) => {
      if (node.id === branchId) {
        const replies = node.replies ?? [];
        if (replyIndex < 0 || replyIndex >= replies.length) return node;
        return {
          ...node,
          replies: replies.map((reply, i) =>
            i === replyIndex ? { ...reply, ...patch } : reply,
          ),
        };
      }
      return { ...node, children: patchInNodes(node.children) };
    });

  return {
    ...thread,
    messages: thread.messages.map((m) => ({
      ...m,
      children: patchInNodes(m.children),
    })),
  };
}

/** Patch the last same-window follow-up reply on a Fork. */
export function patchBranchLastReplyInThread(
  thread: ThreadRoot,
  branchId: string,
  patch: Partial<BranchReply>,
): ThreadRoot {
  const replies =
    findBranchInThread(thread, branchId)?.replies ?? [];
  if (replies.length === 0) return thread;
  return patchBranchReplyInThread(
    thread,
    branchId,
    replies.length - 1,
    patch,
  );
}

/**
 * @deprecated Nested follow-ups no longer walk children for chat continuation.
 * Kept for any legacy callers; prefer same-window `replies`.
 */
export function branchConversationLeaf(node: BranchNode): BranchNode {
  if (node.children.length === 0) return node;
  return branchConversationLeaf(node.children[node.children.length - 1]);
}

export function findAssistantMessageForBranch(
  thread: ThreadRoot,
  branchId: string,
): ChatMessage | undefined {
  const contains = (nodes: BranchNode[]): boolean => {
    for (const node of nodes) {
      if (node.id === branchId) return true;
      if (contains(node.children)) return true;
    }
    return false;
  };

  return thread.messages.find(
    (m) => m.role === "assistant" && contains(m.children),
  );
}

export function findBranchInThread(
  thread: ThreadRoot,
  branchId: string,
): BranchNode | undefined {
  const walk = (nodes: BranchNode[]): BranchNode | undefined => {
    for (const node of nodes) {
      if (node.id === branchId) return node;
      const found = walk(node.children);
      if (found) return found;
    }
    return undefined;
  };
  for (const m of thread.messages) {
    const found = walk(m.children);
    if (found) return found;
  }
  return undefined;
}

export function firstUserMessage(thread: ThreadRoot | null): string {
  if (!thread) return "";
  const user = thread.messages.find((m) => m.role === "user");
  return user?.content ?? "";
}
