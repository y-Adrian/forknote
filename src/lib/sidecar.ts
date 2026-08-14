/** Client for the local ForkNote sidecar (proxied at /sidecar in Vite). */

import {
  isSidecarUnreachableError,
  PLANTUML_LOCAL_SIDECAR_HINT,
  PLANTUML_SERVER_SIDECAR_HINT,
  renderPlantumlServerDirect,
} from "./plantumlClient";

export const DEFAULT_SIDECAR_URL = "/sidecar";

export type FsEntry = {
  name: string;
  type: "dir" | "file" | "other";
  path: string;
};

export type SearchHit = {
  path: string;
  line: number;
  text: string;
};

const SIDECAR_DOWN_HINT =
  "Could not reach sidecar (run npm run sidecar, or npm run dev). Then retry Open project.";

function errorMessageFromBody(data: unknown, status: number, text: string): string {
  if (data && typeof data === "object" && "error" in data) {
    const err = (data as { error: unknown }).error;
    if (typeof err === "string" && err.trim()) return err;
    if (
      err &&
      typeof err === "object" &&
      "message" in err &&
      typeof (err as { message: unknown }).message === "string"
    ) {
      return (err as { message: string }).message;
    }
  }
  // Vite proxy used to return empty HTTP 500 when :8787 was down.
  if (status >= 500 && !text.trim()) return SIDECAR_DOWN_HINT;
  if (text.trim()) return `Sidecar error ${status}: ${text.slice(0, 200)}`;
  return `Sidecar error ${status}`;
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      res.ok
        ? "Sidecar returned invalid JSON"
        : errorMessageFromBody(null, res.status, text),
    );
  }
  if (!res.ok) {
    throw new Error(errorMessageFromBody(data, res.status, text));
  }
  return data as T;
}

function base(url: string): string {
  return url.replace(/\/$/, "");
}

/** Bust @mention shallow listings after filesystem mutations (dynamic to avoid cycles). */
function bustProjectFileHintCache(expectedRoot?: string): void {
  void import("./repoContext")
    .then((m) => {
      m.invalidateProjectFileHintCache(
        expectedRoot && expectedRoot.trim() ? expectedRoot : undefined,
      );
    })
    .catch(() => {
      /* ignore */
    });
}

export async function sidecarHealth(
  sidecarUrl = DEFAULT_SIDECAR_URL,
): Promise<{ ok: boolean; root: string | null }> {
  const res = await fetch(`${base(sidecarUrl)}/health`);
  return parseJson(res);
}

