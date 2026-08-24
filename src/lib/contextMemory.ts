/**
 * Context compression pack: chat → LLM summarize → SUMMARY / TASKS / DECISIONS.md
 * → inject on next askMain.
 *
 * Storage preference:
 * 1. Bound project via sidecar (`.forknote/` by default)
 * 2. Else session.localStorage draft (`ChatSession.contextMemory`)
 */

import {
  buildArchiveSource,
  buildCompressDeltaAfterArchive,
  capArchiveSource,
  lastNonEmptyMessageId,
  resolveBaseArchive,
} from "./archive";
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
import { assembleMemoryLayers } from "./memoryBudget";
import {
  formatPendingUnsureAddendum,
  formatToolPreferenceHint,
  formatUnsureCautionAddendum,
} from "./decisionFeedback";
import { formatSessionCorrectionAddendum } from "./sessionCorrection";
import { formatUserModelForAgent } from "./userModel";
import { resolveUserModelForAgent } from "./userModelStore";
import type {
  ApiSettings,
  ArchiveSnapshot,
  ChatSession,
  ContextMemoryPack,
  FeedbackEvent,
  SessionMemory,
  ThreadRoot,
} from "../types";

export const MEMORY_FILES = ["SUMMARY.md", "TASKS.md", "DECISIONS.md"] as const;
export type MemoryFileName = (typeof MEMORY_FILES)[number];
/** Deterministic project overview written on project bind. */
export const PROJECT_MEMORY_FILE = "PROJECT.md";
/** Agent-maintained coding conventions / failures (not LLM-compressed). */
export const CODING_MEMORY_FILE = "CODING.md";

/** Project-relative folder holding PROJECT.md / SUMMARY.md / TASKS.md / DECISIONS.md / CODING.md */
export const DEFAULT_MEMORY_DIR = ".forknote/memory";

const FILE_MAX_INJECT = 3000;
const CORE_MEMORY_SECTION_MAX = 520;
const SECTION_MAX = 560;
const CHUNK_MAX = 420;
/** Keep memory injection lean — extra chunks dilute the user's latest goal. */
const CHUNK_TOP_K = 3;
const MAX_CODING_MEMORY_ENTRIES = 80;

export function resolveMemoryDir(
  settings: ApiSettings,
  session?: ChatSession | null,
): string {
  const dir = (settings.memoryDir ?? "").trim() || DEFAULT_MEMORY_DIR;
  const base = dir.replace(/^\/+|\/+$/g, "") || DEFAULT_MEMORY_DIR;
  if (!isSessionShareMemoryEnabled(session) && session?.id) {
    const id =
      String(session.id).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "note";
    return `${base}/sessions/${id}`;
  }
  return base;
}

/** Default true — unset means share the project memory pack with other sessions. */
export function isSessionShareMemoryEnabled(
  session?: ChatSession | null,
): boolean {
  return session?.shareMemory !== false;
}

/** True when a bound project uses the shared (non-session) memory folder. */
export function shouldUseSharedProjectMemory(
  session?: ChatSession | null,
  projectRoot?: string | null,
): boolean {
  return (
    Boolean(projectRoot?.trim()) && isSessionShareMemoryEnabled(session)
  );
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
  file: MemoryFileName | typeof PROJECT_MEMORY_FILE | typeof CODING_MEMORY_FILE,
): string {
  return `${dir}/${file}`;
}

/**
 * Prefer the newest filesystem mtime from pack files; fall back to `now`
 * when no valid mtimes are available (e.g. older sidecars).
 */
export function resolveMemoryPackUpdatedAt(
  mtimes: Array<number | null | undefined>,
  now: number = Date.now(),
): number {
  let max = 0;
  for (const t of mtimes) {
    if (typeof t === "number" && Number.isFinite(t) && t > max) max = t;
  }
  return max > 0 ? max : now;
}

type MemoryFileRead = { content: string; mtimeMs?: number };

