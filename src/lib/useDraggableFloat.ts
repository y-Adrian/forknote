import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  clampPanelPosition,
  positionFloatingPanel,
  sizeFloatingPanel,
} from "./floatPosition";

/**
 * Auto-places a float panel, then lets the user drag it by a handle.
 *
 * After the first place (or a drag), later layout/content updates only resize
 * the panel and clamp it — they do not snap back to the selection or replay
 * the enter animation (avoids the Enter/drag blink in Issue #67).
 */
export function useDraggableFloat(
  panelRef: RefObject<HTMLElement | null>,
  opts: {
    anchorRect: DOMRect | null;
    preferBelow?: boolean;
    depth?: number;
    zIndex?: number;
    /** Bumps when panel content/size should reflow (still respects locked position). */
    layoutToken?: string | number;
    /** Reset drag offset when this identity changes (e.g. branchId). */
    resetKey: string | number;
    /** Skip floatIn (e.g. handoff from Clarify ask panel). */
    skipEnterAnimation?: boolean;
    /** Seed absolute position from the panel being replaced. */
    seedLeft?: number;
    seedTop?: number;
  },
) {
  const {
    anchorRect,
    preferBelow = true,
    depth = 0,
    zIndex,
    layoutToken = 0,
    resetKey,
    skipEnterAnimation = false,
    seedLeft,
    seedTop,
  } = opts;

  const userPosRef = useRef<{ left: number; top: number } | null>(null);
  const lockedRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
  } | null>(null);

  const markSettled = useCallback((panel: HTMLElement) => {
    panel.classList.add("is-settled");
    panel.classList.remove("float-panel-enter");
  }, []);

  useEffect(() => {
    userPosRef.current = null;
    lockedRef.current = false;
    const panel = panelRef.current;
    if (!panel) return;
    if (skipEnterAnimation) {
      markSettled(panel);
    } else {
      panel.classList.remove("is-settled");
      panel.classList.add("float-panel-enter");
    }
  }, [resetKey, panelRef, skipEnterAnimation, markSettled]);

  const place = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const lockPos = () => {
      const left = parseFloat(panel.style.left || "0");
      const top = parseFloat(panel.style.top || "0");
      if (Number.isFinite(left) && Number.isFinite(top)) {
        userPosRef.current = clampPanelPosition(panel, left, top);
      }
      lockedRef.current = true;
    };

    // Already placed or dragged: size only — never rewrite to anchor (blink).
    if (lockedRef.current || userPosRef.current) {
      sizeFloatingPanel(panel, depth, zIndex);
      const pos = userPosRef.current;
      if (pos) {
        userPosRef.current = clampPanelPosition(panel, pos.left, pos.top);
      } else {
        lockPos();
      }
      return;
    }

    // Handoff from Clarify ask: keep the same viewport origin, no enter anim.
    if (
      skipEnterAnimation &&
      seedLeft != null &&
      seedTop != null &&
      Number.isFinite(seedLeft) &&
      Number.isFinite(seedTop)
    ) {
      sizeFloatingPanel(panel, depth, zIndex);
      userPosRef.current = clampPanelPosition(panel, seedLeft, seedTop);
      lockedRef.current = true;
      markSettled(panel);
      return;
    }

    positionFloatingPanel(panel, anchorRect, preferBelow, depth, zIndex);
    lockPos();

    if (skipEnterAnimation) {
      markSettled(panel);
      return;
    }

    // Let floatIn play once, then freeze animation so drag/enter can't replay it.
    const onEnd = () => markSettled(panel);
    panel.addEventListener("animationend", onEnd, { once: true });
    window.setTimeout(() => markSettled(panel), 280);
  }, [
    panelRef,
    anchorRect,
    preferBelow,
    depth,
    zIndex,
    layoutToken,
    markSettled,
    skipEnterAnimation,
    seedLeft,
    seedTop,
  ]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    place();

    const ro = new ResizeObserver(() => place());
    ro.observe(panel);
    window.addEventListener("resize", place);
    const onScroll = () => {
      if (lockedRef.current || userPosRef.current) return;
      place();
    };
    window.addEventListener("scroll", onScroll, true);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [panelRef, place]);

  const onDragHandlePointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const panel = panelRef.current;
    if (!panel) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("button, a, input, textarea, select")) return;

    e.preventDefault();
    e.stopPropagation();

    markSettled(panel);

    const left =
      parseFloat(panel.style.left || "0") ||
      panel.getBoundingClientRect().left;
    const top =
      parseFloat(panel.style.top || "0") || panel.getBoundingClientRect().top;

    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originLeft: left,
      originTop: top,
    };
    lockedRef.current = true;
    panel.classList.add("is-dragging");
    e.currentTarget.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || ev.pointerId !== drag.pointerId) return;
      const panelEl = panelRef.current;
      if (!panelEl) return;

      const nextLeft = drag.originLeft + (ev.clientX - drag.startX);
      const nextTop = drag.originTop + (ev.clientY - drag.startY);
      userPosRef.current = clampPanelPosition(panelEl, nextLeft, nextTop);
    };

    const onUp = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || ev.pointerId !== drag.pointerId) return;
      dragRef.current = null;
      panel.classList.remove("is-dragging");
      markSettled(panel);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return { onDragHandlePointerDown };
}
