import { useEffect, useRef } from "react";
import { positionFloatingPanel } from "../lib/floatPosition";

interface Props {
  quotedText: string;
  question: string;
  loading: boolean;
  anchorRect: DOMRect;
  zIndex: number;
  onQuestionChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export function FloatingAskPanel({
  quotedText,
  question,
  loading,
  anchorRect,
  zIndex,
  onQuestionChange,
  onSubmit,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    panel.style.zIndex = String(zIndex);
    const place = () => positionFloatingPanel(panel, anchorRect, true, 0, zIndex);
    place();

    const ro = new ResizeObserver(place);
    ro.observe(panel);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRect, question, loading, zIndex]);

  return (
    <div
      ref={panelRef}
      className="float-panel float-panel-ask"
      role="dialog"
      aria-label="针对选中内容追问"
      style={{ zIndex }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <h3>针对选中内容追问</h3>
      <div className="quote-snippet">{quotedText}</div>
      <textarea
        rows={3}
        value={question}
        onChange={(e) => onQuestionChange(e.target.value)}
        placeholder="输入你的疑问…"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
      <p className="hint">Enter 提交 · Shift+Enter 换行</p>
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={loading || !question.trim()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            onSubmit();
          }}
        >
          {loading ? "生成中…" : "提交"}
        </button>
      </div>
    </div>
  );
}
