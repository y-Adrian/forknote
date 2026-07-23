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
  return (
    <div className="modal-backdrop popover-backdrop" onClick={onClose}>
      <div
        className="modal branch-popover"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Ask about selection"
      >
        <h3>Ask about selection</h3>
        <blockquote className="quote-preview">“{quotedText}”</blockquote>
        <textarea
          rows={3}
          value={question}
          onChange={(e) => onQuestionChange(e.target.value)}
          placeholder="Enter your question…"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
        <p className="hint">⌘/Ctrl + Enter to submit</p>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={loading || !question.trim()}
            onClick={onSubmit}
          >
            {loading ? "Generating…" : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}
