import type { ApiSettings } from "../types";

const STORAGE_KEY = "forknote-settings";
const LEGACY_STORAGE_KEY = "branch-chat-settings";

/** Default max tool loop rounds per main chat turn (project bound). */
export const DEFAULT_AGENT_MAX_ROUNDS = 20;
export const MIN_AGENT_MAX_ROUNDS = 1;
export const MAX_AGENT_MAX_ROUNDS = 64;

/** First-run defaults when nothing is saved in localStorage. */
const APP_DEFAULTS: ApiSettings = {
  baseUrl: "https://api.deepseek.com",
  apiKey: "",
  model: "deepseek-v4-flash",
  useProxy: true,
  contextMemoryEnabled: true,
  compressAfterArchive: false,
  memoryDir: ".forknote/memory",
  mem0Enabled: false,
  mem0ApiKey: "",
  mem0UserId: "",
  mem0Host: "",
  agentMaxRounds: DEFAULT_AGENT_MAX_ROUNDS,
};

export function resolveAgentMaxRounds(settings: ApiSettings): number {
  const n = settings.agentMaxRounds ?? DEFAULT_AGENT_MAX_ROUNDS;
  if (!Number.isFinite(n)) return DEFAULT_AGENT_MAX_ROUNDS;
  return Math.min(
    MAX_AGENT_MAX_ROUNDS,
    Math.max(MIN_AGENT_MAX_ROUNDS, Math.round(n)),
  );
}

/** Merge saved settings with app defaults (Settings UI is the source of truth). */
export function normalizeApiSettings(raw: Partial<ApiSettings>): ApiSettings {
  return {
    ...APP_DEFAULTS,
    ...raw,
    baseUrl: (raw.baseUrl ?? APP_DEFAULTS.baseUrl).trim(),
    model: (raw.model ?? APP_DEFAULTS.model).trim(),
    apiKey: (raw.apiKey ?? APP_DEFAULTS.apiKey).trim(),
    useProxy: raw.useProxy ?? APP_DEFAULTS.useProxy,
    contextMemoryEnabled:
      raw.contextMemoryEnabled ?? APP_DEFAULTS.contextMemoryEnabled,
    compressAfterArchive:
      raw.compressAfterArchive ?? APP_DEFAULTS.compressAfterArchive,
    memoryDir:
      (raw.memoryDir ?? APP_DEFAULTS.memoryDir ?? ".forknote/memory").trim() ||
      ".forknote/memory",
    mem0Enabled: raw.mem0Enabled ?? APP_DEFAULTS.mem0Enabled,
    mem0ApiKey: (raw.mem0ApiKey ?? APP_DEFAULTS.mem0ApiKey ?? "").trim(),
    mem0UserId: (raw.mem0UserId ?? APP_DEFAULTS.mem0UserId ?? "").trim(),
    mem0Host: (raw.mem0Host ?? APP_DEFAULTS.mem0Host ?? "").trim(),
    agentMaxRounds: resolveAgentMaxRounds({
      agentMaxRounds: raw.agentMaxRounds ?? APP_DEFAULTS.agentMaxRounds,
    } as ApiSettings),
  };
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

    // Blank keys in storage mean "unset" — fall back to defaults, not stale blanks.
    if (!String(fromStorage.apiKey ?? "").trim()) {
      delete fromStorage.apiKey;
    }
    if (!String(fromStorage.mem0ApiKey ?? "").trim()) {
      delete fromStorage.mem0ApiKey;
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
