import { useLocale } from "../lib/i18n";

interface Props {
  quotedText: string;
  question: string;
  loading: boolean;
  onQuestionChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export function BranchPopover({
  quotedText,
  question,
  loading,
  onQuestionChange,
  onSubmit,
  onClose,
}: Props) {
  const { t } = useLocale();

  return (
    <div className="modal-backdrop popover-backdrop" onClick={onClose}>
      <div
        className="modal branch-popover"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t("ask.aria")}
      >
        <h3>{t("ask.title")}</h3>
        <blockquote className="quote-preview">“{quotedText}”</blockquote>
        <textarea
          rows={3}
          value={question}
          onChange={(e) => onQuestionChange(e.target.value)}
          placeholder={t("ask.placeholder")}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
        <p className="hint">{t("ask.hint")}</p>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={loading || !question.trim()}
            onClick={onSubmit}
          >
            {loading ? t("chat.generating") : t("common.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
