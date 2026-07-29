/**
 * Portable memory import/export for transfer between ForkNote and other agents.
 *
 * Primary format: single JSON `forknote-memory-v1` with three markdown fields
 * (summary / tasks / decisions) that map 1:1 to SUMMARY.md / TASKS.md / DECISIONS.md.
 * Also accepts the compress delimiter layout and loose JSON with those keys.
 */

import { parseCompressedOutput } from "./contextMemory";
import { createId } from "./id";
import {
  loadUserPreferences,
  normalizePreferenceText,
  saveUserPreferences,
} from "./userPreferences";
import type {
  ContextMemoryPack,
  SessionMemory,
  UserPreferenceEntry,
} from "../types";

export const MEMORY_TRANSFER_FORMAT = "forknote-memory-v1" as const;

export interface MemoryTransferBundle {
  format: typeof MEMORY_TRANSFER_FORMAT;
  exportedAt: number;
  app: "ForkNote";
  /** Project pack — plain markdown, agent-portable */
  summary: string;
  tasks: string;
  decisions: string;
  /** Optional user preferences */
  preferences?: Array<{ text: string; id?: string; updatedAt?: number }>;
  /** Optional per-note session summary */
  sessionMemory?: { summary: string; updatedAt?: number };
}

export interface MemoryTransferParseResult {
  summary: string;
  tasks: string;
  decisions: string;
  preferences?: UserPreferenceEntry[];
  sessionMemory?: SessionMemory;
  /** How the payload was recognized */
  kind: "forknote-json" | "loose-json" | "delimited-markdown";
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function pickField(
  obj: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    if (key in obj && obj[key] != null) return asString(obj[key]);
    const found = Object.keys(obj).find(
      (k) => k.toLowerCase() === key.toLowerCase(),
    );
    if (found && obj[found] != null) return asString(obj[found]);
  }
  return undefined;
}

function normalizePreferences(
  raw: unknown,
): UserPreferenceEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: UserPreferenceEntry[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const text = normalizePreferenceText(item);
      if (text) out.push({ id: createId(), text, updatedAt: Date.now() });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const text = normalizePreferenceText(asString(rec.text ?? rec.content ?? ""));
    if (!text) continue;
    out.push({
      id: typeof rec.id === "string" && rec.id ? rec.id : createId(),
      text,
      updatedAt:
        typeof rec.updatedAt === "number" && Number.isFinite(rec.updatedAt)
          ? rec.updatedAt
          : Date.now(),
    });
  }
  return out.length ? out.slice(0, 40) : undefined;
}

function normalizeSessionMemory(
  raw: unknown,
): SessionMemory | undefined {
  if (typeof raw === "string") {
    const summary = raw.trim();
    return summary ? { summary, updatedAt: Date.now() } : undefined;
  }
  if (!raw || typeof raw !== "object") return undefined;
  const rec = raw as Record<string, unknown>;
  const summary = asString(rec.summary ?? rec.text ?? "").trim();
  if (!summary) return undefined;
  return {
    summary,
    updatedAt:
      typeof rec.updatedAt === "number" && Number.isFinite(rec.updatedAt)
        ? rec.updatedAt
        : Date.now(),
  };
}

/** Build an exportable bundle from current local layers. */
export function buildMemoryTransferBundle(input: {
  pack?: ContextMemoryPack | null;
  preferences?: UserPreferenceEntry[];
  sessionMemory?: SessionMemory | null;
}): MemoryTransferBundle {
  const pack = input.pack;
  return {
    format: MEMORY_TRANSFER_FORMAT,
    exportedAt: Date.now(),
    app: "ForkNote",
    summary: pack?.summary ?? "",
    tasks: pack?.tasks ?? "",
    decisions: pack?.decisions ?? "",
    preferences: (input.preferences ?? loadUserPreferences()).map((e) => ({
      id: e.id,
      text: e.text,
      updatedAt: e.updatedAt,
    })),
    sessionMemory: input.sessionMemory?.summary?.trim()
      ? {
          summary: input.sessionMemory.summary,
          updatedAt: input.sessionMemory.updatedAt,
        }
      : undefined,
  };
}

export function serializeMemoryTransferBundle(
  bundle: MemoryTransferBundle,
): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

/**
 * Parse import payload: forknote-memory-v1 JSON, loose JSON with markdown
 * fields, or ===SUMMARY.md=== delimited markdown (same as compress output).
 */
export function parseMemoryTransferImport(
  raw: string,
): MemoryTransferParseResult {
  const text = raw.replace(/^\uFEFF/, "").trim();
  if (!text) {
    throw new Error("Empty memory file");
  }

  // Delimited markdown (no JSON)
  if (/===\s*SUMMARY\.md\s*===/i.test(text) && !text.trimStart().startsWith("{")) {
    const pack = parseCompressedOutput(text);
    return {
      summary: pack.summary,
      tasks: pack.tasks,
      decisions: pack.decisions,
      kind: "delimited-markdown",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Plain markdown without delimiters → SUMMARY only
    if (text.length > 0) {
      return {
        summary: text,
        tasks: "",
        decisions: "",
        kind: "delimited-markdown",
      };
    }
    throw new Error("Invalid memory JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Memory JSON must be an object");
  }

  const obj = parsed as Record<string, unknown>;
  const format = asString(obj.format);

  // Nested pack object (some agents wrap fields)
  const nested =
    obj.pack && typeof obj.pack === "object" && !Array.isArray(obj.pack)
      ? (obj.pack as Record<string, unknown>)
      : obj.memory && typeof obj.memory === "object" && !Array.isArray(obj.memory)
        ? (obj.memory as Record<string, unknown>)
        : null;

  const src = nested ?? obj;

  const summary =
    pickField(src, ["summary", "SUMMARY.md", "SUMMARY", "overview"]) ?? "";
  const tasks =
    pickField(src, ["tasks", "TASKS.md", "TASKS", "todo", "todos"]) ?? "";
  const decisions =
    pickField(src, [
      "decisions",
      "DECISIONS.md",
      "DECISIONS",
      "constraints",
    ]) ?? "";

  if (!summary && !tasks && !decisions) {
    throw new Error(
      "No summary/tasks/decisions fields found. Use forknote-memory-v1 or ===SUMMARY.md=== markdown.",
    );
  }

  const preferences = normalizePreferences(
    obj.preferences ?? obj.prefs ?? obj.userPreferences,
  );
  const sessionMemory = normalizeSessionMemory(
    obj.sessionMemory ?? obj.session ?? obj.workingMemory,
  );

  return {
    summary,
    tasks,
    decisions,
    preferences,
    sessionMemory,
    kind:
      format === MEMORY_TRANSFER_FORMAT ? "forknote-json" : "loose-json",
  };
}

/** Apply preferences from an import (replaces local list when provided). */
export function applyImportedPreferences(
  preferences: UserPreferenceEntry[] | undefined,
): UserPreferenceEntry[] | null {
  if (!preferences) return null;
  saveUserPreferences(preferences);
  return loadUserPreferences();
}

export function memoryTransferFilename(date = new Date()): string {
  return `forknote-memory-${date.toISOString().slice(0, 10)}.json`;
}
