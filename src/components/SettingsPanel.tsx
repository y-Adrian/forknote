import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { applyLocale, useLocale, type Locale } from "../lib/i18n";
import { loadProjectPrefs, saveProjectPrefs } from "../lib/project";
import {
  DEFAULT_AGENT_MAX_ROUNDS,
  MAX_AGENT_MAX_ROUNDS,
  MIN_AGENT_MAX_ROUNDS,
  normalizeApiSettings,
  saveSettings,
} from "../lib/settings";
import {
  exportSessionStoreJson,
  LOCAL_STORAGE_KEYS,
  parseSessionStoreImport,
} from "../lib/storage";
import { useTheme, type ThemePreference } from "../lib/theme";
import { useAppStore } from "../store/useAppStore";
import type { ApiSettings, SettingsTab } from "../types";
import { ApiConnectionFields } from "./ApiConnectionFields";

interface Props {
  settings: ApiSettings;
  open: boolean;
  onClose: () => void;
  onSave: (settings: ApiSettings) => void;
}

const NAV_ICONS: Record<SettingsTab, ReactNode> = {
  general: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 2v2.5M12 19.5V22M4.93 4.93l1.77 1.77M17.3 17.3l1.77 1.77M2 12h2.5M19.5 12H22M4.93 19.07l1.77-1.77M17.3 6.7l1.77-1.77"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  ),
  api: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-3"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M8 9V7a4 4 0 0 1 8 0v2"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="12" cy="14" r="1.2" fill="currentColor" />
    </svg>
  ),
  data: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <ellipse
        cx="12"
        cy="6"
        rx="7"
        ry="3"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M5 6v6c0 1.66 3.13 3 7 3s7-1.34 7-3V6"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M5 12v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6"
        stroke="currentColor"
        strokeWidth="1.7"
      />
    </svg>
  ),
  project: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v7A1.5 1.5 0 0 1 19.5 18h-15A1.5 1.5 0 0 1 3 16.5v-9z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  ),
  about: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 11v6M12 8h.01"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  ),
};

const NAV_TABS: SettingsTab[] = ["general", "api", "data", "project", "about"];

const NAV_LABEL_KEYS = {
  general: "settings.nav.general",
  api: "settings.nav.api",
  data: "settings.nav.data",
  project: "settings.nav.project",
  about: "settings.nav.about",
} as const;

const THEME_OPTIONS: { value: ThemePreference; labelKey: "general.theme.light" | "general.theme.dark" | "general.theme.system" }[] = [
  { value: "light", labelKey: "general.theme.light" },
  { value: "dark", labelKey: "general.theme.dark" },
  { value: "system", labelKey: "general.theme.system" },
];

/** Native language names (standard for locale pickers). */
const LOCALE_OPTIONS: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "zh", label: "中文" },
];

function SettingsRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="ss-row">
      <div className="ss-row-text">
        <div className="ss-row-title">{title}</div>
        {description ? <p className="ss-row-desc">{description}</p> : null}
      </div>
      <div className="ss-row-control">{children}</div>
    </div>
  );
}

