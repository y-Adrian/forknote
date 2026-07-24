/**
 * Context compression pack: chat → LLM summarize → SUMMARY / TASKS / DECISIONS.md
 * → inject on next askMain.
 *
 * Storage preference:
 * 1. Bound project via sidecar (`.forknote/` by default)
 * 2. Else session.localStorage draft (`ChatSession.contextMemory`)
 */

import { buildArchiveSource, lastNonEmptyMessageId } from "./archive";
import { getLocale, withReplyLanguage, type Locale } from "./i18n";
import type { ChatMessage as ApiChatMessage } from "./openai";
import { mkdir, readFile, writeFile } from "./sidecar";
import type { ApiSettings, ChatSession, ContextMemoryPack, ThreadRoot } from "../types";

export const MEMORY_FILES = ["SUMMARY.md", "TASKS.md", "DECISIONS.md"] as const;
export type MemoryFileName = (typeof MEMORY_FILES)[number];

/** Project-relative folder holding SUMMARY.md / TASKS.md / DECISIONS.md */
export const DEFAULT_MEMORY_DIR = ".forknote/memory";

const FILE_MAX_INJECT = 1800;
const SECTION_MAX = 700;

export function resolveMemoryDir(settings: ApiSettings): string {
  const dir = (settings.memoryDir ?? "").trim() || DEFAULT_MEMORY_DIR;
  return dir.replace(/^\/+|\/+$/g, "") || DEFAULT_MEMORY_DIR;
}

export function isContextMemoryInjectEnabled(settings: ApiSettings): boolean {
  // Default ON: harmless when no pack exists
  return settings.contextMemoryEnabled !== false;
}

export function isCompressAfterArchiveEnabled(settings: ApiSettings): boolean {
  return Boolean(settings.compressAfterArchive);
}

export const COMPRESS_SYSTEM = `你是项目上下文压缩器。把对话材料压成三份可落地的 Markdown 文件，供下次 Agent 恢复上下文。

硬性输出格式（必须严格遵守，不要省略分隔符）：
===SUMMARY.md===
（项目/会话背景、目标、当前状态；短段落）
===TASKS.md===
（未完成 / 进行中 / 已完成任务；用 - [ ] / - [x] 清单）
===DECISIONS.md===
（已确认决策、约束、否决项；条目化）

规则：
1. 只依据材料，不编造。
2. 若提供了「既有文件」，在其基础上更新，保留仍有效的条目，删掉已过时项。
3. 简明；每份建议不超过 ~40 行。
4. 不要输出分隔符以外的前言/后记。`;

export function compressSystemPrompt(locale: Locale = getLocale()): string {
  return withReplyLanguage(COMPRESS_SYSTEM, locale);
}

export function compressUserPrompt(
  source: string,
  existing: ContextMemoryPack | null,
  locale: Locale = getLocale(),
): string {
  const prior =
    existing && (existing.summary || existing.tasks || existing.decisions)
      ? [
          "【既有文件】",
          "===SUMMARY.md===",
          existing.summary.trim() || "（空）",
          "===TASKS.md===",
          existing.tasks.trim() || "（空）",
          "===DECISIONS.md===",
          existing.decisions.trim() || "（空）",
          "",
        ].join("\n")
      : "【既有文件】无\n\n";

  if (locale === "zh") {
    return `${prior}请根据以下原始对话材料更新三份文件：\n\n${source}`;
  }
  return `${prior}Update the three files from this conversation material:\n\n${source}`;
}

export function parseCompressedOutput(raw: string): ContextMemoryPack {
  const text = raw.replace(/\r\n/g, "\n").trim();
  const extract = (name: MemoryFileName): string => {
    const re = new RegExp(
      `===\\s*${name.replace(".", "\\.")}\\s*===\\s*([\\s\\S]*?)(?===\\s*\\w+\\.md\\s*===|$)`,
      "i",
    );
    const m = text.match(re);
    if (m?.[1]) return m[1].trim();
    return "";
  };

  let summary = extract("SUMMARY.md");
  let tasks = extract("TASKS.md");
  let decisions = extract("DECISIONS.md");

  // Fallback: if model ignored delimiters, park everything in SUMMARY
  if (!summary && !tasks && !decisions && text) {
    summary = text;
  }

  return {
    summary,
    tasks,
    decisions,
    updatedAt: Date.now(),
    storage: "local",
  };
}

function memoryPath(dir: string, file: MemoryFileName): string {
  return `${dir}/${file}`;
}

export async function loadContextMemoryPack(options: {
  settings: ApiSettings;
  session?: ChatSession | null;
  projectRoot?: string | null;
  sidecarUrl: string;
  signal?: AbortSignal;
}): Promise<ContextMemoryPack | null> {
  const { settings, session, projectRoot, sidecarUrl, signal } = options;
  const dir = resolveMemoryDir(settings);

  if (projectRoot) {
    try {
      const [summary, tasks, decisions] = await Promise.all(
        MEMORY_FILES.map(async (file) => {
          try {
            const res = await readFile(memoryPath(dir, file), sidecarUrl, signal);
            return res.content ?? "";
          } catch {
            return "";
          }
        }),
      );
      if (summary.trim() || tasks.trim() || decisions.trim()) {
        return {
          summary,
          tasks,
          decisions,
          updatedAt: Date.now(),
          storage: "project",
          dir,
        };
      }
    } catch {
      // fall through to session draft
    }
  }

  const local = session?.contextMemory;
  if (
    local &&
    (local.summary?.trim() || local.tasks?.trim() || local.decisions?.trim())
  ) {
    return { ...local, storage: "local" };
  }
  return null;
}