export async function openProject(
  absPath: string,
  sidecarUrl = DEFAULT_SIDECAR_URL,
): Promise<{ root: string }> {
  const res = await fetch(`${base(sidecarUrl)}/project/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: absPath }),
  });
  return parseJson(res);
}

/** Native OS folder dialog via sidecar. Cancel → cancelled: true. */
export async function pickProjectFolder(
  sidecarUrl = DEFAULT_SIDECAR_URL,
): Promise<{ cancelled: boolean; path: string | null }> {
  const res = await fetch(`${base(sidecarUrl)}/project/pick-folder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  return parseJson(res);
}

export async function getProject(
  sidecarUrl = DEFAULT_SIDECAR_URL,
): Promise<{ root: string | null }> {
  const res = await fetch(`${base(sidecarUrl)}/project`);
  return parseJson(res);
}

export async function closeProject(
  sidecarUrl = DEFAULT_SIDECAR_URL,
): Promise<{ root: null }> {
  const res = await fetch(`${base(sidecarUrl)}/project/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const data = await parseJson<{ root: null }>(res);
  bustProjectFileHintCache();
  return data;
}

export async function listDir(
  relPath = ".",
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
  expectedRoot?: string,
): Promise<{ path: string; entries: FsEntry[] }> {
  const q = new URLSearchParams({ path: relPath, expectedRoot: expectedRoot ?? "" });
  const res = await fetch(`${base(sidecarUrl)}/fs/list?${q}`, { signal });
  return parseJson(res);
}

export async function readFile(
  relPath: string,
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
  options?: { offset?: number; limit?: number },
  expectedRoot?: string,
): Promise<{
  path: string;
  content: string;
  size: number;
  /** Filesystem mtime in ms (from sidecar `stat`). */
  mtimeMs?: number;
  totalLines?: number;
  startLine?: number;
  endLine?: number;
  truncated?: boolean;
}> {
  const q = new URLSearchParams({ path: relPath });
  q.set("expectedRoot", expectedRoot ?? "");
  if (options?.offset != null) q.set("offset", String(options.offset));
  if (options?.limit != null) q.set("limit", String(options.limit));
  const res = await fetch(`${base(sidecarUrl)}/fs/read?${q}`, { signal });
  return parseJson(res);
}

export async function writeFile(
  relPath: string,
  content: string,
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
  expectedRoot?: string,
): Promise<{ path: string; size: number; written: boolean; diff?: string; created?: boolean }> {
  const res = await fetch(`${base(sidecarUrl)}/fs/write`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: relPath, content, expectedRoot }),
    signal,
  });
  const data = await parseJson<{
    path: string;
    size: number;
    written: boolean;
    diff?: string;
    created?: boolean;
  }>(res);
  bustProjectFileHintCache(expectedRoot);
  return data;
}

export async function searchReplace(
  relPath: string,
  options: {
    old_string: string;
    new_string: string;
    replace_all?: boolean;
  },
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
  expectedRoot?: string,
): Promise<{
  path: string;
  size: number;
  written: boolean;
  kind: string;
  replacements: number;
  diff?: string;
}> {
  const res = await fetch(`${base(sidecarUrl)}/fs/search_replace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: relPath,
      old_string: options.old_string,
      new_string: options.new_string,
      replace_all: options.replace_all,
      expectedRoot,
    }),
    signal,
  });
  const data = await parseJson<{
    path: string;
    size: number;
    written: boolean;
    kind: string;
    replacements: number;
    diff?: string;
  }>(res);
  bustProjectFileHintCache(expectedRoot);
  return data;
}

export async function applyPatch(
  relPath: string,
  edits: Array<{
    old_string: string;
    new_string: string;
    replace_all?: boolean;
  }>,
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
  expectedRoot?: string,
): Promise<{
  path: string;
  size: number;
  written: boolean;
  kind: string;
  edits: number;
  replacements: number;
  diff?: string;
}> {
  const res = await fetch(`${base(sidecarUrl)}/fs/apply_patch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: relPath, edits, expectedRoot }),
    signal,
  });
  const data = await parseJson<{
    path: string;
    size: number;
    written: boolean;
    kind: string;
    edits: number;
    replacements: number;
    diff?: string;
  }>(res);
  bustProjectFileHintCache(expectedRoot);
  return data;
}

export async function writeDocx(
  relPath: string,
  options: { title?: string; paragraphs: string[] },
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
  expectedRoot?: string,
): Promise<{ path: string; size: number; written: boolean; kind: string }> {
  const res = await fetch(`${base(sidecarUrl)}/fs/write_docx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: relPath,
      title: options.title,
      paragraphs: options.paragraphs,
      expectedRoot,
    }),
    signal,
  });
  const data = await parseJson<{
    path: string;
    size: number;
    written: boolean;
    kind: string;
  }>(res);
  bustProjectFileHintCache(expectedRoot);
  return data;
}

export async function writeXlsx(
  relPath: string,
  options: {
    sheet_name?: string;
    rows: Array<Array<string | number | boolean | null>>;
  },
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
  expectedRoot?: string,
): Promise<{
  path: string;
  size: number;
  written: boolean;
  kind: string;
  rows: number;
}> {
  const res = await fetch(`${base(sidecarUrl)}/fs/write_xlsx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: relPath,
      sheet_name: options.sheet_name,
      rows: options.rows,
      expectedRoot,
    }),
    signal,
  });
  const data = await parseJson<{
    path: string;
    size: number;
    written: boolean;
    kind: string;
    rows: number;
  }>(res);
  bustProjectFileHintCache(expectedRoot);
  return data;
}

export async function mkdir(
  relPath: string,
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
  expectedRoot?: string,
): Promise<{ path: string; created: boolean }> {
  const res = await fetch(`${base(sidecarUrl)}/fs/mkdir`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: relPath, expectedRoot }),
    signal,
  });
  const data = await parseJson<{ path: string; created: boolean }>(res);
  bustProjectFileHintCache(expectedRoot);
  return data;
}

export async function searchFiles(
  query: string,
  subpath = ".",
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
  options?: { regex?: boolean; glob?: string },
  expectedRoot?: string,
): Promise<{ query: string; hits: SearchHit[]; truncated: boolean; regex?: boolean }> {
  const res = await fetch(`${base(sidecarUrl)}/fs/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      path: subpath,
      regex: options?.regex,
      glob: options?.glob,
      expectedRoot,
    }),
    signal,
  });
  return parseJson(res);
}

