import { useRef, type KeyboardEvent } from "react";
import { useLocale } from "../lib/i18n";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  loading?: boolean;
  placeholder?: string;
  compact?: boolean;
}

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  loading = false,
  placeholder,
  compact = false,
}: Props) {
  const { t } = useLocale();
  const ref = useRef<HTMLTextAreaElement>(null);
  const resolvedPlaceholder = placeholder ?? t("main.placeholderEmpty");

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!loading && value.trim()) onSubmit();
    }
  };

  return (
    <form
      className={`fn-composer${compact ? " is-compact" : " is-hero"}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!loading && value.trim()) onSubmit();
      }}
    >
      <textarea
        ref={ref}
        rows={compact ? 1 : 3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={resolvedPlaceholder}
        aria-label={compact ? t("composer.continue") : t("composer.newQuestion")}
      />

      <div className="fn-composer-bar">
        <p className="fn-composer-hint">
          {compact ? t("composer.hintCompact") : t("composer.hintHero")}
        </p>

        <div className="fn-composer-actions">
          {loading ? (
            <button
              type="button"
              className="fn-stop-btn"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onStop?.();
              }}
              aria-label={t("composer.stopAria")}
              title={t("composer.stopAria")}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
                <rect x="1" y="1" width="10" height="10" rx="2" />
              </svg>
              <span>{t("common.stop")}</span>
            </button>
          ) : (
            <button
              type="submit"
              className="fn-send-btn"
              disabled={!value.trim()}
              aria-label={t("common.send")}
            >
              <span>{t("common.send")}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M5 12h14M13 6l6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
