/**
 * Cross-session User Model persistence (localStorage).
 * Session immediate corrections stay session-scoped; this store keeps
 * confidence that survives new notes / deleted sessions.
 */
import type { FeedbackEvent } from "../types";
import { safeLocalStorageSetItem } from "./browserStorage";
import {
  applyFeedbackToUserModel,
  buildUserModelFromFeedbackLog,
  emptyUserModel,
  type UserModel,
  type UserPreferenceEntry,
} from "./userModel";

export const USER_MODEL_STORAGE_KEY = "forknote-user-model-v1";

const MAX_PREFS = 64;

type PersistedEnvelope = {
  version: 1;
  model: UserModel;
};

function isBrowserStorage(): boolean {
  return typeof localStorage !== "undefined";
}

function clampModel(model: UserModel): UserModel {
  const entries = Object.entries(model.preferences);
  if (entries.length <= MAX_PREFS) return model;
  // Keep highest-confidence / most recent prefs when over cap.
  entries.sort((a, b) => {
    const conf = b[1].confidence - a[1].confidence;
    if (conf !== 0) return conf;
    return b[1].updatedAt - a[1].updatedAt;
  });
  const preferences: Record<string, UserPreferenceEntry> = {};
  for (const [k, v] of entries.slice(0, MAX_PREFS)) {
    preferences[k] = v;
  }
  return { preferences, lastUpdated: model.lastUpdated };
}

export function loadPersistedUserModel(): UserModel {
  if (!isBrowserStorage()) return emptyUserModel();
  try {
    const raw = localStorage.getItem(USER_MODEL_STORAGE_KEY);
    if (!raw) return emptyUserModel();
    const parsed = JSON.parse(raw) as PersistedEnvelope | UserModel;
    if (
      parsed &&
      typeof parsed === "object" &&
      "version" in parsed &&
      parsed.version === 1 &&
      parsed.model &&
      typeof parsed.model === "object"
    ) {
      return clampModel({
        preferences: { ...(parsed.model.preferences ?? {}) },
        lastUpdated:
          typeof parsed.model.lastUpdated === "number"
            ? parsed.model.lastUpdated
            : Date.now(),
      });
    }
    // Legacy: bare UserModel
    if (
      parsed &&
      typeof parsed === "object" &&
      "preferences" in parsed &&
      parsed.preferences
    ) {
      return clampModel({
        preferences: { ...(parsed as UserModel).preferences },
        lastUpdated:
          typeof (parsed as UserModel).lastUpdated === "number"
            ? (parsed as UserModel).lastUpdated
            : Date.now(),
      });
    }
    return emptyUserModel();
  } catch {
    return emptyUserModel();
  }
}

export function savePersistedUserModel(model: UserModel): void {
  if (!isBrowserStorage()) return;
  const envelope: PersistedEnvelope = {
    version: 1,
    model: clampModel(model),
  };
  const result = safeLocalStorageSetItem(
    USER_MODEL_STORAGE_KEY,
    JSON.stringify(envelope),
  );
  if (!result.ok) {
    console.warn("[ForkNote] savePersistedUserModel failed", result.message);
  }
}

/** Apply one feedback event into the cross-session store. */
export function persistFeedbackIntoUserModel(event: FeedbackEvent): UserModel {
  const next = applyFeedbackToUserModel(loadPersistedUserModel(), event);
  savePersistedUserModel(next);
  return next;
}

/**
 * Merge global persisted prefs with the live session rebuild.
 * Same prefer → keep higher confidence / more samples.
 * Prefer conflict → take newer entry, dampen confidence slightly.
 */
export function mergeUserModels(
  global: UserModel,
  session: UserModel,
): UserModel {
  const keys = new Set([
    ...Object.keys(global.preferences),
    ...Object.keys(session.preferences),
  ]);
  const preferences: Record<string, UserPreferenceEntry> = {};
  for (const key of keys) {
    const g = global.preferences[key];
    const s = session.preferences[key];
    if (!g) {
      preferences[key] = s!;
      continue;
    }
    if (!s) {
      preferences[key] = g;
      continue;
    }
    if (g.prefer === s.prefer) {
      preferences[key] = {
        prefer: g.prefer,
        confidence: Math.max(g.confidence, s.confidence),
        samples: Math.max(g.samples, s.samples),
        updatedAt: Math.max(g.updatedAt, s.updatedAt),
      };
    } else {
      const newer = s.updatedAt >= g.updatedAt ? s : g;
      preferences[key] = {
        ...newer,
        confidence: Math.min(newer.confidence, 0.65),
      };
    }
  }
  return clampModel({
    preferences,
    lastUpdated: Math.max(global.lastUpdated, session.lastUpdated),
  });
}

/**
 * One-shot migration: fold historical session feedback logs into an empty store.
 * No-op when the store already has prefs.
 */
export function seedPersistedUserModelFromSessions(
  logs: Array<FeedbackEvent[] | null | undefined>,
): UserModel {
  const existing = loadPersistedUserModel();
  if (Object.keys(existing.preferences).length > 0) return existing;
  let model = emptyUserModel();
  for (const log of logs) {
    for (const event of log ?? []) {
      model = applyFeedbackToUserModel(model, event);
    }
  }
  if (Object.keys(model.preferences).length > 0) {
    savePersistedUserModel(model);
  }
  return model;
}

/** Resolve the model used for agent injection (global ∪ session). */
export function resolveUserModelForAgent(
  sessionLog: FeedbackEvent[] | null | undefined,
): UserModel {
  const session = buildUserModelFromFeedbackLog(sessionLog);
  return mergeUserModels(loadPersistedUserModel(), session);
}