export async function saveContextMemoryPack(options: {
  pack: ContextMemoryPack;
  settings: ApiSettings;
  projectRoot?: string | null;
  sidecarUrl: string;
  signal?: AbortSignal;
}): Promise<ContextMemoryPack> {
  const { settings, projectRoot, sidecarUrl, signal } = options;
  const dir = resolveMemoryDir(settings);
  const pack: ContextMemoryPack = {
    ...options.pack,
    updatedAt: Date.now(),
    dir,
  };

  if (projectRoot) {
    try {
      await mkdir(dir, sidecarUrl, signal);
      await Promise.all([
        writeFile(memoryPath(dir, "SUMMARY.md"), pack.summary, sidecarUrl, signal),
        writeFile(memoryPath(dir, "TASKS.md"), pack.tasks, sidecarUrl, signal),
        writeFile(
          memoryPath(dir, "DECISIONS.md"),
          pack.decisions,
          sidecarUrl,
          signal,
        ),
      ]);
      return { ...pack, storage: "project" };
    } catch (e) {
      console.warn("[contextMemory] project write failed; keeping local", e);
    }
  }

  return { ...pack, storage: "local" };
}

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^\p{L}\p{N}_/-]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

/** Local fallback: keyword-rank chunks from the three MD files. */
export function selectRelevantMemoryExcerpts(
  pack: ContextMemoryPack,
  query: string,
): string {
  const tokens = tokenize(query);
  const sections: { title: string; body: string; score: number }[] = [
    { title: "SUMMARY.md", body: pack.summary, score: 0 },
    { title: "TASKS.md", body: pack.tasks, score: 0 },
    { title: "DECISIONS.md", body: pack.decisions, score: 0 },
  ];

  for (const sec of sections) {
    if (!sec.body.trim()) continue;
    const lower = sec.body.toLowerCase();
    if (tokens.length === 0) {
      sec.score = 1;
      continue;
    }
    for (const t of tokens) {
      if (lower.includes(t)) sec.score += 2;
    }
    // Prefer non-empty files slightly
    sec.score += 0.5;
  }

  const ranked = sections
    .filter((s) => s.body.trim() && s.score > 0)
    .sort((a, b) => b.score - a.score);

  // If nothing matched, still inject condensed SUMMARY + TASKS
  const picked =
    ranked.length > 0
      ? ranked.slice(0, 3)
      : sections.filter((s) => s.body.trim()).slice(0, 2);

  if (picked.length === 0) return "";

  return picked
    .map((s) => {
      const body =
        s.body.length > SECTION_MAX
          ? `${s.body.slice(0, SECTION_MAX)}…`
          : s.body;
      return `### ${s.title}\n${body}`;
    })
    .join("\n\n")
    .slice(0, FILE_MAX_INJECT);
}

export function formatLocalMemoryAddendum(
  pack: ContextMemoryPack,
  query: string,
): string | null {
  const excerpts = selectRelevantMemoryExcerpts(pack, query);
  if (!excerpts.trim()) return null;
  const where =
    pack.storage === "project"
      ? `项目目录 ${pack.dir || DEFAULT_MEMORY_DIR}/`
      : "本笔记 localStorage 草稿";
  return [
    `【项目记忆包 · 本地】（来自 ${where} 的 SUMMARY / TASKS / DECISIONS）`,
    "- 下列为压缩后的跨轮上下文；与当前会话消息冲突时以当前会话为准。",
    "- 不要声称你「天生」记得这些；它们是注入的。",
    "",
    excerpts,
  ].join("\n");
}

/**
 * Load local MD pack (+ keyword filter) for askMain injection.
 */
export async function buildAgentMemoryAddendum(options: {
  settings: ApiSettings;
  query: string;
  session?: ChatSession | null;
  projectRoot?: string | null;
  sidecarUrl: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  const { settings, query, session, projectRoot, sidecarUrl, signal } = options;
  if (!isContextMemoryInjectEnabled(settings)) return null;

  const pack = await loadContextMemoryPack({
    settings,
    session,
    projectRoot,
    sidecarUrl,
    signal,
  });
  if (!pack) return null;
  return formatLocalMemoryAddendum(pack, query);
}

export function compressChatMessages(
  source: string,
  existing: ContextMemoryPack | null,
  locale: Locale = getLocale(),
): ApiChatMessage[] {
  return [
    { role: "system", content: compressSystemPrompt(locale) },
    { role: "user", content: compressUserPrompt(source, existing, locale) },
  ];
}

export function buildCompressSource(thread: ThreadRoot): string {
  return buildArchiveSource(thread);
}

export function packThroughMessageId(thread: ThreadRoot): string | null {
  return lastNonEmptyMessageId(thread);
}
