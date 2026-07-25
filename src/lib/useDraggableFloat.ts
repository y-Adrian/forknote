import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { positionFloatingPanel } from "./floatPosition";

/**
 * Auto-places a float panel, then lets the user drag it by a handle.
 * After a drag, content/resize updates keep the user position (clamped to viewport).
 */
export function useDraggableFloat(
  panelRef: RefObject<HTMLElement | null>,
  opts: {
    anchorRect: DOMRect | null;
    preferBelow?: boolean;
    depth?: number;
    zIndex?: number;
    /** Bumps when panel content/size should reflow (still respects drag offset). */
    layoutToken?: string | number;
    /** Reset drag offset when this identity changes (e.g. branchId). */
    resetKey: string | number;
  },
) {
  const {
    anchorRect,
    preferBelow = true,
    depth = 0,
    zIndex,
    layoutToken = 0,
    resetKey,
  } = opts;

  const userPosRef = useRef<{ left: number; top: number } | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
  } | null>(null);

  useEffect(() => {
    userPosRef.current = null;
  }, [resetKey]);

  const place = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;

    positionFloatingPanel(panel, anchorRect, preferBelow, depth, zIndex);

    const user = userPosRef.current;
    if (!user) return;

    const w = panel.offsetWidth || 280;
    const h = panel.offsetHeight || 200;
    const left = Math.max(8, Math.min(user.left, window.innerWidth - w - 8));
    const top = Math.max(8, Math.min(user.top, window.innerHeight - h - 8));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    userPosRef.current = { left, top };
  }, [panelRef, anchorRect, preferBelow, depth, zIndex, layoutToken]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    place();

    const ro = new ResizeObserver(() => place());
    ro.observe(panel);
    window.addEventListener("resize", place);
    const onScroll = () => {
      if (userPosRef.current) return;
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
    panel.classList.add("is-dragging");
    e.currentTarget.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || ev.pointerId !== drag.pointerId) return;
      const panelEl = panelRef.current;
      if (!panelEl) return;

      const nextLeft = drag.originLeft + (ev.clientX - drag.startX);
      const nextTop = drag.originTop + (ev.clientY - drag.startY);
      const w = panelEl.offsetWidth || 280;
      const h = panelEl.offsetHeight || 200;
      const leftClamped = Math.max(
        8,
        Math.min(nextLeft, window.innerWidth - w - 8),
      );
      const topClamped = Math.max(
        8,
        Math.min(nextTop, window.innerHeight - h - 8),
      );
      panelEl.style.left = `${leftClamped}px`;
      panelEl.style.top = `${topClamped}px`;
      userPosRef.current = { left: leftClamped, top: topClamped };
    };

    const onUp = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || ev.pointerId !== drag.pointerId) return;
      dragRef.current = null;
      panel.classList.remove("is-dragging");
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
