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

function IconDeepThink() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconAnnotate() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 20h4l10.5-10.5a2.1 2.1 0 00-3-3L5 17v3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconAttach() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 12l8.5-8.5a4 4 0 015.7 5.7l-9.2 9.2a6 6 0 01-8.5-8.5l10-10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  loading = false,
  placeholder = "给 Branch Chat 发送消息",
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
      className={`ds-composer ds-composer-deepseek${compact ? " is-compact" : " is-hero"}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!loading && value.trim()) onSubmit();
      }}
    >
      <textarea
        ref={ref}
        rows={compact ? 1 : 2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
      />

      <div className="ds-composer-toolbar">
        <div className="ds-composer-tools-left">
          <button
            type="button"
            className="ds-pill-btn"
            title="在 AI 回答中拖选文字，点击「针对选中追问」"
          >
            <IconAnnotate />
            <span>批注追问</span>
          </button>
          {!compact && (
            <button
              type="button"
              className="ds-pill-btn ds-pill-btn-muted"
              title="结构清晰的 Markdown 回答"
            >
              <IconDeepThink />
              <span>清晰排版</span>
            </button>
          )}
        </div>

        <div className="ds-composer-tools-right">
          <button
            type="button"
            className="ds-attach-btn"
            disabled
            title="附件功能暂未开放"
            aria-label="添加附件"
          >
            <IconAttach />
          </button>
          {loading ? (
            <button
              type="button"
              className="ds-stop-btn"
              onClick={onStop}
              aria-label="停止生成"
              title="停止生成"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
                <rect x="1" y="1" width="10" height="10" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              type="submit"
              className="ds-send-btn"
              disabled={!value.trim()}
              aria-label="发送"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 4l0 14M12 4l-5 5M12 4l5 5"
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
