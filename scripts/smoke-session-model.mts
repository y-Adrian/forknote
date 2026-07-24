/**
 * Smoke: per-session API override helpers (inherit until overridden).
 * Usage: npx --yes tsx scripts/smoke-session-model.mts
 */
import {
  clearSessionApi,
  hasSessionApiOverride,
  migrateSessionApiFields,
  overridesFromDraft,
  patchSessionApi,
  resolveSessionApi,
  resolveSessionModel,
  settingsForSession,
  truncateModelLabel,
} from "../src/lib/sessionApi.ts";
import type { ApiSettings, ChatSession } from "../src/types.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function session(
  id: string,
  api?: ChatSession["api"],
  legacyModel?: string | null,
): ChatSession {
  const now = Date.now();
  return {
    id,
    title: id,
    thread: null,
    createdAt: now,
    updatedAt: now,
    ...(api !== undefined ? { api } : {}),
    ...(legacyModel !== undefined ? { model: legacyModel } : {}),
  };
}

const settings: ApiSettings = {
  baseUrl: "https://api.example.com",
  apiKey: "global-key",
  model: "default-model",
  useProxy: true,
};

// Missing api → inherit all
const a = resolveSessionApi(session("a"), settings);
assert(a.baseUrl === settings.baseUrl, "inherit baseUrl");
assert(a.apiKey === settings.apiKey, "inherit apiKey");
assert(a.model === settings.model, "inherit model");
assert(a.useProxy === settings.useProxy, "inherit useProxy");
assert(!hasSessionApiOverride(session("a")), "no override flag");

assert(
  resolveSessionModel(session("b", null), settings) === "default-model",
  "null api inherits model",
);

// Partial override
const partial = session("c", { model: "gpt-4o-mini" });
const c = resolveSessionApi(partial, settings);
assert(c.model === "gpt-4o-mini", "model override");
assert(c.baseUrl === settings.baseUrl, "baseUrl still inherited");
assert(c.apiKey === settings.apiKey, "apiKey still inherited");
assert(hasSessionApiOverride(partial), "has override");

// Full override
const full = session("d", {
  baseUrl: "http://127.0.0.1:11434",
  apiKey: "",
  model: "llama3.2",
  useProxy: false,
});
const d = resolveSessionApi(full, settings);
assert(d.baseUrl === "http://127.0.0.1:11434", "baseUrl override");
assert(d.apiKey === "", "apiKey override empty");
assert(d.model === "llama3.2", "model override full");
assert(d.useProxy === false, "useProxy override");

const llm = settingsForSession(settings, partial);
assert(llm.model === "gpt-4o-mini", "settingsForSession model");
assert(llm.baseUrl === settings.baseUrl, "connection unchanged when only model");

// Diff → store only changed fields
const overrides = overridesFromDraft(
  {
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    model: "only-model",
    useProxy: settings.useProxy,
  },
  settings,
);
assert(overrides?.model === "only-model", "diff keeps model");
assert(overrides?.baseUrl === undefined, "diff omits baseUrl");
assert(overrides?.apiKey === undefined, "diff omits apiKey");
assert(overrides?.useProxy === undefined, "diff omits useProxy");

const same = overridesFromDraft(
  {
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
    useProxy: settings.useProxy,
  },
  settings,
);
assert(same === null, "identical draft clears overrides");

// Patch / clear
let sessions = [session("a", { model: "m1" }), session("b", { model: "m2" })];
sessions = patchSessionApi(sessions, "a", { model: "m1-new", useProxy: false });
assert(sessions[0].api?.model === "m1-new", "patched a model");
assert(sessions[0].api?.useProxy === false, "patched a proxy");
assert(sessions[1].api?.model === "m2", "b untouched");
sessions = clearSessionApi(sessions, "b");
assert(sessions[1].api === null, "cleared b");

// Legacy model → api.model
const migrated = migrateSessionApiFields(session("legacy", undefined, "old-m"));
assert(migrated.api?.model === "old-m", "legacy migrated");
assert(!("model" in migrated) || migrated.model === undefined, "legacy stripped");

assert(truncateModelLabel("short") === "short", "short label");
assert(
  truncateModelLabel("org/very-long-model-name-here", 12).length <= 12,
  "truncates",
);

console.log("smoke-session-model: ok");
