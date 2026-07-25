import { useEffect, useRef } from "react";
import { handleComposerEnterKey } from "../lib/composerKeys";
import { getLocale } from "../lib/i18n";
import { useDraggableFloat } from "../lib/useDraggableFloat";
import { useAppStore } from "../store/useAppStore";

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
  const composingRef = useRef(false);
  const stopGeneration = useAppStore((s) => s.stopGeneration);
  const locale = getLocale();
  const hint =
    locale === "zh"
      ? "绑定项目后可用与主对话相同的工具 · Enter 发送 · Shift+Enter 换行 · 拖标题移动"
      : "Same tools as main when a project is bound · Enter to send · Shift+Enter for new line · Drag title to move";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { onDragHandlePointerDown } = useDraggableFloat(panelRef, {
    anchorRect,
    preferBelow: true,
    depth: 0,
    zIndex,
    layoutToken: loading ? "1" : "0",
    resetKey: `${quotedText.slice(0, 40)}:${zIndex}`,
  });

  return (
    <div
      ref={panelRef}
      className="float-panel float-panel-ask float-panel-enter"
      role="dialog"
      aria-label="Clarify selection"
      style={{ zIndex }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <h3
        className="float-panel-drag-handle"
        onPointerDown={onDragHandlePointerDown}
        title={locale === "zh" ? "拖动移动" : "Drag to move"}
      >
        {locale === "zh" ? "选中澄清" : "Clarify selection"}
      </h3>
      <div className="quote-snippet">{quotedText}</div>
      <textarea
        rows={3}
        value={question}
        onChange={(e) => onQuestionChange(e.target.value)}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
        }}
        placeholder={
          locale === "zh"
            ? "哪里不清楚？例如：这句话是什么意思？"
            : "What’s unclear here? e.g. What does this sentence mean?"
        }
        autoFocus
        disabled={loading}
        onKeyDown={(e) => {
          handleComposerEnterKey(e, {
            composing: composingRef.current,
            canSubmit: !loading && Boolean(question.trim()),
            onSubmit,
          });
        }}
      />
      <p className="hint">{hint}</p>
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          {locale === "zh" ? "取消" : "Cancel"}
        </button>
        {loading ? (
          <button
            type="button"
            className="btn danger"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              stopGeneration();
            }}
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="btn primary"
            disabled={!question.trim()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              onSubmit();
            }}
          >
            {locale === "zh" ? "提交" : "Submit"}
          </button>
        )}
      </div>
    </div>
  );
}