function GeneralPanel() {
  const { preference, setThemePreference } = useTheme();
  const { locale, t } = useLocale();
  const [pendingLocale, setPendingLocale] = useState<Locale | null>(null);

  const pendingLabel = pendingLocale
    ? (LOCALE_OPTIONS.find((o) => o.value === pendingLocale)?.label ?? "")
    : "";

  const confirmLanguageSwitch = () => {
    if (!pendingLocale || pendingLocale === locale) {
      setPendingLocale(null);
      return;
    }
    applyLocale(pendingLocale);
    window.location.reload();
  };

  return (
    <div className="ss-panel">
      <h3 className="ss-panel-title">{t("general.title")}</h3>
      <p className="ss-panel-lead">{t("general.lead")}</p>

      <SettingsRow title={t("general.theme")} description={t("general.themeDesc")}>
        <div className="ss-segmented" role="group" aria-label={t("general.themeAria")}>
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`ss-segment${preference === opt.value ? " is-active" : ""}`}
              onClick={() => setThemePreference(opt.value)}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </SettingsRow>

      <SettingsRow
        title={t("general.language")}
        description={t("general.languageDesc")}
      >
        <select
          className="ss-select"
          aria-label={t("general.languageAria")}
          value={pendingLocale ?? locale}
          onChange={(e) => {
            const next = e.target.value as Locale;
            if (next === locale) return;
            setPendingLocale(next);
          }}
        >
          {LOCALE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </SettingsRow>

      <SettingsRow title={t("general.clarify")} description={t("general.clarifyDesc")}>
        <span className="ss-static-pill ss-static-pill-ok">{t("common.enabled")}</span>
      </SettingsRow>

      <div className="ss-callout">
        <strong>{t("general.noAccount")}</strong>
        <p>{t("general.noAccountBody")}</p>
      </div>

      {pendingLocale
        ? createPortal(
            <div
              className="modal-backdrop fn-lang-confirm-backdrop"
              onClick={() => setPendingLocale(null)}
            >
              <div
                className="modal fn-lang-confirm-modal"
                role="dialog"
                aria-modal="true"
                aria-label={t("general.langConfirmAria")}
                onClick={(e) => e.stopPropagation()}
              >
                <h3>{t("general.langConfirmTitle")}</h3>
                <p className="fn-lang-confirm-body">
                  {t("general.langConfirmBody", { lang: pendingLabel })}
                </p>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => setPendingLocale(null)}
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={confirmLanguageSwitch}
                  >
                    {t("common.ok")}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function ApiPanel({
  draft,
  setDraft,
  onSave,
  onClose,
}: {
  draft: ApiSettings;
  setDraft: (next: ApiSettings) => void;
  onSave: (settings: ApiSettings) => void;
  onClose: () => void;
}) {
  const { t } = useLocale();

  return (
    <div className="ss-panel">
      <h3 className="ss-panel-title">{t("api.title")}</h3>
      <p className="ss-panel-lead">{t("api.lead")}</p>

      <div className="ss-callout">
        <strong>{t("api.sessionRemarkTitle")}</strong>
        <p>{t("api.sessionRemark")}</p>
      </div>

      <ApiConnectionFields
        value={{
          baseUrl: draft.baseUrl,
          apiKey: draft.apiKey,
          model: draft.model,
          useProxy: draft.useProxy,
        }}
        onChange={(conn) => setDraft({ ...draft, ...conn })}
        variant="system"
      />

      <hr className="ss-divider" />

      <h4 className="ss-subhead">{t("api.memoryPack.title")}</h4>
      <p className="ss-panel-lead">{t("api.memoryPack.lead")}</p>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={draft.contextMemoryEnabled !== false}
          onChange={(e) =>
            setDraft({ ...draft, contextMemoryEnabled: e.target.checked })
          }
        />
        {t("api.memoryPack.inject")}
      </label>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={Boolean(draft.compressAfterArchive)}
          onChange={(e) =>
            setDraft({ ...draft, compressAfterArchive: e.target.checked })
          }
        />
        {t("api.memoryPack.afterArchive")}
      </label>

      <label>
        {t("api.memoryPack.dir")}
        <input
          value={draft.memoryDir ?? ""}
          onChange={(e) => setDraft({ ...draft, memoryDir: e.target.value })}
          placeholder={t("api.memoryPack.dirPlaceholder")}
        />
      </label>

      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            const next = normalizeApiSettings(draft);
            saveSettings(next);
            onSave(next);
            onClose();
          }}
        >
          {t("common.save")}
        </button>
      </div>
    </div>
  );
}

function DataPanel() {
  const { t } = useLocale();
  const sessions = useAppStore((s) => s.sessions);
  const clearAllSessions = useAppStore((s) => s.clearAllSessions);
  const replaceSessionStore = useAppStore((s) => s.replaceSessionStore);
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  const onExport = () => {
    try {
      const json = exportSessionStoreJson();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `forknote-notes-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus(t("data.exported"));
    } catch {
      setStatus(t("data.exportFailed"));
    }
  };

  const onImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const store = parseSessionStoreImport(text);
      replaceSessionStore(store);
      setStatus(t("data.imported", { count: store.sessions.length }));
    } catch (e) {
      setStatus(e instanceof Error ? e.message : t("data.importFailed"));
    }
  };

  const onClear = () => {
    if (!confirm(t("data.clearConfirm"))) {
      return;
    }
    clearAllSessions();
    setStatus(t("data.cleared"));
  };

  return (
    <div className="ss-panel">
      <h3 className="ss-panel-title">{t("data.title")}</h3>
      <p className="ss-panel-lead">{t("data.lead")}</p>

      <SettingsRow
        title={t("data.notesTitle")}
        description={t("data.notesCount", { count: sessions.length })}
      >
        <span className="ss-static-pill">{LOCAL_STORAGE_KEYS.sessions}</span>
      </SettingsRow>

      <div className="ss-action-stack">
        <button type="button" className="btn ghost ss-action-btn" onClick={onExport}>
          {t("data.export")}
        </button>
        <button
          type="button"
          className="btn ghost ss-action-btn"
          onClick={() => fileRef.current?.click()}
        >
          {t("data.import")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void onImportFile(file);
          }}
        />
        <button type="button" className="btn danger ss-action-btn" onClick={onClear}>
          {t("data.clear")}
        </button>
      </div>

      {status ? <p className="ss-status">{status}</p> : null}

      <div className="ss-callout">
        <strong>{t("data.alsoStored")}</strong>
        <ul className="ss-key-list">
          <li>
            <code>{LOCAL_STORAGE_KEYS.settings}</code> — {t("data.key.settings")}
          </li>
          <li>
            <code>{LOCAL_STORAGE_KEYS.project}</code> — {t("data.key.project")}
          </li>
          <li>
            <code>{LOCAL_STORAGE_KEYS.theme}</code> — {t("data.key.theme")}
          </li>
          <li>
            <code>{LOCAL_STORAGE_KEYS.locale}</code> — {t("data.key.locale")}
          </li>
        </ul>
      </div>
    </div>
  );
}

function ProjectSettingsPanel() {
  const { t } = useLocale();
  const sidecarUrl = useAppStore((s) => s.sidecarUrl);
  const projectRoot = useAppStore((s) => s.projectRoot);
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const setSidecarUrl = useAppStore((s) => s.setSidecarUrl);
  const setProjectOpen = useAppStore((s) => s.setProjectOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);

  const [urlDraft, setUrlDraft] = useState(sidecarUrl);
  const [roundsDraft, setRoundsDraft] = useState(
    settings.agentMaxRounds ?? DEFAULT_AGENT_MAX_ROUNDS,
  );
  const [approvalDraft, setApprovalDraft] = useState(
    settings.agentRequireApproval ?? true,
  );
  const [terminalDraft, setTerminalDraft] = useState(
    settings.agentAllowTerminal ?? true,
  );
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const prefs = loadProjectPrefs();
    setUrlDraft(sidecarUrl || prefs.sidecarUrl || "/sidecar");
    setRoundsDraft(settings.agentMaxRounds ?? DEFAULT_AGENT_MAX_ROUNDS);
    setApprovalDraft(settings.agentRequireApproval ?? true);
    setTerminalDraft(settings.agentAllowTerminal ?? true);
    setSaved(false);
  }, [
    sidecarUrl,
    settings.agentMaxRounds,
    settings.agentRequireApproval,
    settings.agentAllowTerminal,
  ]);

  const save = () => {
    const next = urlDraft.trim() || "/sidecar";
    setSidecarUrl(next);
    saveProjectPrefs({ sidecarUrl: next });
    const clamped = Math.min(
      MAX_AGENT_MAX_ROUNDS,
      Math.max(
        MIN_AGENT_MAX_ROUNDS,
        Math.round(Number(roundsDraft) || DEFAULT_AGENT_MAX_ROUNDS),
      ),
    );
    const nextSettings = normalizeApiSettings({
      ...settings,
      agentMaxRounds: clamped,
      agentRequireApproval: approvalDraft,
      agentAllowTerminal: terminalDraft,
    });
    saveSettings(nextSettings);
    setSettings(nextSettings);
    setRoundsDraft(nextSettings.agentMaxRounds ?? DEFAULT_AGENT_MAX_ROUNDS);
    setSaved(true);
  };

  return (
    <div className="ss-panel">
      <h3 className="ss-panel-title">{t("projectSettings.title")}</h3>
      <p className="ss-panel-lead">{t("projectSettings.lead")}</p>
      <p className="hint local-hint">{t("projectSettings.sessionHint")}</p>

      <label>
        {t("projectSettings.sidecarUrl")}
        <input
          value={urlDraft}
          onChange={(e) => {
            setUrlDraft(e.target.value);
            setSaved(false);
          }}
          placeholder="/sidecar"
          spellCheck={false}
        />
      </label>

      <label>
        {t("projectSettings.agentMaxRounds")}
        <input
          type="number"
          min={MIN_AGENT_MAX_ROUNDS}
          max={MAX_AGENT_MAX_ROUNDS}
          step={1}
          value={roundsDraft}
          onChange={(e) => {
            setRoundsDraft(Number(e.target.value));
            setSaved(false);
          }}
        />
      </label>
      <p className="hint local-hint">{t("projectSettings.agentMaxRoundsHint")}</p>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={approvalDraft}
          onChange={(e) => {
            setApprovalDraft(e.target.checked);
            setSaved(false);
          }}
        />
        <span>{t("projectSettings.agentRequireApproval")}</span>
      </label>
      <p className="hint local-hint">
        {t("projectSettings.agentRequireApprovalHint")}
      </p>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={terminalDraft}
          onChange={(e) => {
            setTerminalDraft(e.target.checked);
            setSaved(false);
          }}
        />
        <span>{t("projectSettings.agentAllowTerminal")}</span>
      </label>
      <p className="hint local-hint">
        {t("projectSettings.agentAllowTerminalHint")}
      </p>

      {projectRoot ? (
        <p className="project-connected-hint">
          {t("projectSettings.connected")} <code>{projectRoot}</code>
        </p>
      ) : (
        <p className="hint">{t("projectSettings.none")}</p>
      )}

      <div className="modal-actions">
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            setSettingsOpen(false);
            setProjectOpen(true);
          }}
        >
          {t("projectSettings.open")}
        </button>
        <button type="button" className="btn primary" onClick={save}>
          {saved ? t("common.saved") : t("common.save")}
        </button>
      </div>
    </div>
  );
}

function AboutPanel({
  page,
  setPage,
}: {
  page: "main" | "terms" | "privacy";
  setPage: (p: "main" | "terms" | "privacy") => void;
}) {
  const { t } = useLocale();

  if (page === "terms") {
    return (
      <div className="ss-panel">
        <button
          type="button"
          className="ss-back"
          onClick={() => setPage("main")}
        >
          {t("about.back")}
        </button>
        <h3 className="ss-panel-title">{t("about.terms")}</h3>
        <div className="ss-legal">
          <p>{t("about.termsBody1")}</p>
          <p>{t("about.termsBody2")}</p>
        </div>
      </div>
    );
  }

  if (page === "privacy") {
    return (
      <div className="ss-panel">
        <button
          type="button"
          className="ss-back"
          onClick={() => setPage("main")}
        >
          {t("about.back")}
        </button>
        <h3 className="ss-panel-title">{t("about.privacy")}</h3>
        <div className="ss-legal">
          <p>{t("about.privacyBody1")}</p>
          <p>{t("about.privacyBody2")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ss-panel">
      <h3 className="ss-panel-title">{t("about.title")}</h3>
      <div className="ss-about-brand">
        <div className="ss-about-name">ForkNote</div>
        <p className="ss-about-tag">{t("about.tag")}</p>
      </div>
      <p className="ss-panel-lead">{t("about.lead")}</p>
      <div className="ss-link-row">
        <button
          type="button"
          className="ss-text-link"
          onClick={() => setPage("terms")}
        >
          {t("about.terms")}
        </button>
        <span className="ss-dot" aria-hidden>
          ·
        </span>
        <button
          type="button"
          className="ss-text-link"
          onClick={() => setPage("privacy")}
        >
          {t("about.privacy")}
        </button>
      </div>
      <p className="hint">{t("about.version")}</p>
    </div>
  );
}

export function SettingsPanel({ settings, open, onClose, onSave }: Props) {
  const { t } = useLocale();
  const settingsTab = useAppStore((s) => s.settingsTab);
  const setSettingsTab = useAppStore((s) => s.setSettingsTab);
  const [draft, setDraft] = useState(settings);
  const [aboutPage, setAboutPage] = useState<"main" | "terms" | "privacy">(
    "main",
  );

  const navItems = useMemo(
    () =>
      NAV_TABS.map((id) => ({
        id,
        label: t(NAV_LABEL_KEYS[id]),
        icon: NAV_ICONS[id],
      })),
    [t],
  );

  useEffect(() => {
    if (open) {
      setDraft(settings);
      setAboutPage("main");
    }
  }, [open, settings]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal settings-modal system-settings-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="settings-title"
      >
        <header className="ss-header">
          <h2 id="settings-title">{t("settings.title")}</h2>
          <button
            type="button"
            className="ss-close"
            onClick={onClose}
            aria-label={t("settings.closeAria")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="ss-body">
          <nav className="ss-nav" aria-label={t("settings.navAria")}>
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`ss-nav-item${settingsTab === item.id ? " is-active" : ""}`}
                onClick={() => {
                  setSettingsTab(item.id);
                  setAboutPage("main");
                }}
              >
                <span className="ss-nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          <div className="ss-content">
            {settingsTab === "general" && <GeneralPanel />}
            {settingsTab === "api" && (
              <ApiPanel
                draft={draft}
                setDraft={setDraft}
                onSave={onSave}
                onClose={onClose}
              />
            )}
            {settingsTab === "data" && <DataPanel />}
            {settingsTab === "project" && <ProjectSettingsPanel />}
            {settingsTab === "about" && (
              <AboutPanel page={aboutPage} setPage={setAboutPage} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
