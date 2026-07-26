import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { handleComposerEnterKey } from "../lib/composerKeys";
import { useLocale } from "../lib/i18n";
import { activeAtQuery, listProjectFileHints } from "../lib/repoContext";

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

export function ChatComposer({
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
}: Props) {
  const { t } = useLocale();
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const resolvedPlaceholder = placeholder ?? t("main.placeholderEmpty");
  const [cursor, setCursor] = useState(0);
  const [hints, setHints] = useState<string[]>([]);
  const [hintIndex, setHintIndex] = useState(0);
  const at = projectRoot ? activeAtQuery(value, cursor) : null;

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
      className={`fn-composer${compact ? " is-compact" : " is-hero"}`}
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
        <textarea
          ref={ref}
          rows={compact ? 1 : 3}
          value={value}
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
        {projectRoot && at && hints.length > 0 ? (
          <ul className="fn-at-menu" role="listbox">
            {hints.map((path, i) => (
              <li key={path}>
                <button
                  type="button"
                  className={`fn-at-option${i === hintIndex ? " is-active" : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyMention(path);
                  }}
                >
                  @{path}
                </button>
              </li>
            ))}
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
}
