import { useEffect, useState } from "react";
import { useLocale } from "../lib/i18n";

interface Props {
  /** Real reasoning text only — never call with an empty placeholder */
  reasoning: string;
  /** Elapsed seconds until first answer token */
  seconds?: number;
  /** True while the assistant reply is still streaming */
  streaming?: boolean;
}

/**
 * Renders only when `reasoning` has real text from the model.
 * No empty “Thinking…” shell and no invented chain-of-thought.
 */
export function ThinkingBlock({ reasoning, seconds, streaming = false }: Props) {
  const { t } = useLocale();
  const text = reasoning.trim();
  const [open, setOpen] = useState(Boolean(streaming && text));

  useEffect(() => {
    if (streaming && text) setOpen(true);
  }, [streaming, text]);

  useEffect(() => {
    if (!streaming && text) setOpen(false);
  }, [streaming, text]);

  if (!text) return null;

  const label =
    seconds != null && seconds > 0
      ? t("chat.thoughtSeconds", { n: seconds })
      : streaming
        ? t("chat.thinking")
        : t("chat.thought");

  return (
    <div className={`fn-thinking${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="fn-thinking-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="fn-thinking-icon" aria-hidden>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 3a6 6 0 0 0-4.5 9.8V15a1.5 1.5 0 0 0 1.5 1.5h6A1.5 1.5 0 0 0 16.5 15v-2.2A6 6 0 0 0 12 3z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path
              d="M10 19h4M11 22h2"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <span className="fn-thinking-label">{label}</span>
        <span className="fn-thinking-chevron" aria-hidden>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path
              d="M6 9l6 6 6-6"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      {open ? <div className="fn-thinking-body">{text}</div> : null}
    </div>
  );
}
