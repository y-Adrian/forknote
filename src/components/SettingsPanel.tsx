import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocale, type Locale } from "../lib/i18n";
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

interface Props {
  settings: ApiSettings;
  open: boolean;
  onClose: () => void;
  onSave: (settings: ApiSettings) => void;
}

type Preset = {
  label: string;
  baseUrl: string;
  model: string;
  hint: string;
  /** Local endpoints clear apiKey; cloud leave existing key. */
  local?: boolean;
};

type PresetGroup = {
  titleKey: "api.group.cloud" | "api.group.china" | "api.group.local";
  presets: Preset[];
};

/**
 * Base URLs are roots before normalizeBaseUrl (appends /v1 unless already /vN).
 * Zhipu / Volcengine already end with /v4 or /v3 — do not add another /v1.
 */
const PRESET_GROUPS: PresetGroup[] = [
  {
    titleKey: "api.group.cloud",
    presets: [
      {
        label: "OpenAI",
        baseUrl: "https://api.openai.com",
        model: "gpt-4o-mini",
        hint: "Create an API key at platform.openai.com",
      },
      {
        label: "OpenRouter",
        baseUrl: "https://openrouter.ai/api",
        model: "openai/gpt-4o-mini",
        hint: "openrouter.ai → /api + /v1; model IDs include provider prefix",
      },
      {
        label: "Groq",
        baseUrl: "https://api.groq.com/openai",
        model: "llama-3.3-70b-versatile",
        hint: "console.groq.com; path is /openai/v1",
      },
      {
        label: "Together",
        baseUrl: "https://api.together.xyz",
        model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        hint: "api.together.xyz; use model IDs from the console",
      },
      {
        label: "Fireworks",
        baseUrl: "https://api.fireworks.ai/inference",
        model: "accounts/fireworks/models/llama-v3p3-70b-instruct",
        hint: "fireworks.ai Inference API (…/inference/v1)",
      },
      {
        label: "SiliconFlow",
        baseUrl: "https://api.siliconflow.cn",
        model: "deepseek-ai/DeepSeek-V3",
        hint: "Create a key at cloud.siliconflow.cn; model IDs include org prefix",
      },
    ],
  },
  {
    titleKey: "api.group.china",
    presets: [
      {
        label: "DeepSeek",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
        hint: "Create an API key at platform.deepseek.com",
      },
      {
        label: "Qwen",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
        model: "qwen-plus",
        hint: "DashScope compatible mode → …/compatible-mode/v1",
      },
      {
        label: "Zhipu GLM",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        model: "glm-4-flash",
        hint: "Already includes /v4 — do not append /v1; get key at open.bigmodel.cn",
      },
      {
        label: "Moonshot",
        baseUrl: "https://api.moonshot.cn",
        model: "moonshot-v1-8k",
        hint: "platform.moonshot.cn; kimi model names also work",
      },
      {
        label: "Doubao / Ark",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        model: "doubao-seed-1-6-251015",
        hint: "Volcengine Ark OpenAI-compatible; Model = console ID or ep- endpoint",
      },
      {
        label: "MiniMax",
        baseUrl: "https://api.minimax.chat",
        model: "MiniMax-Text-01",
        hint: "platform.minimaxi.com; OpenAI-compatible /v1",
      },
    ],
  },
  {
    titleKey: "api.group.local",
    presets: [
      {
        label: "Ollama",
        baseUrl: "http://127.0.0.1:11434",
        model: "llama3.2",
        hint: "ollama serve; Model must match ollama list",
        local: true,
      },
      {
        label: "LM Studio",
        baseUrl: "http://127.0.0.1:1234",
        model: "local-model",
        hint: "LM Studio → Local Server (OpenAI-compatible)",
        local: true,
      },
      {
        label: "llama.cpp",
        baseUrl: "http://127.0.0.1:8080",
        model: "default",
        hint: "llama-server default port; Model = --alias / loaded name",
        local: true,
      },
      {
        label: "Jan",
        baseUrl: "http://127.0.0.1:1337",
        model: "local-model",
        hint: "Jan local API Server (often port 1337)",
        local: true,
      },
      {
        label: "vLLM / other",
        baseUrl: "http://127.0.0.1:8000",
        model: "default",
        hint: "Base URL = service root; Model = name the server expects",
        local: true,
      },
    ],
  },
];

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

