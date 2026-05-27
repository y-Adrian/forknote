import type { ApiSettings } from "../types";

const STORAGE_KEY = "branch-chat-settings";

const defaults: ApiSettings = {
  baseUrl: import.meta.env.VITE_OPENAI_BASE_URL || "https://api.deepseek.com",
  apiKey: import.meta.env.VITE_OPENAI_API_KEY || "",
  model: import.meta.env.VITE_OPENAI_MODEL || "deepseek-chat",
  useProxy: true,
};

export function loadSettings(): ApiSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaults };
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(settings: ApiSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
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