async function readMemoryFile(
  dir: string,
  file: MemoryFileName | typeof PROJECT_MEMORY_FILE | typeof CODING_MEMORY_FILE,
  sidecarUrl: string,
  signal: AbortSignal | undefined,
  projectRoot: string,
): Promise<MemoryFileRead> {
  try {
    const res = await readFile(
      memoryPath(dir, file),
      sidecarUrl,
      signal,
      undefined,
      projectRoot,
    );
    return {
      content: res.content ?? "",
      mtimeMs:
        typeof res.mtimeMs === "number" && Number.isFinite(res.mtimeMs)
          ? res.mtimeMs
          : undefined,
    };
  } catch {
    return { content: "" };
  }
}

export async function loadContextMemoryPack(options: {
  settings: ApiSettings;
  session?: ChatSession | null;
  projectRoot?: string | null;
  sidecarUrl: string;
  signal?: AbortSignal;
}): Promise<ContextMemoryPack | null> {
  const { settings, session, projectRoot, sidecarUrl, signal } = options;
  const dir = resolveMemoryDir(settings, session);

  if (projectRoot) {
    try {
      const [projectRes, summaryRes, tasksRes, decisionsRes, codingRes] = await Promise.all([
        readMemoryFile(dir, PROJECT_MEMORY_FILE, sidecarUrl, signal, projectRoot),
        readMemoryFile(dir, "SUMMARY.md", sidecarUrl, signal, projectRoot),
        readMemoryFile(dir, "TASKS.md", sidecarUrl, signal, projectRoot),
        readMemoryFile(dir, "DECISIONS.md", sidecarUrl, signal, projectRoot),
        readMemoryFile(dir, CODING_MEMORY_FILE, sidecarUrl, signal, projectRoot),
      ]);
      const project = projectRes.content;
      const summary = summaryRes.content;
      const tasks = tasksRes.content;
      const decisions = decisionsRes.content;
      const coding = codingRes.content;
      if (
        project.trim() ||
        summary.trim() ||
        tasks.trim() ||
        decisions.trim() ||
        coding.trim()
      ) {
        return {
          project,
          summary,
          tasks,
          decisions,
          coding,
          // Only content-bearing files contribute to freshness.
          updatedAt: resolveMemoryPackUpdatedAt([
            project.trim() ? projectRes.mtimeMs : undefined,
            summary.trim() ? summaryRes.mtimeMs : undefined,
            tasks.trim() ? tasksRes.mtimeMs : undefined,
            decisions.trim() ? decisionsRes.mtimeMs : undefined,
            coding.trim() ? codingRes.mtimeMs : undefined,
          ]),
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
      local.project?.trim() ||
      local.coding?.trim())
  ) {
    return { ...local, storage: "local" };
  }
  return null;
}

export async function saveContextMemoryPack(options: {
  pack: ContextMemoryPack;
  settings: ApiSettings;
  session?: ChatSession | null;
  projectRoot?: string | null;
  sidecarUrl: string;
  signal?: AbortSignal;
}): Promise<ContextMemoryPack> {
  const { settings, session, projectRoot, sidecarUrl, signal } = options;
  const dir = resolveMemoryDir(settings, session);
  const pack: ContextMemoryPack = {
    ...options.pack,
    updatedAt: Date.now(),
    dir,
  };

  if (projectRoot) {
    try {
      await mkdir(dir, sidecarUrl, signal, projectRoot);
      const writes = [
        writeFile(
          memoryPath(dir, "SUMMARY.md"),
          pack.summary,
          sidecarUrl,
          signal,
          projectRoot,
        ),
        writeFile(
          memoryPath(dir, "TASKS.md"),
          pack.tasks,
          sidecarUrl,
          signal,
          projectRoot,
        ),
        writeFile(
          memoryPath(dir, "DECISIONS.md"),
          pack.decisions,
          sidecarUrl,
          signal,
          projectRoot,
        ),
        writeFile(
          memoryPath(dir, CODING_MEMORY_FILE),
          pack.coding ?? "",
          sidecarUrl,
          signal,
          projectRoot,
        ),
      ];
      if (pack.project != null) {
        writes.push(
          writeFile(
            memoryPath(dir, PROJECT_MEMORY_FILE),
            pack.project,
            sidecarUrl,
            signal,
            projectRoot,
          ),
        );
      }
      await Promise.all(writes);
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

function firstMemoryChunk(source: string, body: string): string | null {
  const chunks = chunkMemoryDocument(source, body)
    .map((c) => c.body.trim())
    .filter(Boolean);
  if (chunks.length === 0) return null;
  let out = "";
  for (const chunk of chunks) {
    const next = out ? `${out}\n${chunk}` : chunk;
    if (next.length > CORE_MEMORY_SECTION_MAX) break;
    out = next;
  }
  if (!out) out = chunks[0]!.slice(0, CORE_MEMORY_SECTION_MAX);
  return out.length > CORE_MEMORY_SECTION_MAX
    ? `${out.slice(0, CORE_MEMORY_SECTION_MAX)}…`
    : out;
}

/** Small always-on context so lexical ranking cannot drop core constraints. */
export function selectCoreMemoryExcerpts(pack: ContextMemoryPack): string {
  const sections: Array<{ title: string; body: string | undefined }> = [
    { title: PROJECT_MEMORY_FILE, body: pack.project },
    { title: CODING_MEMORY_FILE, body: pack.coding },
    { title: "DECISIONS.md", body: pack.decisions },
  ];
  const blocks: string[] = [];
  for (const section of sections) {
    const body = firstMemoryChunk(section.title, section.body ?? "");
    if (body) blocks.push(`### ${section.title}\n${body}`);
  }
  return blocks.join("\n\n");
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
  if (chunk.source === PROJECT_MEMORY_FILE) score *= 1.35;
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
    { title: PROJECT_MEMORY_FILE, body: pack.project ?? "" },
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

  const order = [PROJECT_MEMORY_FILE, "CODING.md", "SUMMARY.md", "TASKS.md", "DECISIONS.md"];
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
  const core = selectCoreMemoryExcerpts(pack);
  const relevant = selectRelevantMemoryExcerpts(pack, query);
  const excerpts = [
    core ? `## 核心记忆\n${core}` : "",
    relevant ? `## 相关检索\n${relevant}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, FILE_MAX_INJECT);
  if (!excerpts.trim()) return null;
  const where =
    pack.storage === "project"
      ? `项目目录 ${pack.dir || DEFAULT_MEMORY_DIR}/`
      : "本笔记 localStorage 草稿";
  return [
    `【项目记忆包 · 本地】（来自 ${where} 的 PROJECT / CODING / SUMMARY / TASKS / DECISIONS）`,
    "- 下列为压缩后的跨轮上下文；与当前会话消息冲突时以当前会话为准。",
    "- PROJECT.md 存放自动项目学习概览，用于快速恢复项目结构与入口。",
    "- CODING.md 存放编码约定与失败教训，优先遵守。",
    "- 仅作背景参考：必须对准用户最新目标作答；勿因记忆包展开旧任务、冗长背景或无关「顺便」工作。",
    "- 不要声称你「天生」记得这些；它们是注入的。",
    "",
    excerpts,
  ].join("\n");
}

export function normalizeCodingMemoryNote(note: string): string {
  return note
    .replace(/^\s*[-*]\s*(?:\[[^\]]+\]\s*)?/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function splitCodingMemoryEntries(coding: string): string[] {
  return coding
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function mergeCodingMemoryNote(
  existingCoding: string | null | undefined,
  note: string,
  now: number = Date.now(),
): string {
  const normalizedNote = normalizeCodingMemoryNote(note);
  if (!normalizedNote) return (existingCoding ?? "").trim();

  const entries = splitCodingMemoryEntries(existingCoding ?? "");
  if (entries.some((entry) => normalizeCodingMemoryNote(entry) === normalizedNote)) {
    return entries.slice(-MAX_CODING_MEMORY_ENTRIES).join("\n\n");
  }

  const stamp = new Date(now).toISOString().slice(0, 19).replace("T", " ");
  const entry = `- [${stamp}] ${note.replace(/\s+/g, " ").trim()}`;
  return [...entries, entry].slice(-MAX_CODING_MEMORY_ENTRIES).join("\n\n");
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
  const dir = resolveMemoryDir(options.settings, options.session);
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

  const coding = mergeCodingMemoryNote(existing.coding, note);
  const saved = await saveContextMemoryPack({
    pack: { ...existing, coding },
    settings: options.settings,
    session: options.session,
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
  /** Skip SUMMARY/TASKS/DECISIONS so chat-only asks are not drowned by old work. */
  omitProjectPack?: boolean;
}): Promise<string | null> {
  const {
    settings, query, session, projectRoot, sidecarUrl, signal, includeFiles = [],
    omitProjectPack = false,
  } = options;
  const layers: Array<{ kind: "preferences" | "longTerm" | "session" | "files" | "working"; text: string }> = [];
  const locale = getLocale() === "zh" ? "zh" : "en";
  if (isMemoryLayerPreferencesEnabled(settings)) {
    const prefs = formatPreferencesAddendum(loadUserPreferences());
    if (prefs) layers.push({ kind: "preferences", text: prefs });
    const userModel = resolveUserModelForAgent(session?.feedbackLog);
    const userModelText = formatUserModelForAgent(userModel);
    if (userModelText) layers.push({ kind: "preferences", text: userModelText });
    const toolHint = formatToolPreferenceHint(userModel.preferences);
    if (toolHint) layers.push({ kind: "preferences", text: toolHint });
  }
  // Unsure clarify routing — inject pending queue + caution when ratio is high.
  {
    const pending = formatPendingUnsureAddendum(session?.feedbackLog, locale);
    if (pending) layers.push({ kind: "working", text: pending });
    for (const kind of [
      "point_verdict",
      "tool_selection",
      "plan_approval",
    ] as const) {
      const caution = formatUnsureCautionAddendum(session?.feedbackLog, kind, {
        locale,
      });
      if (caution) layers.push({ kind: "working", text: caution });
    }
  }
  // Session-scoped immediate corrections (same-conversation rejects/flips).
  {
    const correction = formatSessionCorrectionAddendum(
      session?.feedbackLog,
      locale,
    );
    if (correction) layers.push({ kind: "working", text: correction });
  }
  if (isMemoryLayerProjectEnabled(settings) && !omitProjectPack) {
    const pack = await loadContextMemoryPack({
      settings, session, projectRoot, sidecarUrl, signal,
    });
    if (pack) {
      const project = formatLocalMemoryAddendum(pack, query);
      if (project) layers.push({ kind: "longTerm", text: project });
    }
  }
  if (isMemoryLayerSessionEnabled(settings)) {
    const sessionBlock = formatSessionMemoryAddendum(session?.sessionMemory);
    if (sessionBlock) layers.push({ kind: "session", text: sessionBlock });
  }
  const policyBlock = formatPolicyForAgent(session?.feedbackPolicy);
  if (policyBlock) layers.push({ kind: "preferences", text: policyBlock });
  if (projectRoot) {
    const paths = mergeIncludePaths(includeFiles, extractAtFileMentions(query));
    if (paths.length > 0) {
      const files = await buildIncludedFilesAddendum({
        paths, projectRoot, sidecarUrl, signal,
      });
      if (files) layers.push({ kind: "files", text: files });
    }
  }
  return assembleMemoryLayers(layers);
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

export function buildCompressSource(
  thread: ThreadRoot,
  options?: {
    feedbackLog?: FeedbackEvent[] | null;
    /** Prefer this archive draft (+ post-archive delta) over raw full thread. */
    archive?: ArchiveSnapshot | null;
  },
): string {
  const archive = options?.archive ?? null;
  if (archive?.content.trim()) {
    const draftPart = formatArchiveDraftAsCompressSource(archive.content);
    const delta = buildCompressDeltaAfterArchive(archive, thread, {
      feedbackLog: options?.feedbackLog,
    });
    return capArchiveSource(
      delta ? `${draftPart}\n\n${delta}` : draftPart,
    );
  }
  return capArchiveSource(
    buildArchiveSource(thread, { feedbackLog: options?.feedbackLog }),
  );
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

/** Resolve best archive to reuse for Compress (active, else latest). */
export function resolveCompressArchive(
  session?: ChatSession | null,
): ArchiveSnapshot | null {
  return resolveBaseArchive(session?.archives, session?.activeArchiveId);
}

export function packThroughMessageId(thread: ThreadRoot): string | null {
  return lastNonEmptyMessageId(thread);
}
