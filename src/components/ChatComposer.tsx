import { useRef, type KeyboardEvent } from "react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  loading?: boolean;
  placeholder?: string;
  compact?: boolean;
}

export function ChatComposer({
  value,
  onChange,
  onSubmit,
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
      className={`ds-composer${compact ? " ds-composer-compact" : ""}`}
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
        disabled={loading}
      />
      <div className="ds-composer-footer">
        <span className="ds-composer-hint">
          {!compact && "选中回答中的文字可添加批注追问"}
        </span>
        <button
          type="submit"
          className="ds-send-btn"
          disabled={loading || !value.trim()}
          aria-label="发送"
        >
          {loading ? (
            <span className="ds-send-spinner" />
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 4l0 14M12 4l-5 5M12 4l5 5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
      </div>
    </form>
  );
}
