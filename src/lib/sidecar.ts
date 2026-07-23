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

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      res.ok
        ? "Sidecar returned invalid JSON"
        : `Sidecar error ${res.status}: ${text.slice(0, 200)}`,
    );
  }
  if (!res.ok) {
    const msg =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `Sidecar error ${res.status}`;
    throw new Error(msg);
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
): Promise<{ path: string; entries: FsEntry[] }> {
  const q = new URLSearchParams({ path: relPath });
  const res = await fetch(`${base(sidecarUrl)}/fs/list?${q}`);
  return parseJson(res);
}

export async function readFile(
  relPath: string,
  sidecarUrl = DEFAULT_SIDECAR_URL,
): Promise<{ path: string; content: string; size: number }> {
  const q = new URLSearchParams({ path: relPath });
  const res = await fetch(`${base(sidecarUrl)}/fs/read?${q}`);
  return parseJson(res);
}

export async function writeFile(
  relPath: string,
  content: string,
  sidecarUrl = DEFAULT_SIDECAR_URL,
): Promise<{ path: string; size: number; written: boolean }> {
  const res = await fetch(`${base(sidecarUrl)}/fs/write`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: relPath, content }),
  });
  return parseJson(res);
}

export async function mkdir(
  relPath: string,
  sidecarUrl = DEFAULT_SIDECAR_URL,
): Promise<{ path: string; created: boolean }> {
  const res = await fetch(`${base(sidecarUrl)}/fs/mkdir`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: relPath }),
  });
  return parseJson(res);
}

export async function searchFiles(
  query: string,
  subpath = ".",
  sidecarUrl = DEFAULT_SIDECAR_URL,
): Promise<{ query: string; hits: SearchHit[]; truncated: boolean }> {
  const res = await fetch(`${base(sidecarUrl)}/fs/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, path: subpath }),
  });
  return parseJson(res);
}
