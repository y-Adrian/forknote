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
import {
  buildIncludedFilesAddendum,
  extractAtFileMentions,
  mergeIncludePaths,
} from "./repoContext";
import {
  isMemoryLayerPreferencesEnabled,
  isMemoryLayerProjectEnabled,
  isMemoryLayerSessionEnabled,
} from "./settings";
import { mkdir, readFile, writeFile } from "./sidecar";
import {
  formatPreferencesAddendum,
  loadUserPreferences,
} from "./userPreferences";
import { formatPolicyForAgent } from "./policy";
import type {
  ApiSettings,
  ChatSession,
  ContextMemoryPack,
  SessionMemory,
  ThreadRoot,
} from "../types";

export const MEMORY_FILES = ["SUMMARY.md", "TASKS.md", "DECISIONS.md"] as const;
export type MemoryFileName = (typeof MEMORY_FILES)[number];
/** Agent-maintained coding conventions / failures (not LLM-compressed). */
export const CODING_MEMORY_FILE = "CODING.md";

/** Project-relative folder holding SUMMARY.md / TASKS.md / DECISIONS.md / CODING.md */
export const DEFAULT_MEMORY_DIR = ".forknote/memory";

const FILE_MAX_INJECT = 1800;
const SECTION_MAX = 700;
const CHUNK_MAX = 420;
const CHUNK_TOP_K = 5;

export function resolveMemoryDir(settings: ApiSettings): string {
  const dir = (settings.memoryDir ?? "").trim() || DEFAULT_MEMORY_DIR;
  return dir.replace(/^\/+|\/+$/g, "") || DEFAULT_MEMORY_DIR;
}

export function isContextMemoryInjectEnabled(settings: ApiSettings): boolean {
  return isMemoryLayerProjectEnabled(settings);
}

