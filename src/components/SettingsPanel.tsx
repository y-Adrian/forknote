import { useEffect, useState } from "react";
import type { ApiSettings } from "../types";
import { saveSettings } from "../lib/settings";

interface Props {
  settings: ApiSettings;
  open: boolean;
  onClose: () => void;
  onSave: (settings: ApiSettings) => void;
}

const CLOUD_PRESET = {
  label: "DeepSeek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  hint: "在 platform.deepseek.com 创建 API Key 并粘贴到下方",
};

const LOCAL_PRESETS: Array<{
  label: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  hint: string;
}> = [
  {
    label: "Ollama",
    baseUrl: "http://127.0.0.1:11434",
    model: "llama3.2",
    apiKey: "",
    hint: "先运行 ollama serve，并用 ollama pull <模型名>",
  },
  {
    label: "LM Studio",
    baseUrl: "http://127.0.0.1:1234",
    model: "local-model",
    apiKey: "",
    hint: "在 LM Studio 中加载模型并开启 Local Server（OpenAI 兼容）",
  },
  {
    label: "vLLM / 其它",
    baseUrl: "http://127.0.0.1:8000",
    model: "default",
    apiKey: "",
    hint: "Base URL 填你本地服务的根地址，Model 填服务要求的名称",
  },
];

export function SettingsPanel({ settings, open, onClose, onSave }: Props) {
  const [draft, setDraft] = useState(settings);

  useEffect(() => {
    if (open) setDraft(settings);
  }, [open, settings]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal settings-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="settings-title"
      >
        <h2 id="settings-title">API 设置</h2>
        <p className="hint">
          任意 <strong>OpenAI 兼容</strong> 接口均可（云端或本机）。开发时建议勾选
          「使用本地代理」，请求经 <code>/openai</code> 转发到你填写的 Base URL。
        </p>

        <div className="preset-row">
          <span className="preset-label">云端：</span>
          <button
            type="button"
            className="btn ghost sm"
            title={CLOUD_PRESET.hint}
            onClick={() =>
              setDraft({
                ...draft,
                baseUrl: CLOUD_PRESET.baseUrl,
                model: CLOUD_PRESET.model,
                useProxy: true,
              })
            }
          >
            {CLOUD_PRESET.label}
          </button>
        </div>

        <div className="preset-row">
          <span className="preset-label">本地预设：</span>
          {LOCAL_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="btn ghost sm"
              title={preset.hint}
              onClick={() =>
                setDraft({
                  ...draft,
                  baseUrl: preset.baseUrl,
                  model: preset.model,
                  apiKey: preset.apiKey,
                  useProxy: true,
                })
              }
            >
              {preset.label}
            </button>
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
          API Key（本地一般可留空）
          <input
            type="password"
            value={draft.apiKey}
            onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
            placeholder="可选"
            autoComplete="off"
          />
        </label>

        <label>
          Model
          <input
            value={draft.model}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            placeholder="与本地已加载模型名一致"
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
          开发环境使用本地代理（连接本机模型时建议开启）
        </label>

        <p className="hint local-hint">
          本机模型需先启动服务。Ollama 可用 <code>ollama list</code> 查看模型名；
          Model 必须与列表中的名称一致（如 <code>qwen2.5:7b</code>）。
        </p>

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            取消
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
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
