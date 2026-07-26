/**
 * Lightweight repo awareness: @file mentions + recent path hints.
 * Not a full IDE index — shallow list + recent paths only.
 */

import { listDir, readFile, type FsEntry } from "./sidecar";

export const RECENT_FILES_STORAGE_KEY = "forknote-recent-files";
const MAX_RECENT = 24;
const MAX_HINTS = 20;
const FILE_INJECT_MAX = 4500;
const MAX_INCLUDE_FILES = 4;

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
  signal?: AbortSignal,
): Promise<string[]> {
  const out: string[] = [];
  const root = await listDir(".", sidecarUrl, signal);
  const dirs: FsEntry[] = [];
  for (const e of root.entries) {
    if (e.type === "file") out.push(e.path);
    else if (e.type === "dir" && !SKIP_DIR.has(e.name)) dirs.push(e);
  }
  await Promise.all(
    dirs.slice(0, 12).map(async (d) => {
      try {
        const nested = await listDir(d.path, sidecarUrl, signal);
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
    const shallow = await collectShallowFiles(sidecarUrl, signal);
    for (const p of shallow) {
      if (!files.includes(p)) files.push(p);
    }
  } catch {
    // sidecar down
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
      const res = await readFile(rel, sidecarUrl, signal);
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
