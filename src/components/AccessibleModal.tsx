import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  isEscapeKey,
  listFocusable,
  pushModalEscapeHandler,
  topModalEscapeHandler,
  trapFocusKeydown,
} from "../lib/modalFocus";

export interface AccessibleModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Prefer labelledBy (points at a visible title). */
  labelledBy?: string;
  /** Used when there is no visible title element. */
  ariaLabel?: string;
  className?: string;
  backdropClassName?: string;
  style?: CSSProperties;
  /** Optional element to focus on open; otherwise first focusable / dialog. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** When false, backdrop click does not call onClose (rare). Default true. */
  closeOnBackdrop?: boolean;
}

/**
 * Shared modal chrome: portal, aria-modal dialog, Escape (topmost only),
 * Tab focus trap, initial focus, and restore focus on close.
 */
export function AccessibleModal({
  open,
  onClose,
  children,
  labelledBy,
  ariaLabel,
  className = "modal",
  backdropClassName = "modal-backdrop",
  style,
  initialFocusRef,
  closeOnBackdrop = true,
}: AccessibleModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const reactId = useId();
  const titleId = labelledBy ?? undefined;

  useEffect(() => {
    if (!open) return;
    restoreRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const popEscape = pushModalEscapeHandler(onClose);

    const onKeyDown = (e: KeyboardEvent) => {
      if (isEscapeKey(e.key)) {
        if (topModalEscapeHandler() !== onClose) return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      const root = dialogRef.current;
      if (!root) return;
      trapFocusKeydown(root, e);
    };
    document.addEventListener("keydown", onKeyDown, true);

    const focusInitial = () => {
      const root = dialogRef.current;
      if (!root) return;
      const preferred = initialFocusRef?.current;
      if (preferred && root.contains(preferred)) {
        preferred.focus();
        return;
      }
      const focusables = listFocusable(root);
      if (focusables[0]) {
        focusables[0].focus();
        return;
      }
      root.focus();
    };
    const raf = requestAnimationFrame(focusInitial);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown, true);
      popEscape();
      const prev = restoreRef.current;
      restoreRef.current = null;
      if (prev && document.contains(prev)) {
        prev.focus();
      }
    };
  }, [open, onClose, initialFocusRef]);

  if (!open) return null;

  return createPortal(
    <div
      className={backdropClassName}
      data-fn-accessible-modal="backdrop"
      data-fn-modal-id={reactId}
      onClick={() => {
        if (closeOnBackdrop) onClose();
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className={className}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-label={titleId ? undefined : ariaLabel}
        tabIndex={-1}
        data-fn-accessible-modal="dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
