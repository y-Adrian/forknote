import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  selectionRangeForCaret,
  type ComposerCaret,
} from "../lib/composerFocus";
import {
  clampComposerHeight,
  composerHeightMin,
  readStoredComposerHeight,
  resolveComposerHeight,
  writeStoredComposerHeight,
} from "../lib/composerHeight";
import { handleComposerEnterKey } from "../lib/composerKeys";
import { useLocale } from "../lib/i18n";
import { activeAtQuery, listProjectFileHints } from "../lib/repoFileHints";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  loading?: boolean;
  placeholder?: string;
  compact?: boolean;
  leading?: ReactNode;
  projectRoot?: string | null;
  sidecarUrl?: string;
  includedFiles?: string[];
  onIncludeFile?: (path: string) => void;
  onRemoveInclude?: (path: string) => void;
}

export type ChatComposerHandle = {
  /** Focus the textarea and place the caret at start or end of the current value. */
  focus: (opts?: { caret?: ComposerCaret }) => void;
};

export const ChatComposer = forwardRef<ChatComposerHandle, Props>(
  function ChatComposer(
    {
      value,
      onChange,
      onSubmit,
      onStop,
      loading = false,
      placeholder,
      compact = false,
      leading,
      projectRoot = null,
      sidecarUrl = "/sidecar",
      includedFiles = [],
      onIncludeFile,
      onRemoveInclude,
    },
    forwardedRef,
  ) {
  const { t } = useLocale();
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const resizeDragRef = useRef<{
    pointerId: number;
    startY: number;
    originHeight: number;
  } | null>(null);
  const floorHeightRef = useRef<number | null>(null);
  const resizingRef = useRef(false);
  const listboxId = useId();
  const optionIdPrefix = useId();
  const resolvedPlaceholder = placeholder ?? t("main.placeholderEmpty");
  const [cursor, setCursor] = useState(0);
  const [hints, setHints] = useState<string[]>([]);
  const [hintIndex, setHintIndex] = useState(0);
  const [floorHeight, setFloorHeight] = useState<number | null>(() =>
    readStoredComposerHeight(),
  );
  const [isResizing, setIsResizing] = useState(false);
  const at = projectRoot ? activeAtQuery(value, cursor) : null;
  const mentionOpen = Boolean(projectRoot && at && hints.length > 0);
  const activeOptionId = mentionOpen
    ? `${optionIdPrefix}-opt-${hintIndex}`
    : undefined;

  floorHeightRef.current = floorHeight;

  const applyTextareaHeight = useCallback(() => {
    if (resizingRef.current) return;
    const el = ref.current;
    if (!el) return;
    // Measure natural content height without fighting the previous inline size.
    el.style.height = "0px";
    const contentHeight = el.scrollHeight;
    const next = resolveComposerHeight({
      contentHeight,
      floorHeight: floorHeightRef.current,
      compact,
    });
    el.style.height = `${next}px`;
  }, [compact]);

  useLayoutEffect(() => {
    applyTextareaHeight();
  }, [applyTextareaHeight, value, floorHeight, compact]);

  useEffect(() => {
    const onResize = () => applyTextareaHeight();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [applyTextareaHeight]);

  useImperativeHandle(forwardedRef, () => ({
    focus: (opts) => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      const range = selectionRangeForCaret(el.value.length, opts?.caret ?? "end");
      el.setSelectionRange(range.start, range.end);
      setCursor(range.start);
    },
  }));

  const endResizeDrag = useCallback((pointerId: number, target: Element) => {
    const drag = resizeDragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    resizeDragRef.current = null;
    resizingRef.current = false;
    setIsResizing(false);
    const el = ref.current;
    if (el) {
      const clamped = clampComposerHeight(el.offsetHeight, compact);
      floorHeightRef.current = clamped;
      setFloorHeight(clamped);
      writeStoredComposerHeight(clamped);
      el.style.height = `${clamped}px`;
    }
    try {
      (target as HTMLElement).releasePointerCapture(pointerId);
    } catch {
      /* already released */
    }
  }, [compact]);

  const onResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = ref.current;
    if (!el) return;
    const originHeight =
      el.offsetHeight || composerHeightMin(compact);
    resizeDragRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      originHeight,
    };
    resizingRef.current = true;
    setIsResizing(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onResizePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = resizeDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const el = ref.current;
    if (!el) return;
    // Handle sits on the top edge: drag up → taller.
    const next = clampComposerHeight(
      drag.originHeight + (drag.startY - e.clientY),
      compact,
    );
    el.style.height = `${next}px`;
    floorHeightRef.current = next;
  };

  const onResizePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    endResizeDrag(e.pointerId, e.currentTarget);
  };

  useEffect(() => {
    if (!projectRoot || !at) {
      setHints([]);
      return;
    }
    let cancelled = false;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      void listProjectFileHints({
        sidecarUrl,
        projectRoot,
        query: at.query,
        signal: ctrl.signal,
      }).then((paths) => {
        if (!cancelled) {
          setHints(paths);
          setHintIndex(0);
        }
      });
    }, 120);
    return () => {
      cancelled = true;
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [projectRoot, sidecarUrl, at?.query, at?.start, Boolean(at)]);

  const applyMention = useCallback(
    (path: string) => {
      if (!at) return;
      const before = value.slice(0, at.start);
      const after = value.slice(cursor);
      const next = `${before}@${path} ${after.replace(/^\s*/, "")}`;
      onChange(next);
      onIncludeFile?.(path);
      setHints([]);
      requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        const pos = before.length + path.length + 2;
        el.focus();
        el.setSelectionRange(pos, pos);
        setCursor(pos);
      });
    },
    [at, value, cursor, onChange, onIncludeFile],
  );

  const trySubmit = () => {
    if (loading || composingRef.current || !value.trim()) return;
    onSubmit();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (hints.length > 0 && at) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHintIndex((i) => (i + 1) % hints.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHintIndex((i) => (i - 1 + hints.length) % hints.length);
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        setHintIndex(0);
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        setHintIndex(hints.length - 1);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applyMention(hints[hintIndex] ?? hints[0]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setHints([]);
        return;
      }
    }
    handleComposerEnterKey(e, {
      composing: composingRef.current,
      canSubmit: !loading && Boolean(value.trim()),
      onSubmit: trySubmit,
    });
  };

  return (
    <form
      className={`fn-composer${compact ? " is-compact" : " is-hero"}${isResizing ? " is-resizing" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        trySubmit();
      }}
    >
      {projectRoot && includedFiles.length > 0 ? (
        <div
          className="fn-composer-includes"
          aria-label={t("composer.includesAria")}
        >
          {includedFiles.map((path) => (
            <span key={path} className="fn-include-chip">
              <span className="fn-include-chip-path">@{path}</span>
              <button
                type="button"
                className="fn-include-chip-x"
                aria-label={t("composer.removeInclude", { path })}
                onClick={() => onRemoveInclude?.(path)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="fn-composer-input-wrap">
        <div
          className="fn-composer-resize"
          role="separator"
          aria-orientation="horizontal"
          aria-label={t("composer.resizeAria")}
          title={t("composer.resizeAria")}
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
        />
        <textarea
          ref={ref}
          rows={compact ? 1 : 3}
          value={value}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={mentionOpen}
          aria-controls={mentionOpen ? listboxId : undefined}
          aria-activedescendant={activeOptionId}
          aria-haspopup="listbox"
          onChange={(e) => {
            onChange(e.target.value);
            setCursor(e.target.selectionStart);
          }}
          onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
          onClick={(e) => setCursor(e.currentTarget.selectionStart)}
          onKeyUp={(e) => setCursor(e.currentTarget.selectionStart)}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onKeyDown={handleKeyDown}
          placeholder={resolvedPlaceholder}
          aria-label={
            compact ? t("composer.continue") : t("composer.newQuestion")
          }
        />
        {mentionOpen ? (
          <ul
            id={listboxId}
            className="fn-at-menu"
            role="listbox"
            aria-label={t("composer.mentionListAria")}
          >
            {hints.map((path, i) => {
              const selected = i === hintIndex;
              return (
                <li
                  key={path}
                  id={`${optionIdPrefix}-opt-${i}`}
                  role="option"
                  aria-selected={selected}
                  className={`fn-at-option${selected ? " is-active" : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyMention(path);
                  }}
                >
                  @{path}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      <div className="fn-composer-bar">
        <div className="fn-composer-meta">
          {leading}
          <p className="fn-composer-hint">
            {projectRoot
              ? compact
                ? t("composer.hintCompactProject")
                : t("composer.hintHeroProject")
              : compact
                ? t("composer.hintCompact")
                : t("composer.hintHero")}
          </p>
        </div>
        <div className="fn-composer-actions">
          {loading ? (
            <button
              type="button"
              className="fn-stop-btn"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onStop?.();
              }}
              aria-label={t("composer.stopAria")}
              title={t("composer.stopAria")}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="currentColor"
                aria-hidden
              >
                <rect x="1" y="1" width="10" height="10" rx="2" />
              </svg>
              <span>{t("common.stop")}</span>
            </button>
          ) : (
            <button
              type="submit"
              className="fn-send-btn"
              disabled={!value.trim() || loading}
              aria-label={t("common.send")}
            >
              <span>{t("common.send")}</span>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
              >
                <path
                  d="M5 12h14M13 6l6 6-6 6"
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
  },
);
