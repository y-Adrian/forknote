import type { ApiConnectionFields as ConnectionDraft } from "../lib/sessionApi";
import { useLocale } from "../lib/i18n";

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
export const PRESET_GROUPS: PresetGroup[] = [
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
        model: "deepseek-ai/DeepSeek-V4-Flash",
        hint: "cloud.siliconflow.cn — model IDs use org prefix (e.g. deepseek-ai/DeepSeek-V4-Flash)",
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
        hint: "platform.deepseek.com — deepseek-v4-flash (default) or deepseek-v4-pro; legacy deepseek-chat still works",
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
        model: "qwen2.5-coder:7b",
        hint: "ollama serve; Model must match ollama list (e.g. qwen2.5-coder:7b)",
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

interface Props {
  value: ConnectionDraft;
  onChange: (next: ConnectionDraft) => void;
  /** system = Settings defaults copy; session = this-note labels */
  variant?: "system" | "session";
}

/** Shared Base URL / Key / Model / proxy fields (+ provider presets). */
export function ApiConnectionFields({
  value,
  onChange,
  variant = "system",
}: Props) {
  const { t } = useLocale();
  const modelLabel =
    variant === "session" ? t("sessionApi.model") : t("api.model");
  const modelHint =
    variant === "session" ? t("sessionApi.modelHint") : t("api.modelHint");

  const applyPreset = (preset: Preset) => {
    onChange({
      ...value,
      baseUrl: preset.baseUrl,
      model: preset.model,
      useProxy: true,
      ...(preset.local ? { apiKey: "" } : {}),
    });
  };

  return (
    <>
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
          value={value.baseUrl}
          onChange={(e) => onChange({ ...value, baseUrl: e.target.value })}
          placeholder="http://127.0.0.1:11434"
        />
      </label>

      <label>
        {t("api.apiKey")}
        <input
          type="password"
          value={value.apiKey}
          onChange={(e) => onChange({ ...value, apiKey: e.target.value })}
          placeholder={t("common.optional")}
          autoComplete="off"
        />
      </label>

      <label>
        {modelLabel}
        <input
          value={value.model}
          onChange={(e) => onChange({ ...value, model: e.target.value })}
          placeholder={t("api.modelPlaceholder")}
        />
      </label>
      <p className="hint local-hint">{modelHint}</p>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={value.useProxy}
          onChange={(e) =>
            onChange({ ...value, useProxy: e.target.checked })
          }
        />
        {t("api.useProxy")}
      </label>

      <p className="hint local-hint">{t("api.hint")}</p>
    </>
  );
}
