import type { ApiSettings } from "../types";

const STORAGE_KEY = "branch-chat-settings";

function envApiKey(): string {
  return (import.meta.env.VITE_OPENAI_API_KEY || "").trim();
}

const defaults: ApiSettings = {
  baseUrl: (import.meta.env.VITE_OPENAI_BASE_URL || "https://api.deepseek.com").trim(),
  apiKey: envApiKey(),
  model: (import.meta.env.VITE_OPENAI_MODEL || "deepseek-chat").trim(),
  useProxy: true,
};

/** 合并默认值、环境变量与 localStorage；空 Key 不覆盖 .env */
export function normalizeApiSettings(raw: Partial<ApiSettings>): ApiSettings {
  const merged: ApiSettings = {
    ...defaults,
    ...raw,
    baseUrl: (raw.baseUrl ?? defaults.baseUrl).trim(),
    model: (raw.model ?? defaults.model).trim(),
    apiKey: (raw.apiKey ?? defaults.apiKey).trim(),
    useProxy: raw.useProxy ?? defaults.useProxy,
  };
  if (!merged.apiKey) merged.apiKey = envApiKey();
  return merged;
}

export function loadSettings(): ApiSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return normalizeApiSettings({});
    const parsed = JSON.parse(raw) as Partial<ApiSettings>;
    const fromStorage = { ...parsed };

    // Drop stored key if blank
    if (!String(fromStorage.apiKey ?? "").trim()) {
      delete fromStorage.apiKey;
    }

    // If localStorage points to a remote URL but .env now points local,
    // and no key is stored, prefer the .env local endpoint.
    const storedBase = String(fromStorage.baseUrl ?? "").trim();
    const envBase = defaults.baseUrl;
    const storedIsRemote = storedBase && !isLikelyLocalEndpoint(storedBase);
    const envIsLocal = isLikelyLocalEndpoint(envBase);
    if (storedIsRemote && envIsLocal && !fromStorage.apiKey) {
      delete fromStorage.baseUrl;
      delete fromStorage.model;
    }

    return normalizeApiSettings(fromStorage);
  } catch {
    return normalizeApiSettings({});
  }
}

export function saveSettings(settings: ApiSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeApiSettings(settings)));
}

export function normalizeBaseUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

/** Host root for Vite dev proxy (no /v1 suffix). */
export function proxyTargetFromBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "").replace(/\/v1$/, "");
}

export function isLikelyLocalEndpoint(baseUrl: string): boolean {
  return /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?/i.test(baseUrl.trim());
}

export function resolveApiUrl(settings: ApiSettings): string {
  if (settings.useProxy) {
    return `${window.location.origin}/openai`;
  }
  return normalizeBaseUrl(settings.baseUrl);
}
