import type { ApiSettings } from "../types";

const STORAGE_KEY = "forknote-settings";
const LEGACY_STORAGE_KEY = "branch-chat-settings";

function envApiKey(): string {
  return (import.meta.env.VITE_OPENAI_API_KEY || "").trim();
}

function envMem0ApiKey(): string {
  return (import.meta.env.VITE_MEM0_API_KEY || "").trim();
}

const defaults: ApiSettings = {
  baseUrl: (import.meta.env.VITE_OPENAI_BASE_URL || "https://api.deepseek.com").trim(),
  apiKey: envApiKey(),
  model: (import.meta.env.VITE_OPENAI_MODEL || "deepseek-chat").trim(),
  useProxy: true,
  contextMemoryEnabled: true,
  compressAfterArchive: false,
  memoryDir: ".forknote/memory",
  mem0Enabled: false,
  mem0ApiKey: envMem0ApiKey(),
  mem0UserId: "",
  mem0Host: (import.meta.env.VITE_MEM0_HOST || "").trim(),
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
    contextMemoryEnabled: raw.contextMemoryEnabled ?? defaults.contextMemoryEnabled,
    compressAfterArchive: raw.compressAfterArchive ?? defaults.compressAfterArchive,
    memoryDir:
      (raw.memoryDir ?? defaults.memoryDir ?? ".forknote/memory").trim() ||
      ".forknote/memory",
    mem0Enabled: raw.mem0Enabled ?? defaults.mem0Enabled,
    mem0ApiKey: (raw.mem0ApiKey ?? defaults.mem0ApiKey ?? "").trim(),
    mem0UserId: (raw.mem0UserId ?? defaults.mem0UserId ?? "").trim(),
    mem0Host: (raw.mem0Host ?? defaults.mem0Host ?? "").trim(),
  };
  if (!merged.apiKey) merged.apiKey = envApiKey();
  if (!merged.mem0ApiKey) merged.mem0ApiKey = envMem0ApiKey();
  return merged;
}

function readStoredSettingsRaw(): string | null {
  const current = localStorage.getItem(STORAGE_KEY);
  if (current) return current;
  const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (legacy) {
    localStorage.setItem(STORAGE_KEY, legacy);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    return legacy;
  }
  return null;
}

export function loadSettings(): ApiSettings {
  try {
    const raw = readStoredSettingsRaw();
    if (!raw) return normalizeApiSettings({});
    const parsed = JSON.parse(raw) as Partial<ApiSettings>;
    const fromStorage = { ...parsed };

    // Drop stored key if blank
    if (!String(fromStorage.apiKey ?? "").trim()) {
      delete fromStorage.apiKey;
    }
    if (!String(fromStorage.mem0ApiKey ?? "").trim()) {
      delete fromStorage.mem0ApiKey;
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
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}

/**
 * OpenAI-client style API root. Appends `/v1` unless the URL already ends with
 * a version segment (`/v1`, `/v3`, `/v4`, …) — e.g. Zhipu `/api/paas/v4`,
 * Volcengine Ark `/api/v3`.
 */
export function normalizeBaseUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  if (/\/v\d+$/i.test(base)) return base;
  return `${base}/v1`;
}

/** Full API root for Vite proxy target (includes /v1 or /vN). */
export function proxyTargetFromBaseUrl(baseUrl: string): string {
  return normalizeBaseUrl(baseUrl);
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
