/**
 * Lightweight repo awareness: @file mentions + recent path hints.
 * Not a full IDE index — shallow list + recent paths only.
 */

import {
  listDir,
  readFile,
  semanticSearch,
  type FsEntry,
  type SemanticHit,
} from "./sidecar";

export const RECENT_FILES_STORAGE_KEY = "forknote-recent-files";
const MAX_RECENT = 24;
const MAX_HINTS = 20;
const FILE_INJECT_MAX = 4500;
const MAX_INCLUDE_FILES = 4;
const MAX_AUTO_DISCOVERED = 3;

/** How long a shallow listing stays reusable per project root. */
export const PROJECT_FILE_HINT_TTL_MS = 8_000;
/** Coalesce bursty @mentions before kicking off a cold/stale refresh. */
export const PROJECT_FILE_HINT_DEBOUNCE_MS = 120;

const SKIP_DIR = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
  ".cache",
]);

type HintCacheEntry = {
  files: string[];
  at: number;
  inflight: Promise<string[]> | null;
};

const hintCache = new Map<string, HintCacheEntry>();
let hintNow: () => number = () => Date.now();
let hintListDir = listDir;
/** Counts collectShallowFiles invocations (each fans out multiple listDir calls). */
let hintRefreshCount = 0;

function hintCacheKey(sidecarUrl: string, projectRoot: string): string {
  return `${sidecarUrl.replace(/\/$/, "")}\0${projectRoot}`;
}

/** Test seam — restore with `() => Date.now()` when done. */
export function setProjectFileHintNowForTests(fn: () => number): void {
  hintNow = fn;
}

/** Test seam — restore with the real `listDir` when done. */
export function setProjectFileHintListDirForTests(
  fn: typeof listDir,
): void {
  hintListDir = fn;
}

export function peekProjectFileHintRefreshCount(): number {
  return hintRefreshCount;
}

export function peekProjectFileHintCache(
  projectRoot: string,
  sidecarUrl = "/sidecar",
  ttlMs = PROJECT_FILE_HINT_TTL_MS,
): string[] | undefined {
  const hit = hintCache.get(hintCacheKey(sidecarUrl, projectRoot));
  if (!hit) return undefined;
  if (hintNow() - hit.at >= ttlMs) return undefined;
  return hit.files;
}

export function invalidateProjectFileHintCache(projectRoot?: string): void {
  if (projectRoot == null) {
    hintCache.clear();
    return;
  }
  for (const key of hintCache.keys()) {
    if (key.endsWith(`\0${projectRoot}`)) hintCache.delete(key);
  }
}

export function resetProjectFileHintStatsForTests(): void {
  hintCache.clear();
  hintRefreshCount = 0;
  hintNow = () => Date.now();
  hintListDir = listDir;
}

