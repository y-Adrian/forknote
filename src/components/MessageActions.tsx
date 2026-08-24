import { useState } from "react";
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
  align?: "start" | "end";
}

export function MessageActions({
  text,
  onEdit,
  onCopy,
  onDiagnose,
  align = "end",
}: Props) {
  const { t } = useLocale();
  const [feedback, setFeedback] = useState<CopyTextFeedback>("idle");
  const [diagnoseFeedback, setDiagnoseFeedback] =
    useState<CopyTextFeedback>("idle");

  const copy = async () => {
    const ok = await copyTextToClipboard(text);
    if (ok) onCopy?.();
    setFeedback(ok ? "copied" : "failed");
    window.setTimeout(() => setFeedback("idle"), 1400);
  };

  const diagnose = async () => {
    if (!onDiagnose) return;
    const ok = await onDiagnose();
    setDiagnoseFeedback(ok ? "copied" : "failed");
    window.setTimeout(() => setDiagnoseFeedback("idle"), 1400);
  };

  const label =
    feedback === "copied"
      ? t("chat.copied")
      : feedback === "failed"
        ? t("chat.copyFailed")
        : t("chat.copy");

  return (
    <div
      className={`fn-msg-actions${align === "start" ? " is-start" : " is-end"}`}
    >
      <button
        type="button"
        className={`fn-msg-action${feedback === "failed" ? " is-copy-failed" : ""}`}
        onClick={() => void copy()}
        aria-label={label}
        title={label}
      >
        {feedback === "copied" ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M5 12.5l4.5 4.5L19 7.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : feedback === "failed" ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M7 7l10 10M17 7L7 17"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
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
          title={t("chat.edit")}
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
      {onDiagnose ? (
        <button
          type="button"
          className={`fn-msg-action${diagnoseFeedback === "failed" ? " is-copy-failed" : ""}`}
          onClick={() => void diagnose()}
          aria-label={
            diagnoseFeedback === "copied"
              ? t("chat.diagnoseCopied")
              : diagnoseFeedback === "failed"
                ? t("chat.copyFailed")
                : t("chat.diagnose")
          }
          title={
            diagnoseFeedback === "copied"
              ? t("chat.diagnoseCopied")
              : diagnoseFeedback === "failed"
                ? t("chat.copyFailed")
                : t("chat.diagnoseTitle")
          }
        >
          {diagnoseFeedback === "copied" ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M5 12.5l4.5 4.5L19 7.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 3v3M12 18v3M4.22 5.64l2.12 2.12M17.66 17.66l2.12 2.12M3 12h3M18 12h3M4.22 18.36l2.12-2.12M17.66 6.34l2.12-2.12"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <circle
                cx="12"
                cy="12"
                r="3.5"
                stroke="currentColor"
                strokeWidth="1.6"
              />
            </svg>
          )}
        </button>
      ) : null}
    </div>
  );
}
