import type { BranchNode, ThreadRoot } from "../types";

export function collectBranchIds(nodes: BranchNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    ids.push(node.id);
    ids.push(...collectBranchIds(node.children));
  }
  return ids;
}

export function countBranches(nodes: BranchNode[]): number {
  return nodes.reduce((n, node) => n + 1 + countBranches(node.children), 0);
}

export function countBranchesInThread(thread: ThreadRoot): number {
  return thread.messages.reduce(
    (n, m) => n + countBranches(m.children),
    0,
  );
}

export function allBranchesInThread(thread: ThreadRoot): BranchNode[] {
  const list: BranchNode[] = [];
  const walk = (nodes: BranchNode[]) => {
    for (const node of nodes) {
      list.push(node);
      walk(node.children);
    }
  };
  for (const m of thread.messages) {
    walk(m.children);
  }
  return list;
}