export async function globFiles(
  pattern: string,
  subpath = ".",
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
  expectedRoot?: string,
): Promise<{ pattern: string; matches: string[]; truncated: boolean }> {
  const res = await fetch(`${base(sidecarUrl)}/fs/glob`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pattern, path: subpath, expectedRoot }),
    signal,
  });
  return parseJson(res);
}

export type SymbolHit = {
  path: string;
  name: string;
  kind: string;
  line: number;
  exported: boolean;
  snippet: string;
};

export async function findSymbol(
  name: string,
  subpath = ".",
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
  expectedRoot?: string,
): Promise<{
  name: string;
  symbols: SymbolHit[];
  truncated: boolean;
  count: number;
}> {
  const res = await fetch(`${base(sidecarUrl)}/fs/find_symbol`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, path: subpath, expectedRoot }),
    signal,
  });
  return parseJson(res);
}

export async function goToDefinition(
  name: string,
  hintPath?: string,
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
  expectedRoot?: string,
): Promise<{
  name: string;
  definition: SymbolHit | null;
  candidates: SymbolHit[];
  found: boolean;
}> {
  const res = await fetch(`${base(sidecarUrl)}/fs/go_to_definition`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, path: hintPath || undefined, expectedRoot }),
    signal,
  });
  return parseJson(res);
}

export async function findReferences(
  name: string,
  subpath = ".",
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
  expectedRoot?: string,
): Promise<{
  name: string;
  references: Array<{ path: string; line: number; snippet: string }>;
  truncated: boolean;
  count: number;
}> {
  const res = await fetch(`${base(sidecarUrl)}/fs/find_references`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, path: subpath, expectedRoot }),
    signal,
  });
  return parseJson(res);
}

export type DependencyEdge = {
  from: string;
  to: string;
  resolved: string | null;
  kind: string;
  line: number;
  external: boolean;
};

export async function dependencyGraph(
  opts: {
    path?: string;
    focus?: string;
    limit?: number;
  } = {},
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
  expectedRoot?: string,
): Promise<{
  path: string;
  files: number;
  edges: DependencyEdge[];
  edgeCount: number;
  truncated: boolean;
  focus: {
    path: string;
    imports: DependencyEdge[];
    importers: DependencyEdge[];
    importCount: number;
    importerCount: number;
  } | null;
}> {
  const res = await fetch(`${base(sidecarUrl)}/fs/dependency_graph`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: opts.path ?? ".",
      focus: opts.focus,
      limit: opts.limit,
      expectedRoot,
    }),
    signal,
  });
  return parseJson(res);
}


export type SemanticHit = {
  path: string;
  startLine: number;
  endLine: number;
  title: string;
  score: number;
  preview: string;
};

export async function semanticSearch(
  query: string,
  opts: { path?: string; limit?: number } = {},
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
  expectedRoot?: string,
): Promise<{
  query: string;
  hits: SemanticHit[];
  chunkCount: number;
  truncated: boolean;
}> {
  const res = await fetch(`${base(sidecarUrl)}/fs/semantic_search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      path: opts.path ?? ".",
      limit: opts.limit,
      expectedRoot,
    }),
    signal,
  });
  return parseJson(res);
}

export async function deleteFile(
  relPath: string,
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
  expectedRoot?: string,
): Promise<{ path: string; deleted: boolean; kind: string; size?: number }> {
  const res = await fetch(`${base(sidecarUrl)}/fs/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: relPath, expectedRoot }),
    signal,
  });
  const data = await parseJson<{
    path: string;
    deleted: boolean;
    kind: string;
    size?: number;
  }>(res);
  bustProjectFileHintCache(expectedRoot);
  return data;
}

