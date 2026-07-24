import { useMemo } from "react";
import { useLocale } from "../lib/i18n";
import { resolveSessionModel } from "../lib/sessionModel";
import { useAppStore } from "../store/useAppStore";

/** Compact model id suggestions (matches Settings presets). */
const MODEL_SUGGESTIONS = [
  "gpt-4o-mini",
  "openai/gpt-4o-mini",
  "llama-3.3-70b-versatile",
  "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  "deepseek-ai/DeepSeek-V4-Flash",
  "deepseek-v4-flash",
  "qwen-plus",
  "glm-4-flash",
  "moonshot-v1-8k",
  "doubao-seed-1-6-251015",
  "MiniMax-Text-01",
  "llama3.2",
];

interface Props {
  disabled?: boolean;
}

/** Per-session model control — sits in the composer bar (Cursor-style). */
export function SessionModelPicker({ disabled = false }: Props) {
  const { t } = useLocale();
  const settings = useAppStore((s) => s.settings);
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setSessionModel = useAppStore((s) => s.setSessionModel);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId),
    [sessions, activeSessionId],
  );

  const value = resolveSessionModel(activeSession, settings);
  const listId = "fn-session-model-suggestions";

  const options = useMemo(() => {
    const set = new Set(MODEL_SUGGESTIONS);
    if (value) set.add(value);
    if (settings.model.trim()) set.add(settings.model.trim());
    return [...set];
  }, [value, settings.model]);

  return (
    <label className="fn-session-model">
      <span className="fn-session-model-label-text">{t("composer.model")}</span>
      <input
        className="fn-session-model-input"
        list={listId}
        value={value}
        disabled={disabled || !activeSessionId}
        onChange={(e) => setSessionModel(e.target.value)}
        placeholder={t("composer.modelPlaceholder")}
        title={t("composer.modelTitle")}
        aria-label={t("composer.modelAria")}
        spellCheck={false}
        autoComplete="off"
      />
      <datalist id={listId}>
        {options.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </label>
  );
}