export function formatSessionMemoryAddendum(
  memory: SessionMemory | null | undefined,
): string | null {
  const summary = memory?.summary?.trim();
  if (!summary) return null;
  return [
    "【本笔记会话记忆 · Session】",
    "- 仅当前笔记的工作摘要；与项目记忆包 / 用户偏好冲突时以当前会话消息为准。",
    "",
    summary.length > 1800 ? `${summary.slice(0, 1800)}…` : summary,
  ].join("\n");
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
    // Lookahead must use four "=" after "(?" so the engine sees "(?=" + "==="
    // (three delimiter equals). Three equals would be parsed as "(?=" + "==".
    const re = new RegExp(
      `===\\s*${name.replace(".", "\\.")}\\s*===\\s*([\\s\\S]*?)(?====\\s*\\w+\\.md\\s*===|$)`,
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

function memoryPath(
  dir: string,
  file: MemoryFileName | typeof CODING_MEMORY_FILE,
): string {
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
      const [summary, tasks, decisions, coding] = await Promise.all([
        ...MEMORY_FILES.map(async (file) => {
          try {
            const res = await readFile(memoryPath(dir, file), sidecarUrl, signal);
            return res.content ?? "";
          } catch {
            return "";
          }
        }),
        (async () => {
          try {
            const res = await readFile(
              memoryPath(dir, CODING_MEMORY_FILE),
              sidecarUrl,
              signal,
            );
            return res.content ?? "";
          } catch {
            return "";
          }
        })(),
      ]);
      if (
        summary.trim() ||
        tasks.trim() ||
        decisions.trim() ||
        coding.trim()
      ) {
        return {
          summary,
          tasks,
          decisions,
          coding,
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
    (local.summary?.trim() ||
      local.tasks?.trim() ||
      local.decisions?.trim() ||
      local.coding?.trim())
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
        writeFile(
          memoryPath(dir, CODING_MEMORY_FILE),
          pack.coding ?? "",
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

type MemoryChunk = {
  source: string;
  body: string;
  tokens: string[];
};

/** Split a memory MD file into heading / bullet / paragraph chunks. */
export function chunkMemoryDocument(
  source: string,
  body: string,
): MemoryChunk[] {
  const text = body.replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const rawParts = text
    .split(/\n(?=#{1,3}\s|\s*[-*+]\s|\s*\d+\.\s)/)
    .flatMap((block) => {
      const trimmed = block.trim();
      if (!trimmed) return [];
      if (trimmed.length <= CHUNK_MAX) return [trimmed];
      // Long block without headings: split on blank lines, then hard-wrap.
      const paras = trimmed.split(/\n{2,}/);
      const out: string[] = [];
      for (const p of paras) {
        const t = p.trim();
        if (!t) continue;
        if (t.length <= CHUNK_MAX) {
          out.push(t);
          continue;
        }
        for (let i = 0; i < t.length; i += CHUNK_MAX) {
          out.push(t.slice(i, i + CHUNK_MAX));
        }
      }
      return out;
    });

  return rawParts.map((part) => ({
    source,
    body: part,
    tokens: tokenize(part),
  }));
}

function termFreq(tokens: string[], term: string): number {
  let n = 0;
  for (const t of tokens) {
    if (t === term) n += 1;
    else if (t.includes(term) || term.includes(t)) n += 0.5;
  }
  return n;
}

/**
 * Lightweight BM25-ish rank over memory chunks (no external deps).
 * Falls back to a light prior when the query has no tokens.
 */
function scoreChunkBm25(
  chunk: MemoryChunk,
  queryTokens: string[],
  df: Map<string, number>,
  docCount: number,
  avgdl: number,
): number {
  if (queryTokens.length === 0) {
    // Prefer SUMMARY slightly when no query signal
    return chunk.source === "SUMMARY.md" ? 1.2 : 1;
  }

  const k1 = 1.2;
  const b = 0.75;
  const dl = Math.max(chunk.tokens.length, 1);
  let score = 0;

  for (const term of queryTokens) {
    const tf = termFreq(chunk.tokens, term);
    if (tf <= 0) continue;
    const n = df.get(term) ?? 0;
    const idf = Math.log(1 + (docCount - n + 0.5) / (n + 0.5));
    const denom = tf + k1 * (1 - b + b * (dl / Math.max(avgdl, 1)));
    score += idf * ((tf * (k1 + 1)) / denom);
  }

  // Soft boosts
  if (chunk.source === "CODING.md") score *= 1.25;
  if (chunk.source === "TASKS.md") score *= 1.05;
  if (chunk.source === "DECISIONS.md") score *= 1.08;
  return score;
}

/** Local fallback: chunk + BM25-rank excerpts from the memory MD files. */
export function selectRelevantMemoryExcerpts(
  pack: ContextMemoryPack,
  query: string,
): string {
  const queryTokens = tokenize(query);
  const sections: { title: string; body: string }[] = [
    { title: "CODING.md", body: pack.coding ?? "" },
    { title: "SUMMARY.md", body: pack.summary },
    { title: "TASKS.md", body: pack.tasks },
    { title: "DECISIONS.md", body: pack.decisions },
  ];

  const chunks = sections.flatMap((s) =>
    chunkMemoryDocument(s.title, s.body),
  );
  if (chunks.length === 0) return "";

  const df = new Map<string, number>();
  for (const term of new Set(queryTokens)) {
    let n = 0;
    for (const c of chunks) {
      if (termFreq(c.tokens, term) > 0) n += 1;
    }
    df.set(term, n);
  }
  const avgdl =
    chunks.reduce((sum, c) => sum + c.tokens.length, 0) /
    Math.max(chunks.length, 1);

  const ranked = chunks
    .map((c) => ({
      ...c,
      score: scoreChunkBm25(c, queryTokens, df, chunks.length, avgdl),
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  const picked =
    ranked.length > 0
      ? ranked.slice(0, CHUNK_TOP_K)
      : chunks.slice(0, Math.min(3, chunks.length)).map((c) => ({
          ...c,
          score: 1,
        }));

  // Group by source for readable injection
  const bySource = new Map<string, string[]>();
  for (const p of picked) {
    const list = bySource.get(p.source) ?? [];
    const body =
      p.body.length > SECTION_MAX
        ? `${p.body.slice(0, SECTION_MAX)}…`
        : p.body;
    list.push(body);
    bySource.set(p.source, list);
  }

  const order = ["CODING.md", "SUMMARY.md", "TASKS.md", "DECISIONS.md"];
  const blocks: string[] = [];
  for (const title of order) {
    const parts = bySource.get(title);
    if (!parts?.length) continue;
    blocks.push(`### ${title}\n${parts.join("\n\n")}`);
  }

  return blocks.join("\n\n").slice(0, FILE_MAX_INJECT);
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
    `【项目记忆包 · 本地】（来自 ${where} 的 CODING / SUMMARY / TASKS / DECISIONS）`,
    "- 下列为压缩后的跨轮上下文；与当前会话消息冲突时以当前会话为准。",
    "- CODING.md 存放编码约定与失败教训，优先遵守。",
    "- 不要声称你「天生」记得这些；它们是注入的。",
    "",
    excerpts,
  ].join("\n");
}

/** Append a dated note to CODING.md (project memory). */
export async function appendCodingMemoryNote(options: {
  note: string;
  settings: ApiSettings;
  session?: ChatSession | null;
  projectRoot?: string | null;
  sidecarUrl: string;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; path: string; coding: string }> {
  const note = options.note.trim();
  if (!note) {
    throw new Error("note is required");
  }
  const dir = resolveMemoryDir(options.settings);
  const path = memoryPath(dir, CODING_MEMORY_FILE);
  const existing =
    (await loadContextMemoryPack(options)) ??
    ({
      summary: "",
      tasks: "",
      decisions: "",
      coding: "",
      updatedAt: Date.now(),
      storage: options.projectRoot ? "project" : "local",
      dir,
    } satisfies ContextMemoryPack);

  const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");
  const entry = `- [${stamp}] ${note.replace(/\s+/g, " ").trim()}`;
  const coding = [existing.coding?.trim(), entry].filter(Boolean).join("\n\n");
  const saved = await saveContextMemoryPack({
    pack: { ...existing, coding },
    settings: options.settings,
    projectRoot: options.projectRoot,
    sidecarUrl: options.sidecarUrl,
    signal: options.signal,
  });
  return { ok: true, path, coding: saved.coding ?? coding };
}

/**
 * Compose injectable memory layers for askMain.
 */
export async function buildAgentMemoryAddendum(options: {
  settings: ApiSettings;
  query: string;
  session?: ChatSession | null;
  projectRoot?: string | null;
  sidecarUrl: string;
  signal?: AbortSignal;
  includeFiles?: string[];
}): Promise<string | null> {
  const {
    settings, query, session, projectRoot, sidecarUrl, signal, includeFiles = [],
  } = options;
  const blocks: string[] = [];
  if (isMemoryLayerPreferencesEnabled(settings)) {
    const prefs = formatPreferencesAddendum(loadUserPreferences());
    if (prefs) blocks.push(prefs);
  }
  if (isMemoryLayerProjectEnabled(settings)) {
    const pack = await loadContextMemoryPack({
      settings, session, projectRoot, sidecarUrl, signal,
    });
    if (pack) {
      const project = formatLocalMemoryAddendum(pack, query);
      if (project) blocks.push(project);
    }
  }
  if (isMemoryLayerSessionEnabled(settings)) {
    const sessionBlock = formatSessionMemoryAddendum(session?.sessionMemory);
    if (sessionBlock) blocks.push(sessionBlock);
  }
  const policyBlock = formatPolicyForAgent(session?.feedbackPolicy);
  if (policyBlock) blocks.push(policyBlock);
  if (projectRoot) {
    const paths = mergeIncludePaths(includeFiles, extractAtFileMentions(query));
    if (paths.length > 0) {
      const files = await buildIncludedFilesAddendum({
        paths, projectRoot, sidecarUrl, signal,
      });
      if (files) blocks.push(files);
    }
  }
  if (blocks.length === 0) return null;
  return blocks.join("\n\n");
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

/**
 * When Compress runs immediately after Archive, feed the archive draft instead of
 * re-scanning the same raw thread (avoids a second full-thread summarization pass).
 */
export function formatArchiveDraftAsCompressSource(archiveMarkdown: string): string {
  const body = archiveMarkdown.trim();
  if (!body) return "";
  return [
    "【材料说明】以下为已生成的开发日志归档草稿（非原始聊天记录）。请据此更新 SUMMARY / TASKS / DECISIONS，勿假设还有更完整的原始对话。",
    "",
    body,
  ].join("\n");
}

export function packThroughMessageId(thread: ThreadRoot): string | null {
  return lastNonEmptyMessageId(thread);
}