export async function renameFile(
  from: string,
  to: string,
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
  expectedRoot?: string,
): Promise<{ from: string; to: string; renamed: boolean }> {
  const res = await fetch(`${base(sidecarUrl)}/fs/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, expectedRoot }),
    signal,
  });
  const data = await parseJson<{ from: string; to: string; renamed: boolean }>(
    res,
  );
  bustProjectFileHintCache(expectedRoot);
  return data;
}

export async function readDocx(
  relPath: string,
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
  expectedRoot?: string,
): Promise<{ path: string; text: string; truncated?: boolean }> {
  const res = await fetch(`${base(sidecarUrl)}/fs/read_docx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: relPath, expectedRoot }),
    signal,
  });
  return parseJson(res);
}

export async function readXlsx(
  relPath: string,
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
  expectedRoot?: string,
): Promise<{
  path: string;
  sheets: Array<{ name: string; rows: Array<{ row: number; cells: string[] }> }>;
}> {
  const res = await fetch(`${base(sidecarUrl)}/fs/read_xlsx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: relPath, expectedRoot }),
    signal,
  });
  return parseJson(res);
}

export async function patchXlsx(
  relPath: string,
  options: {
    sheet_name?: string;
    cells: Array<{ row: number; col: number; value: string | number | boolean | null }>;
  },
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
  expectedRoot?: string,
): Promise<{ path: string; sheet_name: string; patched: number; size: number; written: boolean }> {
  const res = await fetch(`${base(sidecarUrl)}/fs/patch_xlsx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: relPath,
      sheet_name: options.sheet_name,
      cells: options.cells,
      expectedRoot,
    }),
    signal,
  });
  return parseJson(res);
}

export async function runDiagnostics(
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
  expectedRoot?: string,
): Promise<{ ok: boolean; skipped?: boolean; output: string }> {
  const res = await fetch(`${base(sidecarUrl)}/fs/diagnostics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedRoot }),
    signal,
  });
  return parseJson(res);
}

export async function gitStatus(
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
  expectedRoot?: string,
): Promise<{ ok: boolean; output: string; exitCode: number }> {
  const res = await fetch(`${base(sidecarUrl)}/git/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedRoot }),
    signal,
  });
  return parseJson(res);
}

export async function gitDiff(
  relPath?: string,
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
  expectedRoot?: string,
): Promise<{ ok: boolean; output: string; exitCode: number }> {
  const res = await fetch(`${base(sidecarUrl)}/git/diff`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: relPath || undefined, expectedRoot }),
    signal,
  });
  return parseJson(res);
}

export async function gitCommit(
  message: string,
  paths: string[],
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
  expectedRoot?: string,
): Promise<{ ok: boolean; output: string; exitCode: number; paths: string[] }> {
  const res = await fetch(`${base(sidecarUrl)}/git/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, paths, expectedRoot }),
    signal,
  });
  return parseJson(res);
}

export type RunTerminalResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  /** Relative to project root ("." or "subdir"). */
  cwd: string;
  /** Absolute starting cwd (under project root). */
  cwdAbsolute?: string;
  /** Absolute bound project root used for this run. */
  projectRoot?: string;
  timedOut?: boolean;
};

/** Run a shell command via sidecar (cwd must resolve under the bound project). */
export async function runTerminal(
  options: {
    command: string;
    cwd?: string;
    timeoutMs?: number;
    /** UI-bound project root — sidecar rejects on mismatch (409). */
    expectedRoot: string;
    /** After user approval for outside-project paths. */
    allowOutsideProject?: boolean;
  },
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
): Promise<RunTerminalResult> {
  const res = await fetch(`${base(sidecarUrl)}/fs/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      command: options.command,
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
      expectedRoot: options.expectedRoot,
      allowOutsideProject: options.allowOutsideProject || undefined,
    }),
    signal,
  });
  return parseJson(res);
}

export type PlantumlRenderResult =
  | {
      ok: true;
      format: "svg";
      contentType: string;
      svg: string;
    }
  | {
      ok: true;
      format: "png";
      contentType: string;
      imageBase64: string;
    };

