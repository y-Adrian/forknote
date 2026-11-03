import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  copyTextToClipboard,
  type CopyTextFeedback,
} from "../lib/clipboard";
import { useLocale } from "../lib/i18n";

interface Props {
  text: string;
  onEdit?: () => void;
  /** Fired after a successful copy (e.g. passive-use feedback signal). */
  onCopy?: () => void;
  onDiagnose?: () => Promise<boolean> | boolean;
  /** Save this reply's Agent loop trace; false when none was recorded. */
  onSaveTrace?: () => Promise<boolean> | boolean;
  /** Whether this reply has an Agent loop trace (greys out the save item). */
  onCheckTrace?: () => Promise<boolean> | boolean;
  align?: "start" | "end";
}

type ReportFeedback = "idle" | "copied" | "saved" | "failed" | "missing";

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path
      d="M5 12.5l4.5 4.5L19 7.5"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const CrossIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path
      d="M7 7l10 10M17 7L7 17"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

const BugIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
    <rect x="7" y="8" width="10" height="12" rx="5" stroke="currentColor" strokeWidth="1.6" />
    <path
      d="M9 8.5V7a3 3 0 0 1 6 0v1.5M12 12v8M7 13H3.5M20.5 13H17M7.5 17.5l-3 2M16.5 17.5l3 2M7.5 9.5l-3-2M16.5 9.5l3-2"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
);

const ClipboardIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
    <rect x="5" y="4" width="14" height="17" rx="2" stroke="currentColor" strokeWidth="1.6" />
    <path d="M9 4h6v3H9zM9 12h6M9 16h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const FileDownIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path
      d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <path d="M12 10.5v6M9.5 14l2.5 2.5 2.5-2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function MessageActions({
  text,
  onEdit,
  onCopy,
  onDiagnose,
  onSaveTrace,
  onCheckTrace,
  align = "end",
}: Props) {
  const { t } = useLocale();
  const [feedback, setFeedback] = useState<CopyTextFeedback>("idle");
  const [reportFeedback, setReportFeedback] = useState<ReportFeedback>("idle");
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const [hasTrace, setHasTrace] = useState<boolean | null>(null);
  const reportButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuOpen = menuStyle !== null;

  const copy = async () => {
    const ok = await copyTextToClipboard(text);
    if (ok) onCopy?.();
    setFeedback(ok ? "copied" : "failed");
    window.setTimeout(() => setFeedback("idle"), 1400);
  };

  const showReportFeedback = (next: ReportFeedback) => {
    setReportFeedback(next);
    window.setTimeout(() => setReportFeedback("idle"), 1800);
  };

  const closeMenu = () => setMenuStyle(null);

  const diagnose = async () => {
    closeMenu();
    if (!onDiagnose) return;
    const ok = await onDiagnose();
    showReportFeedback(ok ? "copied" : "failed");
  };

  const saveTrace = async () => {
    closeMenu();
    if (!onSaveTrace) return;
    const ok = await onSaveTrace();
    showReportFeedback(ok ? "saved" : "missing");
  };

  const toggleMenu = () => {
    if (menuOpen) {
      closeMenu();
      return;
    }
    const rect = reportButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Opens below the button; the layout effect flips / shifts it once measured.
    setMenuStyle({ left: Math.max(8, rect.left), top: rect.bottom + 4 });
    setHasTrace(null);
    if (onCheckTrace) {
      void Promise.resolve(onCheckTrace()).then(setHasTrace, () => setHasTrace(false));
    }
  };

  // Keep the menu on screen: flip above the button or shift left when it overflows.
  useLayoutEffect(() => {
    const menu = menuRef.current?.getBoundingClientRect();
    const button = reportButtonRef.current?.getBoundingClientRect();
    if (!menu || !button || !menuStyle || menuStyle.bottom !== undefined) return;
    const flip = menu.bottom > window.innerHeight - 8 && button.top - 4 - menu.height >= 8;
    const left = Math.max(8, Math.min(menu.left, window.innerWidth - 8 - menu.width));
    if (!flip && left === menu.left) return;
    setMenuStyle(flip
      ? { left, bottom: window.innerHeight - button.top + 4 }
      : { ...menuStyle, left });
  }, [menuStyle]);

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const onPointerDown = (e: globalThis.MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || reportButtonRef.current?.contains(target)) return;
      closeMenu();
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      closeMenu();
      reportButtonRef.current?.focus();
    };
    const onScrollOrResize = () => closeMenu();
    // Defer so the opening click does not immediately dismiss the menu.
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", onPointerDown);
    }, 0);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [menuOpen]);

  const label =
    feedback === "copied"
      ? t("chat.copied")
      : feedback === "failed"
        ? t("chat.copyFailed")
        : t("chat.copy");

  const reportLabel =
    reportFeedback === "copied"
      ? t("chat.diagnoseCopied")
      : reportFeedback === "saved"
        ? t("chat.traceSaved")
        : reportFeedback === "missing"
          ? t("chat.traceMissing")
          : reportFeedback === "failed"
            ? t("chat.copyFailed")
            : t("chat.report");
  const reportFailed = reportFeedback === "failed" || reportFeedback === "missing";
  const traceDisabled = hasTrace === false;

  return (
    <div
      className={`fn-msg-actions${align === "start" ? " is-start" : " is-end"}`}
    >
      <button
        type="button"
        className={`fn-msg-action${feedback === "failed" ? " is-copy-failed" : ""}`}
        onClick={() => void copy()}
        aria-label={label}
        data-tip={label}
      >
        {feedback === "copied" ? (
          <CheckIcon />
        ) : feedback === "failed" ? (
          <CrossIcon />
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect
              x="9"
              y="9"
              width="11"
              height="11"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        )}
      </button>
      {onEdit ? (
        <button
          type="button"
          className="fn-msg-action"
          onClick={onEdit}
          aria-label={t("chat.edit")}
          data-tip={t("chat.edit")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M4 20h4l10.5-10.5a1.5 1.5 0 0 0 0-2.12L16.62 5.5a1.5 1.5 0 0 0-2.12 0L4 16v4z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path
              d="M13.5 6.5l4 4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      ) : null}
      {onDiagnose || onSaveTrace ? (
        <button
          ref={reportButtonRef}
          type="button"
          className={`fn-msg-action${reportFailed ? " is-copy-failed" : ""}${menuOpen ? " is-active" : ""}`}
          onClick={toggleMenu}
          aria-label={reportLabel}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          data-tip={menuOpen ? undefined : reportLabel}
        >
          {reportFeedback === "copied" || reportFeedback === "saved" ? (
            <CheckIcon />
          ) : reportFailed ? (
            <CrossIcon />
          ) : (
            <BugIcon />
          )}
        </button>
      ) : null}
      {menuStyle
        ? createPortal(
            <div
              ref={menuRef}
              className="fn-session-menu fn-report-menu"
              role="menu"
              aria-label={t("chat.report")}
              style={menuStyle}
            >
              {onDiagnose ? (
                <button type="button" role="menuitem" onClick={() => void diagnose()}>
                  <span className="fn-session-menu-icon" aria-hidden>
                    <ClipboardIcon />
                  </span>
                  <span className="fn-report-menu-text">
                    <span>{t("chat.diagnose")}</span>
                    <span className="fn-report-menu-hint">{t("chat.diagnoseTitle")}</span>
                  </span>
                </button>
              ) : null}
              {onSaveTrace ? (
                <button
                  type="button"
                  role="menuitem"
                  disabled={traceDisabled}
                  onClick={() => void saveTrace()}
                >
                  <span className="fn-session-menu-icon" aria-hidden>
                    <FileDownIcon />
                  </span>
                  <span className="fn-report-menu-text">
                    <span>{t("chat.saveTrace")}</span>
                    <span className="fn-report-menu-hint">
                      {traceDisabled ? t("chat.traceMissing") : t("chat.saveTraceTitle")}
                    </span>
                  </span>
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
