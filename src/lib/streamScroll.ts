/** User intent takes precedence over near-bottom streaming updates. */
export function bindStreamingScroll(
  root: HTMLElement,
  follow: { current: boolean },
): () => void {
  let previousTop = root.scrollTop;
  let touchY: number | undefined;
  const onScroll = () => {
    const top = root.scrollTop;
    const distance = root.scrollHeight - top - root.clientHeight;
    // Content shrinking at the bottom clamps scrollTop down too; only an
    // upward move that leaves the bottom is the reader scrolling up.
    if (top < previousTop && distance > 2) follow.current = false;
    else if (distance <= 2) follow.current = true;
    else if (distance > 96) follow.current = false;
    previousTop = top;
  };
  const onWheel = (event: WheelEvent) => {
    if (event.deltaY < 0) follow.current = false;
  };
  const onTouchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY; };
  const onTouchMove = (event: TouchEvent) => {
    const next = event.touches[0]?.clientY;
    if (next != null && touchY != null && next > touchY) follow.current = false;
    touchY = next;
  };
  const onKey = (event: KeyboardEvent) => {
    if (["ArrowUp", "PageUp", "Home"].includes(event.key) || (event.key === " " && event.shiftKey)) {
      follow.current = false;
    }
  };
  root.addEventListener("scroll", onScroll, { passive: true });
  root.addEventListener("wheel", onWheel, { passive: true });
  root.addEventListener("touchstart", onTouchStart, { passive: true });
  root.addEventListener("touchmove", onTouchMove, { passive: true });
  root.addEventListener("keydown", onKey);
  return () => {
    root.removeEventListener("scroll", onScroll);
    root.removeEventListener("wheel", onWheel);
    root.removeEventListener("touchstart", onTouchStart);
    root.removeEventListener("touchmove", onTouchMove);
    root.removeEventListener("keydown", onKey);
  };
}
