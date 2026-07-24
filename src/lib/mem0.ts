/**
 * Optional mem0 Platform adapter (thin fetch client — no `mem0ai` dependency).
 *
 * When disabled or misconfigured, every helper no-ops / returns empty so chat
 * keeps working. Cloud mem0 receives conversation snippets when enabled.
 *
 * Local / self-hosted OSS Memory (`mem0ai/oss`) needs Node + vector store —
 * see README “mem0” for a future sidecar shape.
 */

import type { ApiSettings } from "../types";

const DEFAULT_HOST = "https://api.mem0.ai";
const ANON_USER_KEY = "forknote-mem0-user";
const SEARCH_TOP_K = 5;
const ASSISTANT_MEMORY_MAX = 1200;

export type Mem0Hit = {
  id?: string;
  memory: string;
  score?: number;
};

export function isMem0Enabled(settings: ApiSettings): boolean {
  return Boolean(settings.mem0Enabled && settings.mem0ApiKey?.trim());
}

/** Stable browser-scoped user id when settings.mem0UserId is blank. */
export function resolveMem0UserId(settings: ApiSettings): string {
  const configured = (settings.mem0UserId ?? "").trim();
  if (configured) return configured;
  try {
    const existing = localStorage.getItem(ANON_USER_KEY);
    if (existing?.trim()) return existing.trim();
    const id = `forknote-${crypto.randomUUID()}`;
    localStorage.setItem(ANON_USER_KEY, id);
    return id;
  } catch {
    return "forknote-local";
  }
}

function resolveMem0Host(settings: ApiSettings): string {
  const host = (settings.mem0Host ?? "").trim() || DEFAULT_HOST;
  return host.replace(/\/$/, "");
}

/** Dev proxy avoids browser CORS; mirrors OpenAI `useProxy` behavior. */
function resolveMem0Base(settings: ApiSettings): string {
  if (settings.useProxy) {
    return `${window.location.origin}/mem0`;
  }
  return resolveMem0Host(settings);
}

async function mem0Fetch(
  settings: ApiSettings,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const apiKey = settings.mem0ApiKey!.trim();
  const url = `${resolveMem0Base(settings)}${path.startsWith("/") ? path : `/${path}`}`;
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

function extractMemories(payload: unknown): Mem0Hit[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const list = Array.isArray(root.results)
    ? root.results
    : Array.isArray(root)
      ? root
      : Array.isArray(root.memories)
        ? root.memories
        : [];

  const hits: Mem0Hit[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const text =
      (typeof row.memory === "string" && row.memory) ||
      (typeof row.text === "string" && row.text) ||
      (typeof row.content === "string" && row.content) ||
      "";
    if (!text.trim()) continue;
    hits.push({
      id: typeof row.id === "string" ? row.id : undefined,
      memory: text.trim(),
      score: typeof row.score === "number" ? row.score : undefined,
    });
  }
  return hits;
}

/** Search relevant memories; never throws. */
export async function searchMemories(
  settings: ApiSettings,
  query: string,
  options?: { topK?: number; signal?: AbortSignal },
): Promise<Mem0Hit[]> {
  if (!isMem0Enabled(settings)) return [];
  const q = query.trim();
  if (!q) return [];

  try {
    const userId = resolveMem0UserId(settings);
    const res = await mem0Fetch(settings, "/v3/memories/search/", {
      method: "POST",
      signal: options?.signal,
      body: JSON.stringify({
        query: q,
        output_format: "v1.1",
        top_k: options?.topK ?? SEARCH_TOP_K,
        filters: { user_id: userId },
      }),
    });
    if (!res.ok) {
      console.warn("[mem0] search failed", res.status, await res.text().catch(() => ""));
      return [];
    }
    return extractMemories(await res.json());
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") return [];
    console.warn("[mem0] search error", e);
    return [];
  }
}

export function formatMemoryAddendum(hits: Mem0Hit[]): string | null {
  if (hits.length === 0) return null;
  const lines = hits.map((h, i) => `${i + 1}. ${h.memory}`);
  return [
    "【跨会话记忆 · mem0】（来自用户启用的外部记忆服务；与本会话 localStorage 笔记不同）",
    "- 下列条目可能与当前问题相关；有冲突时以本会话消息为准。",
    "- 不要声称你「天生」记得这些；它们是检索注入的。",
    "",
    ...lines,
  ].join("\n");
}

/** Recall + format for system prompt injection. */
export async function recallMemoryAddendum(
  settings: ApiSettings,
  query: string,
  options?: { signal?: AbortSignal },
): Promise<string | null> {
  const hits = await searchMemories(settings, query, options);
  return formatMemoryAddendum(hits);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

/** Persist a main-turn Q/A pair. Fire-and-forget safe; never throws. */
export async function rememberMainTurn(
  settings: ApiSettings,
  userQuestion: string,
  assistantAnswer: string,
  meta?: { sessionId?: string | null },
): Promise<void> {
  if (!isMem0Enabled(settings)) return;
  const user = userQuestion.trim();
  const assistant = assistantAnswer.trim();
  if (!user || !assistant) return;

  try {
    const userId = resolveMem0UserId(settings);
    const res = await mem0Fetch(settings, "/v3/memories/add/", {
      method: "POST",
      body: JSON.stringify({
        messages: [
          { role: "user", content: user },
          {
            role: "assistant",
            content: truncate(assistant, ASSISTANT_MEMORY_MAX),
          },
        ],
        user_id: userId,
        metadata: {
          source: "forknote-main",
          ...(meta?.sessionId ? { session_id: meta.sessionId } : {}),
        },
      }),
    });
    if (!res.ok) {
      console.warn("[mem0] add failed", res.status, await res.text().catch(() => ""));
    }
  } catch (e) {
    console.warn("[mem0] add error", e);
  }
}

/** Persist an archive snapshot as durable memory. */
export async function rememberArchive(
  settings: ApiSettings,
  archive: { title: string; content: string },
  meta?: { sessionId?: string | null },
): Promise<void> {
  if (!isMem0Enabled(settings)) return;
  const content = archive.content.trim();
  if (!content) return;

  try {
    const userId = resolveMem0UserId(settings);
    const title = archive.title.trim() || "Archive";
    const res = await mem0Fetch(settings, "/v3/memories/add/", {
      method: "POST",
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: `请记住这篇 ForkNote 开发日志归档「${title}」。`,
          },
          {
            role: "assistant",
            content: truncate(content, ASSISTANT_MEMORY_MAX * 2),
          },
        ],
        user_id: userId,
        metadata: {
          source: "forknote-archive",
          title,
          ...(meta?.sessionId ? { session_id: meta.sessionId } : {}),
        },
      }),
    });
    if (!res.ok) {
      console.warn(
        "[mem0] archive add failed",
        res.status,
        await res.text().catch(() => ""),
      );
    }
  } catch (e) {
    console.warn("[mem0] archive add error", e);
  }
}

