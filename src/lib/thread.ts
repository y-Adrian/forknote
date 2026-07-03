import type { BranchNode, ChatMessage, ThreadRoot } from "../types";
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
