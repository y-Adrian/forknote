import type { ApiSettings } from "../types";
import {
  safeLocalStorageRemoveItem,
  safeLocalStorageSetItem,
} from "./browserStorage";

const STORAGE_KEY = "forknote-settings";
const LEGACY_STORAGE_KEY = "branch-chat-settings";

/** Default max tool loop rounds per main chat turn (project bound).
 * Mainstream agents (Claude Code / Cursor) often run uncapped or very high;
 * we keep a finite default with a higher safety ceiling. */
export const DEFAULT_AGENT_MAX_ROUNDS = 50;
export const MIN_AGENT_MAX_ROUNDS = 1;
export const MAX_AGENT_MAX_ROUNDS = 128;
export const DEFAULT_JEV_MIN_CONFIDENCE = 0.65;

/** Live-mode sliding window: recent user↔assistant turns kept verbatim.
 * Default 64 matches longer IDE-agent sessions; max allows multi-hour notes. */
export const DEFAULT_CONTEXT_WINDOW_TURNS = 64;
export const MIN_CONTEXT_WINDOW_TURNS = 4;
export const MAX_CONTEXT_WINDOW_TURNS = 256;

/**
 * Soft UI hint: suggest Compress when the main thread has at least this many
 * non-empty messages (~half that many turns).
 */
export const COMPRESS_SUGGEST_MESSAGE_THRESHOLD = 80;

export type PlantumlRenderMode = "off" | "server" | "local";

export const DEFAULT_PLANTUML_SERVER_URL = "https://kroki.io";

/** First-run defaults when nothing is saved in localStorage. */
const APP_DEFAULTS: ApiSettings = {
  baseUrl: "",
  apiKey: "",
  model: "",
  useProxy: true,
  contextMemoryEnabled: true,
  memoryLayerPreferences: true,
  memoryLayerProject: true,
  memoryLayerSession: true,
  compressAfterArchive: false,
  memoryDir: ".forknote/memory",
  contextWindowTurns: DEFAULT_CONTEXT_WINDOW_TURNS,
  contextAutoSummary: true,
  agentMaxRounds: DEFAULT_AGENT_MAX_ROUNDS,
  agentRequireApproval: true,
  agentAllowTerminal: true,
  agentAllowNetwork: false,
  agentAutoDiagnostics: true,
  agentPlanModel: "",
  agentCodeModel: "",
  agentSummaryModel: "",
  jevReflectEnabled: false,
  jevBaseUrl: "https://api.typesafe.ai",
  jevApiKey: "",
  jevModel: "jev-latest",
  jevMinConfidence: DEFAULT_JEV_MIN_CONFIDENCE,
  plantumlRenderMode: "off",
  plantumlServerUrl: DEFAULT_PLANTUML_SERVER_URL,
  plantumlLocalPath: "",
  plantumlJavaPath: "java",
};

export function resolvePlantumlRenderMode(
  settings: ApiSettings,
): PlantumlRenderMode {
  const mode = settings.plantumlRenderMode;
  if (mode === "server" || mode === "local" || mode === "off") return mode;
  return "off";
}

export function resolvePlantumlServerUrl(settings: ApiSettings): string {
  const raw = (settings.plantumlServerUrl ?? DEFAULT_PLANTUML_SERVER_URL).trim();
  return raw || DEFAULT_PLANTUML_SERVER_URL;
}

export function resolvePlantumlLocalPath(settings: ApiSettings): string {
  return (settings.plantumlLocalPath ?? "").trim();
}

export function resolvePlantumlJavaPath(settings: ApiSettings): string {
  const raw = (settings.plantumlJavaPath ?? "java").trim();
  return raw || "java";
}

export function resolveAgentRequireApproval(settings: ApiSettings): boolean {
  return settings.agentRequireApproval ?? true;
}

export function resolveAgentAllowTerminal(settings: ApiSettings): boolean {
  return settings.agentAllowTerminal ?? true;
}

export function resolveAgentAllowNetwork(settings: ApiSettings): boolean {
  return settings.agentAllowNetwork === true;
}

export function resolveAgentAutoDiagnostics(settings: ApiSettings): boolean {
  return settings.agentAutoDiagnostics ?? true;
}

export function resolveAgentMaxRounds(settings: ApiSettings): number {
  const n = settings.agentMaxRounds ?? DEFAULT_AGENT_MAX_ROUNDS;
  if (!Number.isFinite(n)) return DEFAULT_AGENT_MAX_ROUNDS;
  return Math.min(
    MAX_AGENT_MAX_ROUNDS,
    Math.max(MIN_AGENT_MAX_ROUNDS, Math.round(n)),
  );
}

