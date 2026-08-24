import type { ApiSettings } from "../types";
import { mkdir, readFile, writeFile, listDir, type FsEntry } from "./sidecar";
import {
  DEFAULT_MEMORY_DIR,
  PROJECT_MEMORY_FILE,
  resolveMemoryDir,
} from "./contextMemory";

const ROOT_DIRS = ["src", "electron", "sidecar", "shared", "scripts"];
const CONFIG_FILES = [
  "package.json",
  "README.md",
  "tsconfig.json",
  "tsconfig.node.json",
  "vite.config.ts",
  "electron/main.cjs",
  "sidecar/index.js",
];
const FILE_EXCERPT_MAX = 1800;
const MAX_DIR_ENTRIES = 24;

export type ProjectLearningSnapshot = {
  rootName: string;
  rootEntries: FsEntry[];
  dirEntries: Record<string, FsEntry[]>;
  fileExcerpts: Record<string, string>;
  generatedAt: number;
};

function compactText(text: string, max = FILE_EXCERPT_MAX): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}\n...`;
}

function basename(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || path;
}

function formatEntries(entries: FsEntry[], max = MAX_DIR_ENTRIES): string {
  const sorted = [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
  const lines = sorted.slice(0, max).map((e) => {
    const mark = e.type === "dir" ? "/" : "";
    return `- ${e.path}${mark}`;
  });
  if (sorted.length > max) lines.push(`- ... (${sorted.length - max} more)`);
  return lines.join("\n") || "- (empty)";
}

function inferStack(files: Record<string, string>): string[] {
  const out: string[] = [];
  const pkgRaw = files["package.json"];
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        main?: string;
      };
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      if (deps.react) out.push(`React ${deps.react}`);
      if (deps.vite) out.push(`Vite ${deps.vite}`);
      if (deps.electron) out.push(`Electron ${deps.electron}`);
      if (deps.zustand) out.push(`Zustand ${deps.zustand}`);
      if (pkg.main) out.push(`desktop main: ${pkg.main}`);
    } catch {
      out.push("package.json present but could not be parsed");
    }
  }
  if (files["sidecar/index.js"]) out.push("local sidecar server");
  if (files["vite.config.ts"]) out.push("Vite config present");
  return [...new Set(out)];
}

function inferEntrypoints(files: Record<string, string>, entries: FsEntry[]): string[] {
  const out: string[] = [];
  for (const candidate of [
    "src/main.tsx",
    "src/App.tsx",
    "electron/main.cjs",
    "sidecar/index.js",
    "vite.config.ts",
  ]) {
    if (files[candidate] != null || entries.some((e) => e.path === candidate)) {
      out.push(candidate);
    }
  }
  return out;
}

export function buildProjectLearningMarkdown(
  snapshot: ProjectLearningSnapshot,
): string {
  const stack = inferStack(snapshot.fileExcerpts);
  const entrypoints = inferEntrypoints(
    snapshot.fileExcerpts,
    [
      ...snapshot.rootEntries,
      ...Object.values(snapshot.dirEntries).flat(),
    ],
  );
  const generated = new Date(snapshot.generatedAt).toISOString();
  const sections: string[] = [
    `# Project Learning Pack`,
    "",
    `Generated: ${generated}`,
    `Project: ${snapshot.rootName}`,
    "",
    "## Purpose",
    "- Fast, deterministic project overview for future agent turns.",
    "- Treat this as orientation only; verify details against source files before editing.",
    "",
    "## Stack Signals",
    stack.length ? stack.map((s) => `- ${s}`).join("\n") : "- (no stack signals found)",
    "",
    "## Entrypoints",
    entrypoints.length
      ? entrypoints.map((p) => `- ${p}`).join("\n")
      : "- (no common entrypoints found)",
    "",
    "## Root Layout",
    formatEntries(snapshot.rootEntries),
  ];

  for (const dir of ROOT_DIRS) {
    const entries = snapshot.dirEntries[dir];
    if (!entries?.length) continue;
    sections.push("", `## ${dir}/`, formatEntries(entries));
  }

  const excerptNames = Object.keys(snapshot.fileExcerpts).sort();
  if (excerptNames.length) {
    sections.push("", "## Key File Excerpts");
    for (const name of excerptNames) {
      sections.push(
        "",
        `### ${name}`,
        "```",
        compactText(snapshot.fileExcerpts[name]),
        "```",
      );
    }
  }

  return `${sections.join("\n")}\n`;
}

async function safeList(
  path: string,
  sidecarUrl: string,
  signal: AbortSignal | undefined,
  projectRoot: string,
): Promise<FsEntry[]> {
  try {
    return (await listDir(path, sidecarUrl, signal, projectRoot)).entries;
  } catch {
    return [];
  }
}

async function safeRead(
  path: string,
  sidecarUrl: string,
  signal: AbortSignal | undefined,
  projectRoot: string,
): Promise<string | null> {
  try {
    const res = await readFile(
      path,
      sidecarUrl,
      signal,
      { offset: 1, limit: 120 },
      projectRoot,
    );
    return res.content ?? "";
  } catch {
    return null;
  }
}

export async function buildProjectLearningSnapshot(options: {
  projectRoot: string;
  sidecarUrl: string;
  signal?: AbortSignal;
  now?: number;
}): Promise<ProjectLearningSnapshot> {
  const { projectRoot, sidecarUrl, signal } = options;
  const rootEntries = await safeList(".", sidecarUrl, signal, projectRoot);
  const dirs = ROOT_DIRS.filter((dir) =>
    rootEntries.some((entry) => entry.type === "dir" && entry.name === dir),
  );
  const dirPairs = await Promise.all(
    dirs.map(async (dir) => [dir, await safeList(dir, sidecarUrl, signal, projectRoot)] as const),
  );
  const dirEntries = Object.fromEntries(dirPairs);
  const discoveredEntries = [...rootEntries, ...Object.values(dirEntries).flat()];
  const readTargets = CONFIG_FILES.filter(
    (file) => file === "package.json" || file === "README.md" ||
      discoveredEntries.some((entry) => entry.type === "file" && entry.path === file),
  );
  const readPairs = await Promise.all(
    readTargets.map(async (file) => [file, await safeRead(file, sidecarUrl, signal, projectRoot)] as const),
  );
  const fileExcerpts: Record<string, string> = {};
  for (const [file, content] of readPairs) {
    if (content != null && content.trim()) fileExcerpts[file] = content;
  }
  return {
    rootName: basename(projectRoot),
    rootEntries,
    dirEntries,
    fileExcerpts,
    generatedAt: options.now ?? Date.now(),
  };
}

export async function saveProjectLearningPack(options: {
  settings: ApiSettings;
  projectRoot: string;
  sidecarUrl: string;
  signal?: AbortSignal;
}): Promise<{ path: string; content: string }> {
  const dir = resolveMemoryDir(options.settings, null);
  const targetDir = dir || DEFAULT_MEMORY_DIR;
  const path = `${targetDir}/${PROJECT_MEMORY_FILE}`;
  const snapshot = await buildProjectLearningSnapshot({
    projectRoot: options.projectRoot,
    sidecarUrl: options.sidecarUrl,
    signal: options.signal,
  });
  const content = buildProjectLearningMarkdown(snapshot);
  await mkdir(targetDir, options.sidecarUrl, options.signal, options.projectRoot);
  await writeFile(path, content, options.sidecarUrl, options.signal, options.projectRoot);
  return { path, content };
}
