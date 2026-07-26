/**
 * User-wide preference memory layer (localStorage).
 * Separately injectable from project pack / session summary.
 */

import { createId } from "./id";
import type { UserPreferenceEntry } from "../types";

export const USER_PREFERENCES_STORAGE_KEY = "forknote-user-preferences";

const MAX_ENTRIES = 40;
const MAX_TEXT = 800;

export function normalizePreferenceText(text: string): string {
  return text.trim().replace(/\s+/g, " ").slice(0, MAX_TEXT);
}

export function loadUserPreferences(): UserPreferenceEntry[] {
  try {
    const raw = localStorage.getItem(USER_PREFERENCES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item): UserPreferenceEntry | null => {
        if (!item || typeof item !== "object") return null;
        const rec = item as Partial<UserPreferenceEntry>;
        const text = normalizePreferenceText(String(rec.text ?? ""));
        if (!text) return null;
        return {
          id: typeof rec.id === "string" && rec.id ? rec.id : createId(),
          text,
          updatedAt:
            typeof rec.updatedAt === "number" && Number.isFinite(rec.updatedAt)
              ? rec.updatedAt
              : Date.now(),
        };
      })
      .filter((e): e is UserPreferenceEntry => e != null)
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function saveUserPreferences(entries: UserPreferenceEntry[]): void {
  const cleaned = entries
    .map((e) => ({
      id: e.id || createId(),
      text: normalizePreferenceText(e.text),
      updatedAt: e.updatedAt || Date.now(),
    }))
    .filter((e) => e.text)
    .slice(0, MAX_ENTRIES);
  localStorage.setItem(USER_PREFERENCES_STORAGE_KEY, JSON.stringify(cleaned));
}

export function addUserPreference(text: string): UserPreferenceEntry[] {
  const trimmed = normalizePreferenceText(text);
  if (!trimmed) return loadUserPreferences();
  const next: UserPreferenceEntry[] = [
    { id: createId(), text: trimmed, updatedAt: Date.now() },
    ...loadUserPreferences().filter((e) => e.text !== trimmed),
  ].slice(0, MAX_ENTRIES);
  saveUserPreferences(next);
  return next;
}

export function updateUserPreference(
  id: string,
  text: string,
): UserPreferenceEntry[] {
  const trimmed = normalizePreferenceText(text);
  const current = loadUserPreferences();
  if (!trimmed) {
    return deleteUserPreference(id);
  }
  const next = current.map((e) =>
    e.id === id ? { ...e, text: trimmed, updatedAt: Date.now() } : e,
  );
  saveUserPreferences(next);
  return next;
}

export function deleteUserPreference(id: string): UserPreferenceEntry[] {
  const next = loadUserPreferences().filter((e) => e.id !== id);
  saveUserPreferences(next);
  return next;
}

export function formatPreferencesAddendum(
  entries: UserPreferenceEntry[],
): string | null {
  const lines = entries
    .map((e) => e.text.trim())
    .filter(Boolean)
    .map((t) => `- ${t}`);
  if (lines.length === 0) return null;
  return [
    "【用户偏好 · Preferences】",
    "- 跨笔记长期偏好；与当前会话冲突时以当前会话为准。",
    "",
    ...lines,
  ].join("\n");
}