export function resolveContextWindowTurns(settings: ApiSettings): number {
  const n = settings.contextWindowTurns ?? DEFAULT_CONTEXT_WINDOW_TURNS;
  if (!Number.isFinite(n)) return DEFAULT_CONTEXT_WINDOW_TURNS;
  return Math.min(
    MAX_CONTEXT_WINDOW_TURNS,
    Math.max(MIN_CONTEXT_WINDOW_TURNS, Math.round(n)),
  );
}

export function isContextAutoSummaryEnabled(settings: ApiSettings): boolean {
  return settings.contextAutoSummary !== false;
}

export function isMemoryLayerPreferencesEnabled(settings: ApiSettings): boolean {
  return settings.memoryLayerPreferences !== false;
}

export function isMemoryLayerProjectEnabled(settings: ApiSettings): boolean {
  if (settings.memoryLayerProject != null) {
    return settings.memoryLayerProject !== false;
  }
  return settings.contextMemoryEnabled !== false;
}

export function isMemoryLayerSessionEnabled(settings: ApiSettings): boolean {
  return settings.memoryLayerSession !== false;
}

/** Ensure Base URL has an explicit http(s) scheme (Settings UI / localStorage). */
export function coerceApiBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** True when Base URL is an absolute http(s) URL with a host. */
export function isValidApiBaseUrl(baseUrl: string): boolean {
  const trimmed = baseUrl.trim();
  if (!trimmed || trimmed.startsWith("/")) return false;
  const coerced = coerceApiBaseUrl(trimmed);
  if (!coerced) return false;
  try {
    const url = new URL(coerced);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname;
    if (!host) return false;
    if (host === "localhost") return true;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return true;
    return host.includes(".");
  } catch {
    return false;
  }
}

/** Merge saved settings with app defaults (Settings UI is the source of truth). */
export function normalizeApiSettings(raw: Partial<ApiSettings>): ApiSettings {
  return {
    ...APP_DEFAULTS,
    ...raw,
    baseUrl: coerceApiBaseUrl((raw.baseUrl ?? APP_DEFAULTS.baseUrl).trim()),
    model: (raw.model ?? APP_DEFAULTS.model).trim(),
    apiKey: (raw.apiKey ?? APP_DEFAULTS.apiKey).trim(),
    useProxy: raw.useProxy ?? APP_DEFAULTS.useProxy,
    contextMemoryEnabled:
      raw.memoryLayerProject ??
      raw.contextMemoryEnabled ??
      APP_DEFAULTS.contextMemoryEnabled,
    memoryLayerPreferences:
      raw.memoryLayerPreferences ?? APP_DEFAULTS.memoryLayerPreferences,
    memoryLayerProject:
      raw.memoryLayerProject ??
      raw.contextMemoryEnabled ??
      APP_DEFAULTS.memoryLayerProject,
    memoryLayerSession:
      raw.memoryLayerSession ?? APP_DEFAULTS.memoryLayerSession,
    compressAfterArchive:
      raw.compressAfterArchive ?? APP_DEFAULTS.compressAfterArchive,
    memoryDir:
      (raw.memoryDir ?? APP_DEFAULTS.memoryDir ?? ".forknote/memory").trim() ||
      ".forknote/memory",
    contextWindowTurns: resolveContextWindowTurns({
      contextWindowTurns:
        raw.contextWindowTurns ?? APP_DEFAULTS.contextWindowTurns,
    } as ApiSettings),
    contextAutoSummary:
      raw.contextAutoSummary ?? APP_DEFAULTS.contextAutoSummary,
    agentMaxRounds: resolveAgentMaxRounds({
      agentMaxRounds: raw.agentMaxRounds ?? APP_DEFAULTS.agentMaxRounds,
    } as ApiSettings),
    agentRequireApproval:
      raw.agentRequireApproval ?? APP_DEFAULTS.agentRequireApproval,
    agentAllowTerminal:
      raw.agentAllowTerminal ?? APP_DEFAULTS.agentAllowTerminal,
    agentAutoDiagnostics:
      raw.agentAutoDiagnostics ?? APP_DEFAULTS.agentAutoDiagnostics,
    agentPlanModel:
      typeof raw.agentPlanModel === "string"
        ? raw.agentPlanModel.trim()
        : APP_DEFAULTS.agentPlanModel,
    agentCodeModel:
      typeof raw.agentCodeModel === "string"
        ? raw.agentCodeModel.trim()
        : APP_DEFAULTS.agentCodeModel,
    agentSummaryModel:
      typeof raw.agentSummaryModel === "string"
        ? raw.agentSummaryModel.trim()
        : APP_DEFAULTS.agentSummaryModel,
    jevReflectEnabled: raw.jevReflectEnabled === true,
    jevBaseUrl:
      coerceApiBaseUrl(raw.jevBaseUrl ?? APP_DEFAULTS.jevBaseUrl ?? "") ||
      "https://api.typesafe.ai",
    jevApiKey:
      typeof raw.jevApiKey === "string" ? raw.jevApiKey.trim() : "",
    jevModel:
      (raw.jevModel ?? APP_DEFAULTS.jevModel ?? "jev-latest").trim() ||
      "jev-latest",
    jevMinConfidence: (() => {
      const value = Number(
        raw.jevMinConfidence ?? APP_DEFAULTS.jevMinConfidence,
      );
      return Number.isFinite(value)
        ? Math.min(1, Math.max(0, value))
        : DEFAULT_JEV_MIN_CONFIDENCE;
    })(),
    plantumlRenderMode: resolvePlantumlRenderMode({
      plantumlRenderMode:
        raw.plantumlRenderMode ?? APP_DEFAULTS.plantumlRenderMode,
    } as ApiSettings),
    plantumlServerUrl: resolvePlantumlServerUrl({
      plantumlServerUrl:
        raw.plantumlServerUrl ?? APP_DEFAULTS.plantumlServerUrl,
    } as ApiSettings),
    plantumlLocalPath:
      typeof raw.plantumlLocalPath === "string"
        ? raw.plantumlLocalPath.trim()
        : APP_DEFAULTS.plantumlLocalPath,
    plantumlJavaPath: resolvePlantumlJavaPath({
      plantumlJavaPath: raw.plantumlJavaPath ?? APP_DEFAULTS.plantumlJavaPath,
    } as ApiSettings),
  };
}