const LOCALE_OPTIONS: { value: Locale; labelKey: "general.lang.en" | "general.lang.zh" }[] = [
  { value: "en", labelKey: "general.lang.en" },
  { value: "zh", labelKey: "general.lang.zh" },
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
  const { locale, setLocale, t } = useLocale();

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
        <div
          className="ss-segmented"
          role="group"
          aria-label={t("general.languageAria")}
        >
          {LOCALE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`ss-segment${locale === opt.value ? " is-active" : ""}`}
              onClick={() => setLocale(opt.value)}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </SettingsRow>

      <SettingsRow title={t("general.clarify")} description={t("general.clarifyDesc")}>
        <span className="ss-static-pill ss-static-pill-ok">{t("common.enabled")}</span>
      </SettingsRow>

      <div className="ss-callout">
        <strong>{t("general.noAccount")}</strong>
        <p>{t("general.noAccountBody")}</p>
      </div>
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

  const applyPreset = (preset: Preset) => {
    setDraft({
      ...draft,
      baseUrl: preset.baseUrl,
      model: preset.model,
      useProxy: true,
      ...(preset.local ? { apiKey: "" } : {}),
    });
  };

  return (
    <div className="ss-panel">
      <h3 className="ss-panel-title">{t("api.title")}</h3>
      <p className="ss-panel-lead">{t("api.lead")}</p>

      <div className="preset-groups">
        {PRESET_GROUPS.map((group) => (
          <div key={group.titleKey} className="preset-group">
            <div className="preset-group-title">{t(group.titleKey)}</div>
            <div className="preset-row">
              {group.presets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className="btn ghost sm preset-chip"
                  title={preset.hint}
                  onClick={() => applyPreset(preset)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <label>
        {t("api.baseUrl")}
        <input
          value={draft.baseUrl}
          onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
          placeholder="http://127.0.0.1:11434"
        />
      </label>

      <label>
        {t("api.apiKey")}
        <input
          type="password"
          value={draft.apiKey}
          onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
          placeholder={t("common.optional")}
          autoComplete="off"
        />
      </label>

      <label>
        {t("api.model")}
        <input
          value={draft.model}
          onChange={(e) => setDraft({ ...draft, model: e.target.value })}
          placeholder={t("api.modelPlaceholder")}
        />
      </label>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={draft.useProxy}
          onChange={(e) => setDraft({ ...draft, useProxy: e.target.checked })}
        />
        {t("api.useProxy")}
      </label>

      <p className="hint local-hint">{t("api.hint")}</p>

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

      <hr className="ss-divider" />

      <h4 className="ss-subhead">{t("api.mem0.title")}</h4>
      <p className="ss-panel-lead">{t("api.mem0.lead")}</p>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={Boolean(draft.mem0Enabled)}
          onChange={(e) =>
            setDraft({ ...draft, mem0Enabled: e.target.checked })
          }
        />
        {t("api.mem0.enable")}
      </label>

      <label>
        {t("api.mem0.apiKey")}
        <input
          type="password"
          value={draft.mem0ApiKey ?? ""}
          onChange={(e) => setDraft({ ...draft, mem0ApiKey: e.target.value })}
          placeholder={t("common.optional")}
          autoComplete="off"
          disabled={!draft.mem0Enabled}
        />
      </label>

      <label>
        {t("api.mem0.userId")}
        <input
          value={draft.mem0UserId ?? ""}
          onChange={(e) => setDraft({ ...draft, mem0UserId: e.target.value })}
          placeholder={t("api.mem0.userIdPlaceholder")}
          disabled={!draft.mem0Enabled}
        />
      </label>

      <label>
        {t("api.mem0.host")}
        <input
          value={draft.mem0Host ?? ""}
          onChange={(e) => setDraft({ ...draft, mem0Host: e.target.value })}
          placeholder="https://api.mem0.ai"
          disabled={!draft.mem0Enabled}
        />
      </label>

      <p className="hint local-hint">{t("api.mem0.privacy")}</p>

      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            saveSettings(draft);
            onSave(draft);
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
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const prefs = loadProjectPrefs();
    setUrlDraft(sidecarUrl || prefs.sidecarUrl || "/sidecar");
    setRoundsDraft(settings.agentMaxRounds ?? DEFAULT_AGENT_MAX_ROUNDS);
    setSaved(false);
  }, [sidecarUrl, settings.agentMaxRounds]);

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
