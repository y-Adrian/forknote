import { useLocale } from "../lib/i18n";

interface Props {
  top: number;
  left: number;
  onAsk: () => void;
  fixed?: boolean;
  zIndex?: number;
}

export function SelectionToolbar({
  top,
  left,
  onAsk,
  fixed = false,
  zIndex,
}: Props) {
  const { t } = useLocale();

  return (
    <div
      className={`selection-toolbar fn-selection-toolbar${fixed ? " is-fixed" : ""}`}
      style={{
        top: `${top}px`,
        left: `${left}px`,
        ...(zIndex !== undefined ? { zIndex } : {}),
      }}
    >
      <button
        type="button"
        className="fn-clarify-btn"
        // Keep the text selection when pressing the button (otherwise the
        // toolbar dismisses before click and Clarify never opens).
        onMouseDown={(e) => e.preventDefault()}
        onClick={onAsk}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M8 12h.01M12 12h.01M16 12h.01M9 19H5a2 2 0 01-2-2V7a2 2 0 012-2h14a2 2 0 012 2v6a2 2 0 01-2 2h-5l-4 4z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {t("clarify.toolbar")}
      </button>
    </div>
  );
}
