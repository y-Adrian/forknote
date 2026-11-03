import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { applyLocale, useLocale, type Locale } from "../lib/i18n";
import { loadProjectPrefs, saveProjectPrefs } from "../lib/project";
import {
  DEFAULT_AGENT_MAX_ROUNDS,
  DEFAULT_JEV_MIN_CONFIDENCE,
  DEFAULT_CONTEXT_WINDOW_TURNS,
  MAX_AGENT_MAX_ROUNDS,
  MAX_CONTEXT_WINDOW_TURNS,
  MIN_AGENT_MAX_ROUNDS,
  MIN_CONTEXT_WINDOW_TURNS,
  apiSettingsEqual,
  normalizeApiSettings,
  saveSettings,
} from "../lib/settings";
import {
  captureSessionImportBackup,
  exportSessionStoreJson,
  LOCAL_STORAGE_KEYS,
  parseSessionStoreImport,
  summarizeSessionStoreImport,
  type SessionImportSummary,
} from "../lib/storage";
import { useTheme, type ThemePreference } from "../lib/theme";
import {
  listLocalFontFamilies,
  uiFontPreferenceEquals,
  useUiFont,
  type UiFontPreference,
} from "../lib/uiFont";
import { useAppStore } from "../store/useAppStore";
import type { ApiSettings, SettingsTab } from "../types";
import { AccessibleModal } from "./AccessibleModal";
import { ApiConnectionFields } from "./ApiConnectionFields";

interface Props {
  settings: ApiSettings;
  open: boolean;
  onClose: () => void;
  onSave: (settings: ApiSettings) => void;
}

const MemorySettingsPanel = lazy(() =>
  import("./MemoryPanel").then((mod) => ({
    default: mod.MemorySettingsPanel,
  })),
);

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
  memory: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 7h12v10H6z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M9 12h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  about: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 11v6M12 8h.01" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
};

const NAV_TABS: SettingsTab[] = ["general", "api", "memory", "data", "project", "about"];

