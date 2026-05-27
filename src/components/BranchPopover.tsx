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
        aria-label="分支追问"
      >
        <h3>针对选中内容追问</h3>
        <blockquote className="quote-preview">「{quotedText}」</blockquote>
        <textarea
          rows={3}
          value={question}
          onChange={(e) => onQuestionChange(e.target.value)}
          placeholder="输入你的疑问…"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
        <p className="hint">⌘/Ctrl + Enter 提交</p>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={loading || !question.trim()}
            onClick={onSubmit}
          >
            {loading ? "生成中…" : "提交"}
          </button>
        </div>
      </div>
    </div>
  );
}