async function renderPlantumlViaSidecar(
  options: {
    mode: "server" | "local";
    source: string;
    serverUrl?: string;
    localPath?: string;
    javaPath?: string;
    format?: "svg" | "png";
  },
  sidecarUrl: string,
  signal?: AbortSignal,
): Promise<PlantumlRenderResult> {
  const endpoint =
    options.mode === "local" ? "/plantuml/local" : "/plantuml/server";
  try {
    const res = await fetch(`${base(sidecarUrl)}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: options.source,
        serverUrl: options.serverUrl,
        localPath: options.localPath,
        javaPath: options.javaPath,
        format: options.format ?? "svg",
      }),
      signal,
    });
    return await parseJson(res);
  } catch (e) {
    // Raw fetch failures (no proxy JSON body) → actionable hint.
    if (
      e instanceof TypeError ||
      (e instanceof Error &&
        /failed to fetch|networkerror|load failed|econnrefused/i.test(e.message))
    ) {
      throw new Error(
        options.mode === "local"
          ? PLANTUML_LOCAL_SIDECAR_HINT
          : "Sidecar unreachable on 127.0.0.1:8787. Run npm run sidecar (or npm run dev), then retry.",
      );
    }
    throw e;
  }
}

/**
 * Soft-retry server render (sidecar proxy, then direct Kroki/plantuml.com).
 * Used when local spawn fails but a server URL is configured.
 */
async function renderPlantumlServerWithFallback(
  options: {
    source: string;
    serverUrl?: string;
    format?: "svg" | "png";
  },
  sidecarUrl: string,
  signal?: AbortSignal,
): Promise<PlantumlRenderResult> {
  try {
    return await renderPlantumlViaSidecar(
      {
        mode: "server",
        source: options.source,
        serverUrl: options.serverUrl,
        format: options.format ?? "svg",
      },
      sidecarUrl,
      signal,
    );
  } catch (e) {
    if (!isSidecarUnreachableError(e) && !(e instanceof TypeError)) {
      // Sidecar reachable but server proxy failed — still try direct for
      // public hosts; self-hosted may fail the same way.
    }
    return await renderPlantumlServerDirect({
      source: options.source,
      serverUrl: options.serverUrl,
      format: options.format ?? "svg",
      signal,
    });
  }
}

/**
 * Render PlantUML via sidecar (server proxy or local jar/binary).
 * Server mode: if sidecar is down, fall back to a direct browser fetch of
 * Kroki / plantuml.com (CORS allows public hosts). Local mode needs the
 * sidecar for spawn; if local fails and a server URL is set, soft-retry
 * server render so diagrams still show.
 */
export async function renderPlantuml(
  options: {
    mode: "server" | "local";
    source: string;
    serverUrl?: string;
    localPath?: string;
    javaPath?: string;
    format?: "svg" | "png";
  },
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
): Promise<PlantumlRenderResult> {
  if (options.mode === "local") {
    try {
      return await renderPlantumlViaSidecar(options, sidecarUrl, signal);
    } catch (e) {
      const serverUrl = (options.serverUrl ?? "").trim();
      if (isSidecarUnreachableError(e)) {
        if (serverUrl && !signal?.aborted) {
          try {
            return await renderPlantumlServerDirect({
              source: options.source,
              serverUrl,
              format: options.format ?? "svg",
              signal,
            });
          } catch {
            /* fall through to local sidecar hint */
          }
        }
        throw new Error(PLANTUML_LOCAL_SIDECAR_HINT);
      }
      if (serverUrl && !signal?.aborted) {
        try {
          return await renderPlantumlServerWithFallback(
            {
              source: options.source,
              serverUrl,
              format: options.format ?? "svg",
            },
            sidecarUrl,
            signal,
          );
        } catch {
          // Prefer the local error (now includes stderr) for diagnosis.
        }
      }
      throw e;
    }
  }

  try {
    return await renderPlantumlViaSidecar(options, sidecarUrl, signal);
  } catch (e) {
    if (!isSidecarUnreachableError(e)) throw e;
    try {
      return await renderPlantumlServerDirect({
        source: options.source,
        serverUrl: options.serverUrl,
        format: options.format ?? "svg",
        signal,
      });
    } catch (directErr) {
      if (signal?.aborted) throw directErr;
      const detail =
        directErr instanceof Error ? directErr.message : String(directErr);
      throw new Error(`${PLANTUML_SERVER_SIDECAR_HINT} (${detail})`);
    }
  }
}