const NAV_LABEL_KEYS = {
  general: "settings.nav.general",
  api: "settings.nav.api",
  memory: "settings.nav.memory",
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

function downloadJson(json: string, filename: string): void {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function GeneralPanel({
  draft,
  setDraft,
  onSave,
}: {
  draft: ApiSettings;
  setDraft: (next: ApiSettings) => void;
  onSave: (settings: ApiSettings) => void;
}) {
  const { preference, setThemePreference } = useTheme();
  const { preference: uiFont, setUiFontPreference } = useUiFont();
  const { locale, t } = useLocale();
  const [pendingLocale, setPendingLocale] = useState<Locale | null>(null);
  const [fontFamilies, setFontFamilies] = useState<string[]>([]);
  const [fontSource, setFontSource] = useState<"local" | "fallback" | null>(
    null,
  );
  const [fontError, setFontError] = useState<string | null>(null);
  const [fontLoading, setFontLoading] = useState(false);
  const [fontFilter, setFontFilter] = useState("");

  const plantumlMode = draft.plantumlRenderMode ?? "off";
  const plantumlServerUrl =
    draft.plantumlServerUrl ?? "https://kroki.io";
  const plantumlLocalPath = draft.plantumlLocalPath ?? "";
  const plantumlJavaPath = draft.plantumlJavaPath ?? "java";

  const pendingLabel = pendingLocale
    ? (LOCALE_OPTIONS.find((o) => o.value === pendingLocale)?.label ?? "")
    : "";

  const confirmLanguageSwitch = () => {
    if (!pendingLocale || pendingLocale === locale) {
      setPendingLocale(null);
      return;
    }
    applyLocale(pendingLocale);
    setPendingLocale(null);
  };

  const loadInstalledFonts = async () => {
    setFontLoading(true);
    setFontError(null);
    try {
      const result = await listLocalFontFamilies();
      setFontFamilies(result.families);
      setFontSource(result.source);
      if (
        result.error &&
        result.error !== "unsupported" &&
        result.error !== "empty"
      ) {
        setFontError(result.error);
      }
    } finally {
      setFontLoading(false);
    }
  };

  useEffect(() => {
    void loadInstalledFonts();
  }, []);

  const selectValue =
    uiFont.kind === "family" ? `family:${uiFont.family}` : uiFont.kind;

  const filteredFamilies = fontFilter.trim()
    ? fontFamilies.filter((name) =>
        name.toLowerCase().includes(fontFilter.trim().toLowerCase()),
      )
    : fontFamilies;

  const activeFamily = uiFont.kind === "family" ? uiFont.family : null;
  const familiesForSelect =
    activeFamily && !filteredFamilies.includes(activeFamily)
      ? [activeFamily, ...filteredFamilies]
      : filteredFamilies;

  const previewStyle =
    uiFont.kind === "family"
      ? { fontFamily: `"${uiFont.family}", system-ui, sans-serif` }
      : uiFont.kind === "system"
        ? {
            fontFamily:
              'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          }
        : undefined;

  const onFontSelect = (value: string) => {
    let next: UiFontPreference;
    if (value === "default") next = { kind: "default" };
    else if (value === "system") next = { kind: "system" };
    else if (value.startsWith("family:")) {
      next = { kind: "family", family: value.slice("family:".length) };
    } else {
      return;
    }
    if (!uiFontPreferenceEquals(uiFont, next)) {
      setUiFontPreference(next);
    }
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
              aria-pressed={preference === opt.value}
              aria-label={t(opt.labelKey)}
              onClick={() => setThemePreference(opt.value)}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </SettingsRow>

      <SettingsRow title={t("general.font")} description={t("general.fontDesc")}>
        <div className="ss-font-picker">
          <div className="ss-font-picker-row">
            <select
              className="ss-select"
              aria-label={t("general.fontAria")}
              value={selectValue}
              onChange={(e) => onFontSelect(e.target.value)}
            >
              <option value="default">{t("general.font.default")}</option>
              <option value="system">{t("general.font.system")}</option>
              {familiesForSelect.length > 0 ? (
                <optgroup
                  label={
                    fontSource === "local"
                      ? t("general.font.installedGroup")
                      : t("general.font.commonGroup")
                  }
                >
                  {familiesForSelect.map((name) => (
                    <option key={name} value={`family:${name}`}>
                      {name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
            <button
              type="button"
              className="btn ghost sm"
              disabled={fontLoading}
              onClick={() => void loadInstalledFonts()}
            >
              {fontLoading ? t("general.font.loading") : t("general.font.load")}
            </button>
          </div>
          {fontFamilies.length > 12 ? (
            <input
              className="ss-font-filter"
              type="search"
              value={fontFilter}
              onChange={(e) => setFontFilter(e.target.value)}
              placeholder={t("general.font.filter")}
              aria-label={t("general.font.filter")}
            />
          ) : null}
          <p className="ss-font-preview" style={previewStyle}>
            {t("general.font.preview")}
          </p>
          {fontError ? (
            <p className="ss-font-hint">
              {t("general.font.loadError", { error: fontError })}
            </p>
          ) : fontSource === "local" ? (
            <p className="ss-font-hint">{t("general.font.sourceLocal")}</p>
          ) : fontSource === "fallback" ? (
            <p className="ss-font-hint">{t("general.font.sourceFallback")}</p>
          ) : null}
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

      <hr className="ss-divider" />

      <h4 className="ss-subhead">{t("general.plantuml.title")}</h4>
      <p className="ss-panel-lead">{t("general.plantuml.lead")}</p>

      <label>
        {t("general.plantuml.mode")}
        <select
          className="ss-select"
          aria-label={t("general.plantuml.mode")}
          value={plantumlMode}
          onChange={(e) =>
            setDraft({
              ...draft,
              plantumlRenderMode: e.target.value as
                | "off"
                | "server"
                | "local",
            })
          }
        >
          <option value="off">{t("general.plantuml.mode.off")}</option>
          <option value="server">{t("general.plantuml.mode.server")}</option>
          <option value="local">{t("general.plantuml.mode.local")}</option>
        </select>
      </label>
      <p className="ss-panel-lead ss-panel-hint">
        {plantumlMode === "server"
          ? t("general.plantuml.mode.serverHint")
          : plantumlMode === "local"
            ? t("general.plantuml.mode.localHint")
            : t("general.plantuml.mode.offHint")}
      </p>

      {plantumlMode === "server" ? (
        <>
          <label>
            {t("general.plantuml.serverUrl")}
            <input
              value={plantumlServerUrl}
              onChange={(e) =>
                setDraft({ ...draft, plantumlServerUrl: e.target.value })
              }
              placeholder="https://kroki.io"
              spellCheck={false}
            />
          </label>
          <p className="ss-panel-lead ss-panel-hint">
            {t("general.plantuml.serverUrlHint")}
          </p>
        </>
      ) : null}

      {plantumlMode === "local" ? (
        <>
          <label>
            {t("general.plantuml.localPath")}
            <input
              value={plantumlLocalPath}
              onChange={(e) =>
                setDraft({ ...draft, plantumlLocalPath: e.target.value })
              }
              placeholder="/usr/local/bin/plantuml"
              spellCheck={false}
            />
          </label>
          <p className="ss-panel-lead ss-panel-hint">
            {t("general.plantuml.localPathHint")}
          </p>
          <label>
            {t("general.plantuml.javaPath")}
            <input
              value={plantumlJavaPath}
              onChange={(e) =>
                setDraft({ ...draft, plantumlJavaPath: e.target.value })
              }
              placeholder="java"
              spellCheck={false}
            />
          </label>
          <p className="ss-panel-lead ss-panel-hint">
            {t("general.plantuml.javaPathHint")}
          </p>
        </>
      ) : null}

      <div className="modal-actions ss-panel-actions">
        <button
          type="button"
          className="btn primary"
          onClick={() => onSave(draft)}
        >
          {t("general.plantuml.save")}
        </button>
      </div>

      <div className="ss-callout">
        <strong>{t("general.noAccount")}</strong>
        <p>{t("general.noAccountBody")}</p>
      </div>

      {pendingLocale ? (
        <AccessibleModal
          open
          onClose={() => setPendingLocale(null)}
          ariaLabel={t("general.langConfirmAria")}
          className="modal fn-lang-confirm-modal"
          backdropClassName="modal-backdrop fn-lang-confirm-backdrop"
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
        </AccessibleModal>
      ) : null}
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
          checked={
            draft.memoryLayerProject != null
              ? draft.memoryLayerProject !== false
              : draft.contextMemoryEnabled !== false
          }
          onChange={(e) =>
            setDraft({
              ...draft,
              memoryLayerProject: e.target.checked,
              contextMemoryEnabled: e.target.checked,
            })
          }
        />
        {t("api.memoryPack.inject")}
      </label>
      <p className="ss-panel-lead ss-panel-hint">{t("api.memoryPack.layersHint")}</p>

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
      <p className="ss-panel-lead ss-panel-hint">
        {t("api.memoryPack.afterArchiveHint")}
      </p>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={draft.contextAutoSummary !== false}
          onChange={(e) =>
            setDraft({ ...draft, contextAutoSummary: e.target.checked })
          }
        />
        {t("api.memoryPack.autoSummary")}
      </label>
      <p className="ss-panel-lead ss-panel-hint">
        {t("api.memoryPack.autoSummaryHint")}
      </p>

      <label>
        {t("api.memoryPack.windowTurns")}
        <input
          type="number"
          min={MIN_CONTEXT_WINDOW_TURNS}
          max={MAX_CONTEXT_WINDOW_TURNS}
          value={draft.contextWindowTurns ?? DEFAULT_CONTEXT_WINDOW_TURNS}
          onChange={(e) => {
            const n = Number(e.target.value);
            setDraft({
              ...draft,
              contextWindowTurns: Number.isFinite(n)
                ? n
                : DEFAULT_CONTEXT_WINDOW_TURNS,
            });
          }}
        />
      </label>
      <p className="ss-panel-lead ss-panel-hint">
        {t("api.memoryPack.windowTurnsHint")}
      </p>

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
  const [pendingImport, setPendingImport] = useState<{
    store: ReturnType<typeof parseSessionStoreImport>;
    summary: SessionImportSummary;
  } | null>(null);
  const [backupReady, setBackupReady] = useState(false);

  const onExport = () => {
    try {
      const json = exportSessionStoreJson();
      downloadJson(
        json,
        `forknote-sessions-${new Date().toISOString().slice(0, 10)}.json`,
      );
      setStatus(t("data.exported"));
    } catch {
      setStatus(t("data.exportFailed"));
    }
  };

  const onImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const store = parseSessionStoreImport(text);
      setPendingImport({
        store,
        summary: summarizeSessionStoreImport(store, file.name),
      });
      setBackupReady(false);
      setStatus(null);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : t("data.importFailed"));
    }
  };

  const onBackupPendingImport = () => {
    try {
      const backup = captureSessionImportBackup();
      downloadJson(
        backup.json,
        `forknote-sessions-before-import-${new Date().toISOString().slice(0, 10)}.json`,
      );
      setBackupReady(true);
      setStatus(
        backup.stored
          ? t("data.importBackupReady")
          : t("data.importBackupDownloadedOnly"),
      );
    } catch {
      setStatus(t("data.importBackupFailed"));
    }
  };

  const onConfirmImport = () => {
    if (!pendingImport || !backupReady) return;
    try {
      replaceSessionStore(pendingImport.store);
      setStatus(t("data.imported", { count: pendingImport.store.sessions.length }));
      setPendingImport(null);
      setBackupReady(false);
    } catch (e) {
      setStatus(
        e instanceof Error
          ? t("data.importSaveFailed", { error: e.message })
          : t("data.importSaveFailed", { error: t("data.importFailed") }),
      );
    }
  };

  const closePendingImport = () => {
    setPendingImport(null);
    setBackupReady(false);
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

      <div className="ss-callout">
        <strong>{t("data.backupPrivacyTitle")}</strong>
        <p>{t("data.backupPrivacyBody")}</p>
      </div>

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

      {pendingImport ? (
        <AccessibleModal
          open
          onClose={closePendingImport}
          ariaLabel={t("data.importConfirmAria")}
          className="modal fn-import-confirm-modal"
          backdropClassName="modal-backdrop fn-import-confirm-backdrop"
        >
          <h3>{t("data.importConfirmTitle")}</h3>
          <p className="fn-import-confirm-body">
            {t("data.importConfirmBody", {
              importCount: pendingImport.summary.count,
              currentCount: sessions.length,
              title: pendingImport.summary.activeTitle,
              source: pendingImport.summary.source,
            })}
          </p>
          <div className="ss-callout fn-import-backup-callout">
            <strong>{t("data.importBackupTitle")}</strong>
            <p>
              {backupReady
                ? t("data.importBackupReady")
                : t("data.importBackupRequired")}
            </p>
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="btn ghost"
              onClick={closePendingImport}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={onBackupPendingImport}
            >
              {t("data.importBackup")}
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={!backupReady}
              onClick={onConfirmImport}
            >
              {t("data.importConfirm")}
            </button>
          </div>
        </AccessibleModal>
      ) : null}

      <div className="ss-callout">
        <strong>{t("data.alsoStored")}</strong>
        <ul className="ss-key-list">
          <li>
            <code>{LOCAL_STORAGE_KEYS.settings}</code> — {t("data.key.settings")}
          </li>
          <li>
            <code>{LOCAL_STORAGE_KEYS.userPreferences}</code> — {t("data.key.userPreferences")}
          </li>
          <li>
            <code>{LOCAL_STORAGE_KEYS.recentFiles}</code> — {t("data.key.recentFiles")}
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
          <li>
            <code>{LOCAL_STORAGE_KEYS.uiFont}</code> — {t("data.key.uiFont")}
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
  const [autoDiagDraft, setAutoDiagDraft] = useState(
    settings.agentAutoDiagnostics ?? true,
  );
  const [allowRulesDraft, setAllowRulesDraft] = useState(
    (settings.agentCommandAllow ?? []).join("\n"),
  );
  const [denyRulesDraft, setDenyRulesDraft] = useState(
    (settings.agentCommandDeny ?? []).join("\n"),
  );
  const [planModelDraft, setPlanModelDraft] = useState(
    settings.agentPlanModel ?? "",
  );
  const [codeModelDraft, setCodeModelDraft] = useState(
    settings.agentCodeModel ?? "",
  );
  const [summaryModelDraft, setSummaryModelDraft] = useState(
    settings.agentSummaryModel ?? "",
  );
  const [jevEnabledDraft, setJevEnabledDraft] = useState(
    settings.jevReflectEnabled ?? false,
  );
  const [jevProviderDraft, setJevProviderDraft] = useState<"official" | "hosted">(
    settings.jevProvider ?? "official",
  );
  const [jevBaseUrlDraft, setJevBaseUrlDraft] = useState(
    settings.jevBaseUrl ?? "https://api.typesafe.ai",
  );
  const [jevApiKeyDraft, setJevApiKeyDraft] = useState(
    settings.jevApiKey ?? "",
  );
  const [jevModelDraft, setJevModelDraft] = useState(
    settings.jevModel ?? "jev-latest",
  );
  const [jevConfidenceDraft, setJevConfidenceDraft] = useState(
    settings.jevMinConfidence ?? DEFAULT_JEV_MIN_CONFIDENCE,
  );
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const prefs = loadProjectPrefs();
    setUrlDraft(sidecarUrl || prefs.sidecarUrl || "/sidecar");
    setRoundsDraft(settings.agentMaxRounds ?? DEFAULT_AGENT_MAX_ROUNDS);
    setApprovalDraft(settings.agentRequireApproval ?? true);
    setTerminalDraft(settings.agentAllowTerminal ?? true);
    setAutoDiagDraft(settings.agentAutoDiagnostics ?? true);
    setAllowRulesDraft((settings.agentCommandAllow ?? []).join("\n"));
    setDenyRulesDraft((settings.agentCommandDeny ?? []).join("\n"));
    setPlanModelDraft(settings.agentPlanModel ?? "");
    setCodeModelDraft(settings.agentCodeModel ?? "");
    setSummaryModelDraft(settings.agentSummaryModel ?? "");
    setJevEnabledDraft(settings.jevReflectEnabled ?? false);
    setJevProviderDraft(settings.jevProvider ?? "official");
    setJevBaseUrlDraft(settings.jevBaseUrl ?? "https://api.typesafe.ai");
    setJevApiKeyDraft(settings.jevApiKey ?? "");
    setJevModelDraft(settings.jevModel ?? "jev-latest");
    setJevConfidenceDraft(
      settings.jevMinConfidence ?? DEFAULT_JEV_MIN_CONFIDENCE,
    );
    setSaved(false);
  }, [
    sidecarUrl,
    settings.agentMaxRounds,
    settings.agentRequireApproval,
    settings.agentAllowTerminal,
    settings.agentAutoDiagnostics,
    settings.agentCommandAllow,
    settings.agentCommandDeny,
    settings.agentPlanModel,
    settings.agentCodeModel,
    settings.agentSummaryModel,
    settings.jevReflectEnabled,
    settings.jevProvider,
    settings.jevBaseUrl,
    settings.jevApiKey,
    settings.jevModel,
    settings.jevMinConfidence,
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
      agentAutoDiagnostics: autoDiagDraft,
      agentCommandAllow: allowRulesDraft.split("\n"),
      agentCommandDeny: denyRulesDraft.split("\n"),
      agentPlanModel: planModelDraft.trim(),
      agentCodeModel: codeModelDraft.trim(),
      agentSummaryModel: summaryModelDraft.trim(),
      jevReflectEnabled: jevEnabledDraft,
      jevProvider: jevProviderDraft,
      jevBaseUrl: jevBaseUrlDraft.trim(),
      jevApiKey: jevApiKeyDraft.trim(),
      jevModel: jevModelDraft.trim(),
      jevMinConfidence: jevConfidenceDraft,
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

      <label>
        {t("projectSettings.agentCommandAllow")}
        <textarea
          rows={3}
          value={allowRulesDraft}
          onChange={(e) => {
            setAllowRulesDraft(e.target.value);
            setSaved(false);
          }}
          placeholder={"npm test\ngit status"}
          spellCheck={false}
        />
      </label>
      <label>
        {t("projectSettings.agentCommandDeny")}
        <textarea
          rows={3}
          value={denyRulesDraft}
          onChange={(e) => {
            setDenyRulesDraft(e.target.value);
            setSaved(false);
          }}
          placeholder={"git push\nnpm publish"}
          spellCheck={false}
        />
      </label>
      <p className="hint local-hint">
        {t("projectSettings.agentCommandRulesHint")}
      </p>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={autoDiagDraft}
          onChange={(e) => {
            setAutoDiagDraft(e.target.checked);
            setSaved(false);
          }}
        />
        <span>{t("projectSettings.agentAutoDiagnostics")}</span>
      </label>
      <p className="hint local-hint">
        {t("projectSettings.agentAutoDiagnosticsHint")}
      </p>

      <label>
        {t("projectSettings.agentPlanModel")}
        <input
          value={planModelDraft}
          onChange={(e) => {
            setPlanModelDraft(e.target.value);
            setSaved(false);
          }}
          placeholder={t("projectSettings.agentModelPlaceholder")}
          spellCheck={false}
        />
      </label>
      <p className="hint local-hint">{t("projectSettings.agentPlanModelHint")}</p>

      <label>
        {t("projectSettings.agentCodeModel")}
        <input
          value={codeModelDraft}
          onChange={(e) => {
            setCodeModelDraft(e.target.value);
            setSaved(false);
          }}
          placeholder={t("projectSettings.agentModelPlaceholder")}
          spellCheck={false}
        />
      </label>
      <p className="hint local-hint">{t("projectSettings.agentCodeModelHint")}</p>

      <label>
        {t("projectSettings.agentSummaryModel")}
        <input
          value={summaryModelDraft}
          onChange={(e) => {
            setSummaryModelDraft(e.target.value);
            setSaved(false);
          }}
          placeholder={t("projectSettings.agentModelPlaceholder")}
          spellCheck={false}
        />
      </label>
      <p className="hint local-hint">
        {t("projectSettings.agentSummaryModelHint")}
      </p>

      <div className="ss-section-divider" />
      <h4 className="ss-section-title">{t("projectSettings.jevTitle")}</h4>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={jevEnabledDraft}
          onChange={(e) => {
            setJevEnabledDraft(e.target.checked);
            setSaved(false);
          }}
        />
        <span>{t("projectSettings.jevReflectEnabled")}</span>
      </label>
      <p className="hint local-hint">{t("projectSettings.jevReflectHint")}</p>

      <label>
        {t("projectSettings.jevProvider")}
        <select
          value={jevProviderDraft}
          onChange={(e) => {
            const provider = e.target.value as "official" | "hosted";
            setJevProviderDraft(provider);
            setJevBaseUrlDraft(
              provider === "hosted"
                ? "https://jevtypesafeai.com"
                : "https://api.typesafe.ai",
            );
            setSaved(false);
          }}
        >
          <option value="official">{t("projectSettings.jevProviderOfficial")}</option>
          <option value="hosted">{t("projectSettings.jevProviderHosted")}</option>
        </select>
      </label>

      <label>
        {t("projectSettings.jevBaseUrl")}
        <input
          value={jevBaseUrlDraft}
          onChange={(e) => {
            setJevBaseUrlDraft(e.target.value);
            setSaved(false);
          }}
          placeholder="https://api.typesafe.ai"
          spellCheck={false}
        />
      </label>
      <label>
        {t("projectSettings.jevApiKey")}
        <input
          type="password"
          value={jevApiKeyDraft}
          onChange={(e) => {
            setJevApiKeyDraft(e.target.value);
            setSaved(false);
          }}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <label>
        {t("projectSettings.jevModel")}
        <input
          value={jevModelDraft}
          onChange={(e) => {
            setJevModelDraft(e.target.value);
            setSaved(false);
          }}
          placeholder="jev-latest"
          spellCheck={false}
        />
      </label>
      <label>
        {t("projectSettings.jevConfidence")}
        <input
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={jevConfidenceDraft}
          onChange={(e) => {
            setJevConfidenceDraft(Number(e.target.value));
            setSaved(false);
          }}
        />
      </label>
      <p className="hint local-hint">{t("projectSettings.jevPrivacyHint")}</p>

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
  const [discardOpen, setDiscardOpen] = useState(false);
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
      setDiscardOpen(false);
    }
  }, [open, settings]);

  const requestClose = useCallback(() => {
    if (!apiSettingsEqual(draft, settings)) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  }, [draft, settings, onClose]);

  const confirmDiscard = useCallback(() => {
    setDiscardOpen(false);
    setDraft(settings);
    onClose();
  }, [onClose, settings]);

  if (!open) return null;

  return (
    <AccessibleModal
      open={open}
      onClose={requestClose}
      labelledBy="settings-title"
      className="modal settings-modal system-settings-modal"
    >
        <header className="ss-header">
          <h2 id="settings-title">{t("settings.title")}</h2>
          <button
            type="button"
            className="ss-close"
            onClick={requestClose}
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
                aria-label={item.label}
                title={item.label}
                aria-current={settingsTab === item.id ? "page" : undefined}
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
            {settingsTab === "general" && (
              <GeneralPanel
                draft={draft}
                setDraft={setDraft}
                onSave={onSave}
              />
            )}
            {settingsTab === "api" && (
              <ApiPanel
                draft={draft}
                setDraft={setDraft}
                onSave={onSave}
                onClose={requestClose}
              />
            )}
            {settingsTab === "memory" && (
              <Suspense fallback={null}>
                <MemorySettingsPanel draft={draft} setDraft={setDraft} onSave={onSave} />
              </Suspense>
            )}
            {settingsTab === "data" && <DataPanel />}
            {settingsTab === "project" && <ProjectSettingsPanel />}
            {settingsTab === "about" && (
              <AboutPanel page={aboutPage} setPage={setAboutPage} />
            )}
          </div>
        </div>

      {discardOpen ? (
        <AccessibleModal
          open
          onClose={() => setDiscardOpen(false)}
          ariaLabel={t("settings.discardConfirmAria")}
          className="modal fn-lang-confirm-modal"
          backdropClassName="modal-backdrop fn-lang-confirm-backdrop"
        >
          <h3>{t("settings.discardConfirmTitle")}</h3>
          <p className="fn-lang-confirm-body">
            {t("settings.discardConfirmBody")}
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="btn ghost"
              onClick={() => setDiscardOpen(false)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={confirmDiscard}
            >
              {t("common.discard")}
            </button>
          </div>
        </AccessibleModal>
      ) : null}
    </AccessibleModal>
  );
}
