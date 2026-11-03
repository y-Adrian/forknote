/**
 * Per-turn file checkpoints for Agent edits.
 *
 * Before a mutating fs tool runs, the client asks the sidecar to capture the
 * target paths under a checkpoint id (one id per Agent turn). The first
 * capture of a path wins, so the checkpoint holds the state before the turn.
 * Restore writes captured files back, removes files/dirs the turn created,
 * and deletes the checkpoint. Terminal commands are not covered.
 *
 * Stored as JSON under <project>/.forknote/checkpoints/<id>.json.
 */
import fs from "node:fs/promises";
import path from "node:path";

export const CHECKPOINT_DIR = ".forknote/checkpoints";
/** Files larger than this are recorded as skipped (not restorable). */
export const MAX_CHECKPOINT_FILE_BYTES = 5 * 1024 * 1024;

/** Oldest checkpoints beyond this count are deleted when a new one starts. */
export const MAX_CHECKPOINTS = 30;

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

export function isValidCheckpointId(id) {
  return typeof id === "string" && ID_RE.test(id);
}

function manifestPath(root, id) {
  return path.join(root, CHECKPOINT_DIR, `${id}.json`);
}

function relInside(root, abs) {
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

async function loadManifest(root, id) {
  try {
    const raw = JSON.parse(await fs.readFile(manifestPath(root, id), "utf8"));
    return Array.isArray(raw?.entries) ? raw : { id, createdAt: Date.now(), entries: [] };
  } catch {
    return { id, createdAt: Date.now(), entries: [] };
  }
}

async function pruneOldCheckpoints(root, keepId) {
  const dir = path.join(root, CHECKPOINT_DIR);
  let names;
  try {
    names = (await fs.readdir(dir)).filter((n) => n.endsWith(".json"));
  } catch {
    return;
  }
  if (names.length < MAX_CHECKPOINTS) return;
  const stats = await Promise.all(
    names.map(async (n) => ({ n, t: (await fs.stat(path.join(dir, n)).catch(() => null))?.mtimeMs ?? 0 })),
  );
  stats.sort((a, b) => b.t - a.t);
  for (const { n } of stats.slice(MAX_CHECKPOINTS - 1)) {
    if (n !== `${keepId}.json`) await fs.rm(path.join(dir, n), { force: true });
  }
}

async function saveManifest(root, manifest) {
  const file = manifestPath(root, manifest.id);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(manifest), "utf8");
}

async function snapshotEntry(root, abs) {
  const rel = relInside(root, abs);
  if (!rel) return null;
  let stat;
  try {
    stat = await fs.lstat(abs);
  } catch {
    return { path: rel, kind: "absent" };
  }
  if (stat.isDirectory()) return { path: rel, kind: "dir" };
  if (!stat.isFile()) return { path: rel, kind: "skipped", reason: "not a regular file" };
  if (stat.size > MAX_CHECKPOINT_FILE_BYTES) {
    return { path: rel, kind: "skipped", reason: `larger than ${MAX_CHECKPOINT_FILE_BYTES} bytes` };
  }
  const data = await fs.readFile(abs);
  return { path: rel, kind: "file", data: data.toString("base64") };
}

/**
 * Record the current state of `absPaths` (and any missing parent dirs a write
 * would create) unless already captured in this checkpoint.
 * @param {string} root
 * @param {string} id
 * @param {string[]} absPaths
 */
export async function captureCheckpoint(root, id, absPaths) {
  if (!isValidCheckpointId(id)) {
    throw Object.assign(new Error("invalid checkpointId"), { status: 400 });
  }
  const manifest = await loadManifest(root, id);
  if (manifest.entries.length === 0) await pruneOldCheckpoints(root, id);
  const seen = new Set(manifest.entries.map((e) => e.path));
  const targets = [];
  for (const abs of absPaths) {
    // Missing ancestors are created by writes; record them so restore can
    // remove them again (outermost first, so restore can sort deepest-first).
    const missing = [];
    let dir = path.dirname(abs);
    while (relInside(root, dir)) {
      try {
        await fs.lstat(dir);
        break;
      } catch {
        missing.unshift(dir);
        dir = path.dirname(dir);
      }
    }
    targets.push(...missing, abs);
  }
  let added = 0;
  for (const abs of targets) {
    const entry = await snapshotEntry(root, abs);
    if (!entry || seen.has(entry.path)) continue;
    seen.add(entry.path);
    manifest.entries.push(entry);
    added += 1;
  }
  if (added > 0 || manifest.entries.length === 0) await saveManifest(root, manifest);
  return { id, paths: manifest.entries.map((e) => e.path) };
}

/** List captured paths, or null when the checkpoint does not exist. */
export async function readCheckpoint(root, id) {
  if (!isValidCheckpointId(id)) return null;
  try {
    await fs.access(manifestPath(root, id));
  } catch {
    return null;
  }
  const manifest = await loadManifest(root, id);
  return {
    id,
    createdAt: manifest.createdAt,
    paths: manifest.entries.map((e) => e.path),
    skipped: manifest.entries.filter((e) => e.kind === "skipped").map((e) => e.path),
  };
}

/**
 * Put every captured path back to its pre-turn state, then delete the
 * checkpoint. Returns restored / removed / skipped relative paths.
 */
export async function restoreCheckpoint(root, id) {
  const info = await readCheckpoint(root, id);
  if (!info) {
    throw Object.assign(new Error(`Checkpoint not found: ${id}`), { status: 404 });
  }
  const manifest = await loadManifest(root, id);
  const restored = [];
  const removed = [];
  const skipped = [];
  const resolve = (rel) => {
    const abs = path.resolve(root, rel);
    return relInside(root, abs) ? abs : null;
  };
  for (const entry of manifest.entries) {
    const abs = resolve(entry.path);
    if (!abs) continue;
    if (entry.kind === "file") {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, Buffer.from(entry.data, "base64"));
      restored.push(entry.path);
    } else if (entry.kind === "dir") {
      await fs.mkdir(abs, { recursive: true });
    } else if (entry.kind === "skipped") {
      skipped.push(entry.path);
    }
  }
  // Remove what the turn created, deepest paths first so dirs end up empty.
  const absent = manifest.entries
    .filter((e) => e.kind === "absent")
    .sort((a, b) => b.path.split("/").length - a.path.split("/").length);
  for (const entry of absent) {
    const abs = resolve(entry.path);
    if (!abs) continue;
    try {
      const stat = await fs.lstat(abs);
      if (stat.isDirectory()) await fs.rmdir(abs);
      else await fs.rm(abs);
      removed.push(entry.path);
    } catch {
      // Already gone, or a directory that now holds other files — leave it.
    }
  }
  await fs.rm(manifestPath(root, id), { force: true });
  return { id, restored, removed, skipped };
}
