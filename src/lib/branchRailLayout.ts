const TRUNK_X = 12;
const TRUNK_R = 5.5;
const X_STEP = 32;
const RAIL_PAD = 10;
const LABEL_W = 62;
const RAIL_W_MAX = 160;

/** Compact when trunk-only; grow with fork depth + label, never past max. */
export function branchRailWidthPx(maxDepth: number): number {
  if (maxDepth <= 0) return Math.ceil(TRUNK_X + TRUNK_R + RAIL_PAD);
  return Math.min(
    RAIL_W_MAX,
    Math.ceil(TRUNK_X + maxDepth * X_STEP + TRUNK_R + 5 + LABEL_W + RAIL_PAD),
  );
}
