/**
 * Persist archive snapshots as Markdown under the bound project.
 */
import type { ArchiveSnapshot } from "../types";
import { mkdir, writeFile } from "./sidecar";

export const DEFAULT_ARCHIVES_DIR = ".forknote/archives";

export function resolveArchivesDir(): string {
  return DEFAULT_ARCHIVES_DIR;
}

export function slugifyArchiveTitle(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "archive";
}

export function archiveFileName(snapshot: ArchiveSnapshot): string {
  const d = new Date(snapshot.createdAt);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const slug = slugifyArchiveTitle(snapshot.title);
  const shortId =
    String(snapshot.id).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "note";
  return `${yyyy}-${mm}-${dd}-${slug}-${shortId}.md`;
}

export function archiveRelativePath(snapshot: ArchiveSnapshot): string {
  if (snapshot.filePath?.trim()) {
    return snapshot.filePath.trim().replace(/^\/+/, "");
  }
  return `${resolveArchivesDir()}/${archiveFileName(snapshot)}`;
}

export function formatArchiveMarkdownFile(snapshot: ArchiveSnapshot): string {
  const body = snapshot.content.trim();
  if (body.startsWith("#")) return `${body}\n`;
  return `# ${snapshot.title.trim() || "Archive"}\n\n${body}\n`;
}

export function joinProjectPath(projectRoot: string, relPath: string): string {
  const root = projectRoot.replace(/\/+$/, "");
  const rel = relPath.replace(/^\/+/, "");
  return `${root}/${rel}`;
}

/** Write archive markdown into the bound project; returns relative path or null. */
export async function saveArchiveMarkdownToProject(options: {
  snapshot: ArchiveSnapshot;
  projectRoot: string;
  sidecarUrl: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  const { snapshot, projectRoot, sidecarUrl, signal } = options;
  if (!projectRoot.trim()) return null;
  const dir = resolveArchivesDir();
  const relPath = archiveRelativePath(snapshot);
  try {
    await mkdir(dir, sidecarUrl, signal, projectRoot);
    await writeFile(
      relPath,
      formatArchiveMarkdownFile(snapshot),
      sidecarUrl,
      signal,
      projectRoot,
    );
    return relPath;
  } catch (e) {
    console.warn("[archiveFiles] project write failed", e);
    return null;
  }
}
