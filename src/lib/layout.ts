/** Keep in sync with `@media (max-width: 768px)` in `src/index.css`. */
export const SIDEBAR_NARROW_MAX_PX = 768;
export const SIDEBAR_NARROW_MQ = `(max-width: ${SIDEBAR_NARROW_MAX_PX}px)`;

export function isSidebarNarrowViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(SIDEBAR_NARROW_MQ).matches;
}
