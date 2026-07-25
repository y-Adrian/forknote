import { useEffect, useRef } from "react";
import { handleComposerEnterKey } from "../lib/composerKeys";
import { useLocale } from "../lib/i18n";
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
  const { t } = useLocale();

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
      aria-label={t("clarify.aria")}
      style={{ zIndex }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <h3
        className="float-panel-drag-handle"
        onPointerDown={onDragHandlePointerDown}
        title={t("common.dragToMove")}
      >
        {t("clarify.title")}
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
        placeholder={t("clarify.placeholder")}
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
      <p className="hint">{t("clarify.hint")}</p>
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          {t("common.cancel")}
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
            {t("common.stop")}
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
            {t("common.submit")}
          </button>
        )}
      </div>
    </div>
  );
}
