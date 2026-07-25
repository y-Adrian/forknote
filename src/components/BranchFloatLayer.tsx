import { useMemo } from "react";
import { createPortal } from "react-dom";
import { anchorToDomRect } from "../lib/branchFloat";
import { useAppStore } from "../store/useAppStore";
import { FloatingBranchDetail } from "./FloatingBranchDetail";

export function BranchFloatLayer() {
  const stack = useAppStore((s) => s.branchFloatStack);
  const closeAllBranchFloats = useAppStore((s) => s.closeAllBranchFloats);
  const closeBranchFloat = useAppStore((s) => s.closeBranchFloat);

  const sortedStack = useMemo(
    () => [...stack].sort((a, b) => a.zIndex - b.zIndex),
    [stack],
  );

  const topZ = useMemo(
    () => (stack.length > 0 ? Math.max(...stack.map((e) => e.zIndex)) : 0),
    [stack],
  );

  if (stack.length === 0) return null;

  return createPortal(
    <>
      <button
        type="button"
        className={`float-dismiss-layer${stack.length > 1 ? " is-behind-stack" : ""}`}
        aria-label="Close all fork panels"
        onClick={closeAllBranchFloats}
      />
      {sortedStack.map((entry) => (
        <FloatingBranchDetail
          key={entry.branchId}
          branchId={entry.branchId}
          anchorRect={anchorToDomRect(entry.anchor)}
          depth={entry.depth}
          zIndex={entry.zIndex}
          isTopmost={entry.zIndex === topZ}
          skipEnterAnimation={entry.skipEnterAnimation}
          seedLeft={entry.seedLeft}
          seedTop={entry.seedTop}
          onClose={() => closeBranchFloat(entry.branchId)}
        />
      ))}
    </>,
    document.body,
  );
}