/** Compare settings after normalization (draft vs saved). */
export function apiSettingsEqual(
  a: Partial<ApiSettings>,
  b: Partial<ApiSettings>,
): boolean {
  return (
    JSON.stringify(normalizeApiSettings(a)) ===
    JSON.stringify(normalizeApiSettings(b))
  );
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
    // Drop legacy mem0 fields if present in older localStorage.
    delete (fromStorage as { mem0Enabled?: unknown }).mem0Enabled;
    delete (fromStorage as { mem0ApiKey?: unknown }).mem0ApiKey;
    delete (fromStorage as { mem0UserId?: unknown }).mem0UserId;
    delete (fromStorage as { mem0Host?: unknown }).mem0Host;

    return normalizeApiSettings(fromStorage);
  } catch {
    return normalizeApiSettings({});
  }
}

export function saveSettings(settings: ApiSettings): void {
  const payload = JSON.stringify(normalizeApiSettings(settings));
  const result = safeLocalStorageSetItem(STORAGE_KEY, payload);
  if (result.ok) safeLocalStorageRemoveItem(LEGACY_STORAGE_KEY);
}

/**
 * OpenAI-client style API root. Appends `/v1` unless the URL already ends with
 * a version segment (`/v1`, `/v3`, `/v4`, …) — e.g. Zhipu `/api/paas/v4`,
 * Volcengine Ark `/api/v3`.
 */
export function normalizeBaseUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/$/, "");
  if (!base) return "";
  if (/\/v\d+$/i.test(base)) return base;
  return `${base}/v1`;
}

/** Full API root for Vite proxy target (includes /v1 or /vN). */
export function proxyTargetFromBaseUrl(baseUrl: string): string | null {
  const coerced = coerceApiBaseUrl(baseUrl);
  if (!isValidApiBaseUrl(coerced)) return null;
  return normalizeBaseUrl(coerced);
}

export function isLikelyLocalEndpoint(baseUrl: string): boolean {
  const trimmed = baseUrl.trim();
  if (/^(https?:\/\/)?(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/i.test(trimmed)) {
    return true;
  }
  try {
    const host = new URL(coerceApiBaseUrl(trimmed)).hostname.toLowerCase();
    if (/^127\.\d+\.\d+\.\d+$/.test(host) || host === "::1") return true;
    const parts = host.split(".").map((n) => Number(n));
    if (
      parts.length === 4 &&
      parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    ) {
      const [a, b] = parts;
      if (a === 10) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function resolveApiUrl(settings: ApiSettings): string {
  if (settings.useProxy) {
    return `${window.location.origin}/openai`;
  }
  return normalizeBaseUrl(settings.baseUrl);
}
