import { useRef, type KeyboardEvent } from "react";

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
  placeholder = "Ask what you're researching…",
  compact = false,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

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
        placeholder={placeholder}
        aria-label={compact ? "Continue main thread" : "New question"}
      />

      <div className="fn-composer-bar">
        <p className="fn-composer-hint">
          {compact ? (
            <>
              <kbd>Enter</kbd> Send · <kbd>Shift</kbd>+<kbd>Enter</kbd> New line
            </>
          ) : (
            <>
              Drag-select text in answers to clarify · <kbd>Enter</kbd> Send
            </>
          )}
        </p>

        <div className="fn-composer-actions">
          {loading ? (
            <button
              type="button"
              className="fn-stop-btn"
              onClick={onStop}
              aria-label="Stop generating"
              title="Stop generating"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
                <rect x="1" y="1" width="10" height="10" rx="2" />
              </svg>
              <span>Stop</span>
            </button>
          ) : (
            <button
              type="submit"
              className="fn-send-btn"
              disabled={!value.trim()}
              aria-label="Send"
            >
              <span>Send</span>
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
