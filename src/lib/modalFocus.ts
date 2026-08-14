/**
 * Focus helpers for the shared AccessibleModal primitive (#353).
 */

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function listFocusable(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => {
      if (el.getAttribute("aria-hidden") === "true") return false;
      if (el.tabIndex < 0) return false;
      // offsetParent is null for fixed/hidden; still allow fixed dialog controls.
      const style = window.getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") return false;
      return true;
    },
  );
}

export function isEscapeKey(key: string): boolean {
  return key === "Escape" || key === "Esc";
}

/**
 * Cycle Tab / Shift+Tab inside `root`. Returns true when the event was handled.
 */
export function trapFocusKeydown(
  root: HTMLElement,
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">,
): boolean {
  if (event.key !== "Tab") return false;
  const items = listFocusable(root);
  if (items.length === 0) {
    event.preventDefault();
    root.focus();
    return true;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement as HTMLElement | null;
  if (event.shiftKey) {
    if (!active || active === first || !root.contains(active)) {
      event.preventDefault();
      last.focus();
      return true;
    }
  } else if (active === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

/** Module stack so nested modals: Escape closes only the topmost. */
const escapeStack: Array<() => void> = [];

export function pushModalEscapeHandler(onClose: () => void): () => void {
  escapeStack.push(onClose);
  return () => {
    const idx = escapeStack.lastIndexOf(onClose);
    if (idx >= 0) escapeStack.splice(idx, 1);
  };
}

export function topModalEscapeHandler(): (() => void) | undefined {
  return escapeStack[escapeStack.length - 1];
}

export function modalEscapeStackDepth(): number {
  return escapeStack.length;
}
