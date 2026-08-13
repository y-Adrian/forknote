import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "../lib/i18n";
import {
  hasSessionApiOverride,
  overridesFromDraft,
  resolveSessionApi,
  truncateModelLabel,
  type ApiConnectionFields as ConnectionDraft,
} from "../lib/sessionApi";
import { useAppStore } from "../store/useAppStore";
import { ApiConnectionFields } from "./ApiConnectionFields";

interface Props {
  disabled?: boolean;
}

/** Composer control: open Session API settings (per-note overrides). */
export function SessionApiSettings({ disabled = false }: Props) {
  const { t } = useLocale();
  const settings = useAppStore((s) => s.settings);
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setSessionApi = useAppStore((s) => s.setSessionApi);
  const clearSessionApi = useAppStore((s) => s.clearSessionApi);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ConnectionDraft>(() =>
    resolveSessionApi(undefined, settings),
  );

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId),
    [sessions, activeSessionId],
  );

  const effective = resolveSessionApi(activeSession, settings);
  const customized = hasSessionApiOverride(activeSession);
  const modelLabel = truncateModelLabel(effective.model) || t("sessionApi.noModel");

  useEffect(() => {
    if (open) {
      setDraft(resolveSessionApi(activeSession, settings));
    }
  }, [open, activeSession, settings]);

  const onSave = () => {
    if (!activeSessionId) return;
    const overrides = overridesFromDraft(draft, settings);
    setSessionApi(overrides);
    setOpen(false);
  };

  const onReset = () => {
    if (!activeSessionId) return;
    clearSessionApi();
    setDraft(resolveSessionApi(undefined, settings));
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        className={`fn-session-api-btn${customized ? " is-custom" : ""}`}
        disabled={disabled || !activeSessionId}
        onClick={() => setOpen(true)}
        title={
          customized
            ? t("sessionApi.buttonTitleCustom")
            : t("sessionApi.buttonTitleDefault")
        }
        aria-label={t("sessionApi.buttonAria")}
      >
        <span className="fn-session-api-label">{t("sessionApi.button")}</span>
        <span className="fn-session-api-model">{modelLabel}</span>
      </button>

      {open
        ? createPortal(
            <div className="modal-backdrop" onClick={() => setOpen(false)}>
              <div
                className="modal settings-modal fn-session-api-modal"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-labelledby="session-api-title"
              >
                <header className="ss-header">
                  <h2 id="session-api-title">{t("sessionApi.title")}</h2>
                  <button
                    type="button"
                    className="ss-close"
                    onClick={() => setOpen(false)}
                    aria-label={t("common.close")}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden
                    >
                      <path
                        d="M6 6l12 12M18 6L6 18"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </header>

                <div className="ss-panel fn-session-api-panel">
                  <p className="ss-panel-lead">{t("sessionApi.lead")}</p>
                  {customized ? (
                    <p className="hint local-hint">{t("sessionApi.customHint")}</p>
                  ) : (
                    <p className="hint local-hint">{t("sessionApi.inheritHint")}</p>
                  )}

                  <ApiConnectionFields
                    value={draft}
                    onChange={setDraft}
                    variant="session"
                  />

                  <div className="modal-actions fn-session-api-actions">
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={onReset}
                      disabled={!customized}
                    >
                      {t("sessionApi.reset")}
                    </button>
                    <div className="fn-session-api-actions-end">
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => setOpen(false)}
                      >
                        {t("common.cancel")}
                      </button>
                      <button
                        type="button"
                        className="btn primary"
                        onClick={onSave}
                      >
                        {t("common.save")}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