export function loadRecentProjectFiles(projectRoot: string | null): string[] {
  if (!projectRoot) return [];
  try {
    const raw = localStorage.getItem(RECENT_FILES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    const list = parsed[projectRoot];
    return Array.isArray(list)
      ? list.filter((p) => typeof p === "string" && p.trim()).slice(0, MAX_RECENT)
      : [];
  } catch {
    return [];
  }
}

export function rememberProjectFile(
  projectRoot: string | null,
  relPath: string,
): void {
  if (!projectRoot) return;
  const path = relPath.replace(/^\.\/+/, "").trim();
  if (!path || path.includes("..")) return;
  try {
    const raw = localStorage.getItem(RECENT_FILES_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    const prev = Array.isArray(parsed[projectRoot]) ? parsed[projectRoot] : [];
    parsed[projectRoot] = [path, ...prev.filter((p) => p !== path)].slice(
      0,
      MAX_RECENT,
    );
    localStorage.setItem(RECENT_FILES_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // ignore quota
  }
}

export function extractAtFileMentions(text: string): string[] {
  const found: string[] = [];
  const re = /(?:^|[\s(])@([A-Za-z0-9_./\-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const path = m[1].replace(/^\.\/+/, "").trim();
    if (!path || path === "." || path.includes("..")) continue;
    if (!found.includes(path)) found.push(path);
  }
  return found.slice(0, MAX_INCLUDE_FILES);
}

export function activeAtQuery(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  const before = text.slice(0, cursor);
  const m = before.match(/(?:^|[\s(])@([^\s@]*)$/);
  if (!m) return null;
  const query = m[1] ?? "";
  const start = before.length - query.length - 1;
  return { start, query };
}

function scorePath(path: string, query: string): number {
  const q = query.toLowerCase();
  const p = path.toLowerCase();
  const base = p.split("/").pop() ?? p;
  if (!q) return 1;
  if (base === q) return 100;
  if (base.startsWith(q)) return 80;
  if (p.includes(`/${q}`)) return 60;
  if (base.includes(q)) return 40;
  if (p.includes(q)) return 20;
  return 0;
}

async function collectShallowFiles(
  sidecarUrl: string,
  projectRoot: string,
  signal?: AbortSignal,
): Promise<string[]> {
  hintRefreshCount += 1;
  const out: string[] = [];
  const root = await hintListDir(".", sidecarUrl, signal, projectRoot);
  const dirs: FsEntry[] = [];
  for (const e of root.entries) {
    if (e.type === "file") out.push(e.path);
    else if (e.type === "dir" && !SKIP_DIR.has(e.name)) dirs.push(e);
  }
  await Promise.all(
    dirs.slice(0, 12).map(async (d) => {
      try {
        const nested = await hintListDir(d.path, sidecarUrl, signal, projectRoot);
        for (const e of nested.entries) {
          if (e.type === "file") out.push(e.path);
        }
      } catch {
        // ignore
      }
    }),
  );
  return out;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Cached + coalesced shallow listing. Bursty @mention queries share one refresh.
 */
async function getShallowFilesCached(
  sidecarUrl: string,
  projectRoot: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const key = hintCacheKey(sidecarUrl, projectRoot);
  let entry = hintCache.get(key);
  const now = hintNow();
  if (entry && now - entry.at < PROJECT_FILE_HINT_TTL_MS) {
    return entry.files;
  }
  if (entry?.inflight) return entry.inflight;

  const inflight = (async () => {
    await delay(PROJECT_FILE_HINT_DEBOUNCE_MS, signal);
    // Another waiter may have completed a refresh during debounce.
    const latest = hintCache.get(key);
    if (latest && hintNow() - latest.at < PROJECT_FILE_HINT_TTL_MS) {
      return latest.files;
    }
    const files = await collectShallowFiles(sidecarUrl, projectRoot, signal);
    hintCache.set(key, { files, at: hintNow(), inflight: null });
    return files;
  })();

  const guarded = inflight.catch((err) => {
    const cur = hintCache.get(key);
    if (cur?.inflight === guarded) {
      hintCache.set(key, { files: cur.files, at: cur.at, inflight: null });
    }
    throw err;
  });

  hintCache.set(key, {
    files: entry?.files ?? [],
    at: entry?.at ?? 0,
    inflight: guarded,
  });
  return guarded;
}

export async function listProjectFileHints(options: {
  sidecarUrl: string;
  projectRoot: string | null;
  query?: string;
  signal?: AbortSignal;
}): Promise<string[]> {
  const { sidecarUrl, projectRoot, query = "", signal } = options;
  if (!projectRoot) return [];
  const recent = loadRecentProjectFiles(projectRoot);
  const files: string[] = [...recent];
  try {
    const shallow = await getShallowFilesCached(sidecarUrl, projectRoot, signal);
    for (const p of shallow) {
      if (!files.includes(p)) files.push(p);
    }
  } catch {
    // sidecar down / aborted
  }
  const q = query.trim().toLowerCase();
  const ranked = files
    .map((path) => ({ path, score: scorePath(path, q) }))
    .filter((x) => (q ? x.score > 0 : true))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return ranked.slice(0, MAX_HINTS).map((x) => x.path);
}

export function mergeIncludePaths(
  chips: string[],
  fromText: string[],
): string[] {
  const out: string[] = [];
  for (const p of [...chips, ...fromText]) {
    const path = p.replace(/^\.\/+/, "").trim();
    if (!path || path.includes("..")) continue;
    if (!out.includes(path)) out.push(path);
    if (out.length >= MAX_INCLUDE_FILES) break;
  }
  return out;
}

export async function buildIncludedFilesAddendum(options: {
  paths: string[];
  projectRoot: string | null;
  sidecarUrl: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  const { paths, projectRoot, sidecarUrl, signal } = options;
  if (!projectRoot || paths.length === 0) return null;
  const blocks: string[] = [];
  for (const rel of paths.slice(0, MAX_INCLUDE_FILES)) {
    try {
      const res = await readFile(
        rel,
        sidecarUrl,
        signal,
        undefined,
        projectRoot,
      );
      let body = (res.content ?? "").replace(/\r\n/g, "\n");
      if (body.length > FILE_INJECT_MAX) {
        body = `${body.slice(0, FILE_INJECT_MAX)}\n…`;
      }
      blocks.push(`### ${rel}\n\`\`\`\n${body}\n\`\`\``);
      rememberProjectFile(projectRoot, rel);
    } catch {
      blocks.push(`### ${rel}\n（未能读取该文件）`);
    }
  }
  if (blocks.length === 0) return null;
  return [
    "【仓库文件 · 本次提问附带】",
    "- 用户通过 @file / Include file 注入的项目文件摘录；不是完整索引。",
    "",
    ...blocks,
  ].join("\n");
}

export function formatDiscoveredCodeAddendum(hits: SemanticHit[]): string | null {
  const picked = hits.slice(0, MAX_AUTO_DISCOVERED);
  if (picked.length === 0) return null;
  return [
    "【仓库相关代码 · 自动发现】",
    "- 基于本轮问题用轻量代码检索选出的候选片段；这不是完整索引，编辑前仍需读取源文件确认。",
    "",
    ...picked.map((hit) => {
      const preview = hit.preview.trim().slice(0, 900);
      return [
        `### ${hit.path}:${hit.startLine}-${hit.endLine} · ${hit.title}`,
        "```",
        preview,
        "```",
      ].join("\n");
    }),
  ].join("\n");
}

export async function buildDiscoveredCodeAddendum(options: {
  query: string;
  projectRoot: string | null;
  sidecarUrl: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  const { query, projectRoot, sidecarUrl, signal } = options;
  if (!projectRoot || !query.trim()) return null;
  try {
    const { hits } = await semanticSearch(
      query,
      { path: ".", limit: MAX_AUTO_DISCOVERED },
      sidecarUrl,
      signal,
      projectRoot,
    );
    return formatDiscoveredCodeAddendum(hits);
  } catch {
    return null;
  }
}
