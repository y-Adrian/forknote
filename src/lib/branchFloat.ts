import type { NodeId } from "../types";

export interface BranchFloatAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BranchFloatEntry {
  branchId: NodeId;
  anchor: BranchFloatAnchor;
  depth: number;
  parentBranchId: NodeId | null;
  /** 打开顺序，越大越靠上 */
  zIndex: number;
}

export const FLOAT_Z_BASE = 220;
/** 追问框 / 划选工具栏相对所属批注浮窗的层级偏移 */
export const FLOAT_Z_TOOLBAR_OFFSET = 40;
export const FLOAT_Z_ASK_OFFSET = 50;

export function nextFloatZIndex(stack: BranchFloatEntry[]): number {
  if (stack.length === 0) return FLOAT_Z_BASE + 1;
  return Math.max(...stack.map((e) => e.zIndex)) + 1;
}

export function domRectToAnchor(rect: DOMRect): BranchFloatAnchor {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

export function anchorToDomRect(anchor: BranchFloatAnchor): DOMRect {
  return new DOMRect(anchor.x, anchor.y, anchor.width, anchor.height);
}

/** 在 parent 之下打开子浮窗；无 parent 时作为根浮窗 */
export function pushBranchFloat(
  stack: BranchFloatEntry[],
  branchId: NodeId,
  rect: DOMRect,
  parentBranchId: NodeId | null,
  zIndex: number,
): BranchFloatEntry[] {
  const entry: BranchFloatEntry = {
    branchId,
    anchor: domRectToAnchor(rect),
    depth: 0,
    parentBranchId,
    zIndex,
  };

  if (!parentBranchId) {
    return [{ ...entry, depth: 0, parentBranchId: null, zIndex }];
  }

  const parentIdx = stack.findIndex((e) => e.branchId === parentBranchId);
  if (parentIdx < 0) {
    return [{ ...entry, depth: 0, parentBranchId: null, zIndex }];
  }

  const depth = stack[parentIdx].depth + 1;
  return [
    ...stack.slice(0, parentIdx + 1),
    { ...entry, depth, parentBranchId, zIndex },
  ];
}

export function popBranchFloat(
  stack: BranchFloatEntry[],
  branchId: NodeId,
): BranchFloatEntry[] {
  const idx = stack.findIndex((e) => e.branchId === branchId);
  if (idx < 0) return stack;
  return stack.slice(0, idx);
}
