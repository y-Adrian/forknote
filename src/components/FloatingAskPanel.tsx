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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
      aria-label="Clarify selection"
      style={{ zIndex }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <h3>Clarify selection</h3>
      <div className="quote-snippet">{quotedText}</div>
      <textarea
        rows={3}
        value={question}
        onChange={(e) => onQuestionChange(e.target.value)}
        placeholder="What’s unclear here? e.g. What does this sentence mean?"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
      <p className="hint">Keep it short, few new concepts · Enter to submit · Shift+Enter for new line</p>
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
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
          {loading ? "Generating…" : "Submit"}
        </button>
      </div>
    </div>
  );
}
