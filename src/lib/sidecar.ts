/** Client for the local ForkNote sidecar (proxied at /sidecar in Vite). */

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
  return parseJson(res);
}

export async function listDir(
  relPath = ".",
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
): Promise<{ path: string; entries: FsEntry[] }> {
  const q = new URLSearchParams({ path: relPath });
  const res = await fetch(`${base(sidecarUrl)}/fs/list?${q}`, { signal });
  return parseJson(res);
}

export async function readFile(
  relPath: string,
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
): Promise<{ path: string; content: string; size: number }> {
  const q = new URLSearchParams({ path: relPath });
  const res = await fetch(`${base(sidecarUrl)}/fs/read?${q}`, { signal });
  return parseJson(res);
}

export async function writeFile(
  relPath: string,
  content: string,
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
): Promise<{ path: string; size: number; written: boolean }> {
  const res = await fetch(`${base(sidecarUrl)}/fs/write`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: relPath, content }),
    signal,
  });
  return parseJson(res);
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
): Promise<{
  path: string;
  size: number;
  written: boolean;
  kind: string;
  replacements: number;
}> {
  const res = await fetch(`${base(sidecarUrl)}/fs/search_replace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: relPath,
      old_string: options.old_string,
      new_string: options.new_string,
      replace_all: options.replace_all,
    }),
    signal,
  });
  return parseJson(res);
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
): Promise<{
  path: string;
  size: number;
  written: boolean;
  kind: string;
  edits: number;
  replacements: number;
}> {
  const res = await fetch(`${base(sidecarUrl)}/fs/apply_patch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: relPath, edits }),
    signal,
  });
  return parseJson(res);
}

export async function writeDocx(
  relPath: string,
  options: { title?: string; paragraphs: string[] },
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
): Promise<{ path: string; size: number; written: boolean; kind: string }> {
  const res = await fetch(`${base(sidecarUrl)}/fs/write_docx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: relPath,
      title: options.title,
      paragraphs: options.paragraphs,
    }),
    signal,
  });
  return parseJson(res);
}

export async function writeXlsx(
  relPath: string,
  options: {
    sheet_name?: string;
    rows: Array<Array<string | number | boolean | null>>;
  },
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
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
    }),
    signal,
  });
  return parseJson(res);
}

export async function mkdir(
  relPath: string,
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
): Promise<{ path: string; created: boolean }> {
  const res = await fetch(`${base(sidecarUrl)}/fs/mkdir`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: relPath }),
    signal,
  });
  return parseJson(res);
}

export async function searchFiles(
  query: string,
  subpath = ".",
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
): Promise<{ query: string; hits: SearchHit[]; truncated: boolean }> {
  const res = await fetch(`${base(sidecarUrl)}/fs/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, path: subpath }),
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

/**
 * Ensure the sidecar's bound root matches `expectedRoot` (re-open if stale).
 * Prevents /fs/run from listing a previous project's tree while the UI shows another.
 */
export async function ensureProjectBound(
  expectedRoot: string,
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
): Promise<string> {
  const expected = expectedRoot.trim().replace(/\/+$/, "");
  if (!expected) {
    throw new Error("expectedRoot is required");
  }
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  try {
    const health = await sidecarHealth(sidecarUrl);
    if (health.root && norm(health.root) === norm(expected)) {
      return health.root;
    }
  } catch {
    // Fall through to open
  }
  const { root } = await openProject(expected, sidecarUrl);
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  return root;
}

/** Run a shell command via sidecar (cwd must resolve under the bound project). */
export async function runTerminal(
  options: {
    command: string;
    cwd?: string;
    timeoutMs?: number;
    /** UI-bound project root — sidecar rejects on mismatch (409). */
    expectedRoot?: string;
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
