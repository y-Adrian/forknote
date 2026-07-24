/**
 * Smoke: per-session model helpers.
 * Usage: npx --yes tsx scripts/smoke-session-model.mts
 */
import {
  patchSessionModel,
  resolveSessionModel,
  settingsForSession,
  truncateModelLabel,
} from "../src/lib/sessionModel.ts";
import type { ApiSettings, ChatSession } from "../src/types.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function session(id: string, model?: string | null): ChatSession {
  const now = Date.now();
  return {
    id,
    title: id,
    thread: null,
    createdAt: now,
    updatedAt: now,
    ...(model !== undefined ? { model } : {}),
  };
}

const settings: ApiSettings = {
  baseUrl: "https://api.example.com",
  apiKey: "k",
  model: "default-model",
  useProxy: true,
};

// Missing model → inherit settings
assert(
  resolveSessionModel(session("a"), settings) === "default-model",
  "inherit default",
);
assert(
  resolveSessionModel(session("b", null), settings) === "default-model",
  "null inherits",
);
assert(
  resolveSessionModel(session("c", "  "), settings) === "default-model",
  "blank inherits",
);

// Snapshot / override
assert(
  resolveSessionModel(session("d", "gpt-4o-mini"), settings) === "gpt-4o-mini",
  "session override",
);

const llm = settingsForSession(settings, session("e", "deepseek-v4-flash"));
assert(llm.model === "deepseek-v4-flash", "settingsForSession model");
assert(llm.baseUrl === settings.baseUrl, "connection unchanged");
assert(llm.apiKey === settings.apiKey, "key unchanged");

// Patch only one session
let sessions = [session("a", "m1"), session("b", "m2")];
sessions = patchSessionModel(sessions, "a", "m1-new");
assert(sessions[0].model === "m1-new", "patched a");
assert(sessions[1].model === "m2", "b untouched");
sessions = patchSessionModel(sessions, "b", "  ");
assert(sessions[1].model === null, "blank clears to null");

assert(truncateModelLabel("short") === "short", "short label");
assert(
  truncateModelLabel("org/very-long-model-name-here", 12).length <= 12,
  "truncates",
);

console.log("smoke-session-model: ok");
