import type { BranchNode } from "../types";

/** Vertical gap between DFS-ordered rail nodes (keep in sync with BranchRail). */
export const RAIL_Y_START = 22;
export const RAIL_Y_GAP = 28;
export const RAIL_TRUNK_R = 5.5;
export const RAIL_OVERSCAN_PX = 240;

export function countBranchNodes(branches: BranchNode[]): number {
  let n = 0;
  for (const b of branches) {
    n += 1 + countBranchNodes(b.children);
  }
  return n;
}

/** Document-Y span occupied by one assistant message's trunk + DFS tree. */
export function messageRailSpan(
  messageOffsetTop: number,
  branches: BranchNode[],
): { minY: number; maxY: number } {
  const forkY = messageOffsetTop + 20;
  const nodes = countBranchNodes(branches);
  const minY = forkY - RAIL_TRUNK_R;
  const maxY =
    nodes === 0
      ? forkY + RAIL_TRUNK_R
      : forkY + RAIL_Y_START + nodes * RAIL_Y_GAP + RAIL_TRUNK_R;
  return { minY, maxY };
}

export function railVisibleWindow(
  scrollTop: number,
  viewportH: number,
  overscan = RAIL_OVERSCAN_PX,
): { minY: number; maxY: number } {
  return {
    minY: scrollTop - overscan,
    maxY: scrollTop + Math.max(viewportH, 0) + overscan,
  };
}

export function spansOverlap(
  a: { minY: number; maxY: number },
  b: { minY: number; maxY: number },
): boolean {
  return a.maxY >= b.minY && a.minY <= b.maxY;
}

/**
 * Keep only messages whose rail geometry intersects the viewport (+ overscan).
 * Proves we never need an SVG as tall as the full chat scrollHeight.
 */
export function filterMsgsForRailViewport<
  T extends { y: number; branches: BranchNode[] },
>(msgs: T[], scrollTop: number, viewportH: number, overscan = RAIL_OVERSCAN_PX): T[] {
  const win = railVisibleWindow(scrollTop, viewportH, overscan);
  return msgs.filter((m) =>
    spansOverlap(messageRailSpan(m.y, m.branches), win),
  );
}
