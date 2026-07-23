import { useEffect, useState } from "react";
import type { ApiSettings } from "../types";
import { saveSettings } from "../lib/settings";

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
  title: string;
  presets: Preset[];
};

/**
 * Base URLs are roots before normalizeBaseUrl (appends /v1 unless already /vN).
 * Zhipu / Volcengine already end with /v4 or /v3 — do not add another /v1.
 */
const PRESET_GROUPS: PresetGroup[] = [
  {
    title: "Cloud / aggregators",
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
    title: "China providers",
    presets: [
      {
        label: "DeepSeek",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
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
    title: "Local",
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

export function SettingsPanel({ settings, open, onClose, onSave }: Props) {
  const [draft, setDraft] = useState(settings);

  useEffect(() => {
    if (open) setDraft(settings);
  }, [open, settings]);

  if (!open) return null;

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
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal settings-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="settings-title"
      >
        <h2 id="settings-title">API Settings</h2>
        <p className="hint">
          Any <strong>OpenAI-compatible</strong> endpoint works (cloud or local).
          For cloud providers, create an API Key in their console; local setups
          usually leave it blank. In development, enable “Use local proxy” so
          requests go through <code>/openai</code> to the Base URL you set.
        </p>

        <div className="preset-groups">
          {PRESET_GROUPS.map((group) => (
            <div key={group.title} className="preset-group">
              <div className="preset-group-title">{group.title}</div>
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
          Base URL
          <input
            value={draft.baseUrl}
            onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
            placeholder="http://127.0.0.1:11434"
          />
        </label>

        <label>
          API Key (usually blank for local)
          <input
            type="password"
            value={draft.apiKey}
            onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
            placeholder="Optional"
            autoComplete="off"
          />
        </label>

        <label>
          Model
          <input
            value={draft.model}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            placeholder="Must match a locally loaded model name"
          />
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={draft.useProxy}
            onChange={(e) =>
              setDraft({ ...draft, useProxy: e.target.checked })
            }
          />
          Use local proxy in development (recommended for local models)
        </label>

        <p className="hint local-hint">
          Start the local server first. For Ollama, run <code>ollama list</code>;
          Model must match a listed name (e.g. <code>qwen2.5:7b</code>).
        </p>

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
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
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
