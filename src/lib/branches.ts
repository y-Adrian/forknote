import type { BranchNode, NodeId } from "../types";

export function collectBranchIds(nodes: BranchNode[]): NodeId[] {
  const ids: NodeId[] = [];
  for (const node of nodes) {
    ids.push(node.id);
    ids.push(...collectBranchIds(node.children));
  }
  return ids;
}

export function countBranches(nodes: BranchNode[]): number {
  return nodes.reduce((n, node) => n + 1 + countBranches(node.children), 0);
}
