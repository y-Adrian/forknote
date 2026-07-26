/**
 * ForkNote local project sidecar — filesystem ops confined under a bound root.
 * Listen: http://127.0.0.1:8787
 */

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { isDeniedTerminalCommand } from "../shared/terminalDenyList.mjs";

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.SIDECAR_PORT || 8787);
const HOST = process.env.SIDECAR_HOST || "127.0.0.1";
const MAX_READ_BYTES = 200 * 1024;
const MAX_WRITE_BYTES = 2 * 1024 * 1024;
const MAX_RUN_OUTPUT_BYTES = 200 * 1024;
const DEFAULT_RUN_TIMEOUT_MS = 60_000;
const MIN_RUN_TIMEOUT_MS = 1_000;
const MAX_RUN_TIMEOUT_MS = 300_000;
const MAX_COMMAND_CHARS = 8_000;
const MAX_LIST_ENTRIES = 500;
const MAX_SEARCH_HITS = 40;
const SEARCH_SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".vite",
]);

/** @type {string | null} */
let projectRoot = null;

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(data);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

/**
 * Resolve a user path relative to project root.
 * Absolute paths are accepted only when they point inside the open project
 * (converted to relative). Otherwise rejected with a clear error.
 * @param {string} rel
 */
function resolveSafe(rel) {
  if (!projectRoot) {
    throw Object.assign(new Error("No project open"), { status: 400 });
  }
  const root = path.resolve(projectRoot);
  let input = String(rel ?? ".").trim() || ".";

  // Normalize model typos: "//foo.c", "///src/a.cpp" → treat as project-relative
  // (real UNC "//server/share" is not used for local sidecar paths)
  if (/^\/\/+/.test(input) && !/^\/\/[^/]+\/[^/]/.test(input)) {
    input = input.replace(/^\/+/, "") || ".";
  }

  // "/src/foo" or "/file.cpp" — project-relative with a mistaken leading slash
  if (
    input.startsWith("/") &&
    !input.startsWith("//") &&
    !/^\/(?:Users|home|private|var|tmp|etc|Volumes|mnt|opt)\b/i.test(input)
  ) {
    input = input.replace(/^\/+/, "") || ".";
  }

  // Full absolute path → allow only if inside project root
  if (path.isAbsolute(input)) {
    const abs = path.resolve(input);
    const relToRoot = path.relative(root, abs);
    if (!relToRoot.startsWith("..") && !path.isAbsolute(relToRoot)) {
      return {
        root,
        resolved: abs,
        relative: relToRoot.split(path.sep).join("/") || ".",
      };
    }
    throw Object.assign(
      new Error(
        `Absolute paths outside the project are not allowed. Use a path relative to the project root, e.g. "array_and_subarrays.cpp" or "src/main.cpp" (project: ${root}). Received: ${String(rel).trim()}`,
      ),
      { status: 400 },
    );
  }

  if (input.split(/[/\\]/).some((seg) => seg === "..")) {
    throw Object.assign(new Error("Path traversal (..) is not allowed"), {
      status: 400,
    });
  }

  const resolved = path.resolve(root, input);
  const relToRoot = path.relative(root, resolved);
  if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
    throw Object.assign(new Error("Path escapes project root"), {
      status: 400,
    });
  }
  return {
    root,
    resolved,
    relative: relToRoot.split(path.sep).join("/") || ".",
  };
}

async function handleOpen(body) {
  const raw = String(body?.path ?? "").trim();
  if (!raw) {
    throw Object.assign(new Error("path is required"), { status: 400 });
  }
  // Reject relative paths with a clear hint (UI asks for absolute path).
  if (!path.isAbsolute(raw)) {
    throw Object.assign(
      new Error(
        `Use an absolute path, e.g. /Users/you/projects/my-app (received relative: "${raw}")`,
      ),
      { status: 400 },
    );
  }
  const resolved = path.resolve(raw);
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    throw Object.assign(new Error(`Directory not found: ${resolved}`), {
      status: 404,
    });
  }
  if (!stat.isDirectory()) {
    throw Object.assign(new Error("path must be a directory"), { status: 400 });
  }
  projectRoot = resolved;
  return { root: projectRoot };
}

/**
 * Open a native OS folder dialog and return the absolute path.
 * Cancel → { cancelled: true, path: null }.
 */
async function handlePickFolder() {
  const platform = process.platform;
  try {
    if (platform === "darwin") {
      const { stdout } = await execFileAsync(
        "osascript",
        [
          "-e",
          'POSIX path of (choose folder with prompt "Select a ForkNote project folder")',
        ],
        { timeout: 300_000, maxBuffer: 1024 * 1024 },
      );
      const picked = stdout.trim().replace(/\/+$/, "");
      if (!picked) return { cancelled: true, path: null };
      return { cancelled: false, path: path.resolve(picked) };
    }

    if (platform === "win32") {
      const script = [
        "Add-Type -AssemblyName System.Windows.Forms | Out-Null",
        "$b = New-Object System.Windows.Forms.FolderBrowserDialog",
        '$b.Description = "Select a ForkNote project folder"',
        "$b.ShowNewFolderButton = $true",
        "if ($b.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
        "  [Console]::Out.Write($b.SelectedPath)",
        "}",
      ].join("; ");
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-STA", "-Command", script],
        { timeout: 300_000, maxBuffer: 1024 * 1024, windowsHide: true },
      );
      const picked = stdout.trim().replace(/[\\/]+$/, "");
      if (!picked) return { cancelled: true, path: null };
      return { cancelled: false, path: path.resolve(picked) };
    }

    // Linux / other: prefer zenity, then kdialog
    try {
      const { stdout } = await execFileAsync(
        "zenity",
        ["--file-selection", "--directory", "--title=Select a ForkNote project folder"],
        { timeout: 300_000, maxBuffer: 1024 * 1024 },
      );
      const picked = stdout.trim().replace(/\/+$/, "");
      if (!picked) return { cancelled: true, path: null };
      return { cancelled: false, path: path.resolve(picked) };
    } catch (zenityErr) {
      const code = /** @type {{ code?: number|string }} */ (zenityErr).code;
      // zenity cancel → exit 1
      if (code === 1) return { cancelled: true, path: null };
      try {
        const { stdout } = await execFileAsync(
          "kdialog",
          ["--getexistingdirectory", process.env.HOME || "/", "Select a ForkNote project folder"],
          { timeout: 300_000, maxBuffer: 1024 * 1024 },
        );
        const picked = stdout.trim().replace(/\/+$/, "");
        if (!picked) return { cancelled: true, path: null };
        return { cancelled: false, path: path.resolve(picked) };
      } catch (kErr) {
        const kCode = /** @type {{ code?: number|string }} */ (kErr).code;
        if (kCode === 1) return { cancelled: true, path: null };
        throw Object.assign(
          new Error(
            "Folder picker needs zenity or kdialog on Linux. Install one, or paste an absolute path.",
          ),
          { status: 501 },
        );
      }
    }
  } catch (e) {
    const err = /** @type {{ code?: number|string, message?: string }} */ (e);
    // macOS user cancelled choose folder
    if (
      platform === "darwin" &&
      (err.code === 1 || /User canceled|cancelled/i.test(String(err.message ?? "")))
    ) {
      return { cancelled: true, path: null };
    }
    if (err.status) throw e;
    throw Object.assign(
      new Error(e instanceof Error ? e.message : "Folder picker failed"),
      { status: 500 },
    );
  }
}

async function handleList(query) {
  const { resolved, relative } = resolveSafe(query.get("path") || ".");
  let entries;
  try {
    entries = await fs.readdir(resolved, { withFileTypes: true });
  } catch (e) {
    throw Object.assign(
      new Error(e instanceof Error ? e.message : "Failed to list directory"),
      { status: 404 },
    );
  }
  const items = entries
    .slice(0, MAX_LIST_ENTRIES)
    .map((d) => ({
      name: d.name,
      type: d.isDirectory() ? "dir" : d.isFile() ? "file" : "other",
      path: relative === "." ? d.name : `${relative}/${d.name}`,
    }))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  return { path: relative, entries: items };
}

async function handleRead(query) {
  const { resolved, relative } = resolveSafe(query.get("path") || "");
  if (!query.get("path")) {
    throw Object.assign(new Error("path is required"), { status: 400 });
  }
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    throw Object.assign(new Error(`File not found: ${relative}`), {
      status: 404,
    });
  }
  if (!stat.isFile()) {
    throw Object.assign(new Error("path is not a file"), { status: 400 });
  }
  if (stat.size > MAX_READ_BYTES) {
    throw Object.assign(
      new Error(
        `File too large (${stat.size} bytes; max ${MAX_READ_BYTES}). Use a smaller file.`,
      ),
      { status: 413 },
    );
  }
  const content = await fs.readFile(resolved, "utf8");
  return { path: relative, content, size: Buffer.byteLength(content, "utf8") };
}

async function handleWrite(body) {
  const filePath = String(body?.path ?? "").trim();
  if (!filePath) {
    throw Object.assign(new Error("path is required"), { status: 400 });
  }
  if (typeof body?.content !== "string") {
    throw Object.assign(new Error("content must be a string"), { status: 400 });
  }
  const bytes = Buffer.byteLength(body.content, "utf8");
  if (bytes > MAX_WRITE_BYTES) {
    throw Object.assign(
      new Error(`Content too large (${bytes} bytes; max ${MAX_WRITE_BYTES})`),
      { status: 413 },
    );
  }
  const { resolved, relative } = resolveSafe(filePath);
  try {
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, body.content, "utf8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to write file";
    throw Object.assign(new Error(`Cannot write ${relative}: ${msg}`), {
      status: 500,
    });
  }
  return { path: relative, size: bytes, written: true };
}

/**
 * Exact string replace in a UTF-8 text file (agent-style edit, not full rewrite).
 * Body: { path, old_string, new_string, replace_all?: boolean }
 */
async function handleSearchReplace(body) {
  const filePath = String(body?.path ?? "").trim();
  if (!filePath) {
    throw Object.assign(new Error("path is required"), { status: 400 });
  }
  if (typeof body?.old_string !== "string") {
    throw Object.assign(new Error("old_string must be a string"), {
      status: 400,
    });
  }
  if (typeof body?.new_string !== "string") {
    throw Object.assign(new Error("new_string must be a string"), {
      status: 400,
    });
  }
  const oldStr = body.old_string;
  const newStr = body.new_string;
  if (oldStr.length === 0) {
    throw Object.assign(new Error("old_string must not be empty"), {
      status: 400,
    });
  }
  if (oldStr === newStr) {
    throw Object.assign(
      new Error("old_string and new_string are identical — nothing to change"),
      { status: 400 },
    );
  }
  const replaceAll = Boolean(body?.replace_all);

  const { resolved, relative } = resolveSafe(filePath);
  let original;
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) {
      throw Object.assign(new Error("path is not a file"), { status: 400 });
    }
    if (stat.size > MAX_READ_BYTES) {
      throw Object.assign(
        new Error(
          `File too large to edit in place (${stat.size} bytes; max ${MAX_READ_BYTES})`,
        ),
        { status: 413 },
      );
    }
    original = await fs.readFile(resolved, "utf8");
  } catch (e) {
    if (/** @type {{ status?: number }} */ (e).status) throw e;
    throw Object.assign(new Error(`File not found: ${relative}`), {
      status: 404,
    });
  }

  let occurrences = 0;
  let idx = 0;
  while ((idx = original.indexOf(oldStr, idx)) !== -1) {
    occurrences += 1;
    idx += oldStr.length;
  }
  if (occurrences === 0) {
    throw Object.assign(
      new Error(
        `old_string not found in ${relative}. Read the file again and copy the exact text to replace (including whitespace).`,
      ),
      { status: 400 },
    );
  }
  if (occurrences > 1 && !replaceAll) {
    throw Object.assign(
      new Error(
        `old_string matched ${occurrences} times in ${relative}. Provide a larger unique snippet, or set replace_all=true.`,
      ),
      { status: 409 },
    );
  }

  const next = replaceAll
    ? original.split(oldStr).join(newStr)
    : original.replace(oldStr, newStr);
  const bytes = Buffer.byteLength(next, "utf8");
  if (bytes > MAX_WRITE_BYTES) {
    throw Object.assign(
      new Error(`Result too large (${bytes} bytes; max ${MAX_WRITE_BYTES})`),
      { status: 413 },
    );
  }
  await fs.writeFile(resolved, next, "utf8");
  return {
    path: relative,
    size: bytes,
    written: true,
    kind: "search_replace",
    replacements: replaceAll ? occurrences : 1,
  };
}

/**
 * Apply multiple exact replacements to one UTF-8 file (sequential).
 * Body: { path, edits: [{ old_string, new_string }, ...] }
 */
async function handleApplyPatch(body) {
  const filePath = String(body?.path ?? "").trim();
  if (!filePath) {
    throw Object.assign(new Error("path is required"), { status: 400 });
  }
  if (!Array.isArray(body?.edits) || body.edits.length === 0) {
    throw Object.assign(new Error("edits must be a non-empty array"), {
      status: 400,
    });
  }
  if (body.edits.length > 40) {
    throw Object.assign(new Error("Too many edits (max 40)"), { status: 413 });
  }

  let total = 0;
  let last = null;
  for (let i = 0; i < body.edits.length; i++) {
    const edit = body.edits[i];
    try {
      last = await handleSearchReplace({
        path: filePath,
        old_string: edit?.old_string,
        new_string: edit?.new_string,
        replace_all: Boolean(edit?.replace_all),
      });
      total += last.replacements || 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "edit failed";
      throw Object.assign(
        new Error(`edit[${i}] failed on ${filePath}: ${msg}`),
        { status: /** @type {{ status?: number }} */ (e).status || 400 },
      );
    }
  }
  return {
    path: last?.path ?? filePath,
    size: last?.size ?? 0,
    written: true,
    kind: "apply_patch",
    edits: body.edits.length,
    replacements: total,
  };
}

/**
 * Create a .docx from structured paragraphs (UTF-8 text → Office Open XML).
 * Body: { path, title?, paragraphs: string[] }
 */
async function handleWriteDocx(body) {
  const filePath = String(body?.path ?? "").trim();
  if (!filePath) {
    throw Object.assign(new Error("path is required"), { status: 400 });
  }
  const paragraphs = Array.isArray(body?.paragraphs)
    ? body.paragraphs.map((p) => String(p ?? ""))
    : [];
  const title =
    typeof body?.title === "string" && body.title.trim()
      ? body.title.trim()
      : "";
  const blankDoc =
    !title &&
    (paragraphs.length === 0 ||
      paragraphs.every((p) => !String(p).replace(/\u200b/g, "").trim()));

  let withExt = filePath;
  if (!/\.docx$/i.test(withExt)) withExt = `${withExt}.docx`;

  const { Document, Packer, Paragraph, TextRun, HeadingLevel } =
    await import("docx");

  /** @type {import('docx').Paragraph[]} */
  const children = [];
  if (title) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        children: [new TextRun({ text: title, bold: true })],
      }),
    );
  }
  if (blankDoc) {
    children.push(new Paragraph({ children: [new TextRun("")] }));
  } else {
    for (const text of paragraphs) {
      const line = String(text ?? "");
      if (!line.trim() && !title) continue;
      children.push(new Paragraph({ children: [new TextRun(line)] }));
    }
  }

  const doc = new Document({
    sections: [{ properties: {}, children: children.length > 0 ? children : [new Paragraph({ children: [new TextRun("")] })] }],
  });
  const buffer = await Packer.toBuffer(doc);
  if (buffer.length > MAX_WRITE_BYTES) {
    throw Object.assign(
      new Error(
        `Generated .docx too large (${buffer.length} bytes; max ${MAX_WRITE_BYTES})`,
      ),
      { status: 413 },
    );
  }

  const { resolved, relative } = resolveSafe(withExt);
  try {
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, buffer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to write docx";
    throw Object.assign(new Error(`Cannot write ${relative}: ${msg}`), {
      status: 500,
    });
  }
  return {
    path: relative,
    size: buffer.length,
    written: true,
    kind: "docx",
  };
}

/**
 * Create a .xlsx from a 2D rows array.
 * Body: { path, sheet_name?, rows: (string|number|boolean|null)[][] }
 */
async function handleWriteXlsx(body) {
  const filePath = String(body?.path ?? "").trim();
  if (!filePath) {
    throw Object.assign(new Error("path is required"), { status: 400 });
  }
  if (!Array.isArray(body?.rows) || body.rows.length === 0) {
    throw Object.assign(
      new Error("rows must be a non-empty array of arrays"),
      { status: 400 },
    );
  }
  if (body.rows.length > 5000) {
    throw Object.assign(new Error("Too many rows (max 5000)"), {
      status: 413,
    });
  }

  let withExt = filePath;
  if (!/\.xlsx$/i.test(withExt)) withExt = `${withExt}.xlsx`;

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const sheetName =
    typeof body?.sheet_name === "string" && body.sheet_name.trim()
      ? body.sheet_name.trim().slice(0, 31)
      : "Sheet1";
  const ws = wb.addWorksheet(sheetName);

  for (const row of body.rows) {
    if (!Array.isArray(row)) {
      throw Object.assign(new Error("Each row must be an array"), {
        status: 400,
      });
    }
    if (row.length > 100) {
      throw Object.assign(new Error("Too many columns in a row (max 100)"), {
        status: 413,
      });
    }
    ws.addRow(
      row.map((cell) => {
        if (cell === null || cell === undefined) return "";
        if (
          typeof cell === "string" ||
          typeof cell === "number" ||
          typeof cell === "boolean"
        ) {
          return cell;
        }
        return String(cell);
      }),
    );
  }

  const { resolved, relative } = resolveSafe(withExt);
  try {
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await wb.xlsx.writeFile(resolved);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to write xlsx";
    throw Object.assign(new Error(`Cannot write ${relative}: ${msg}`), {
      status: 500,
    });
  }
  const stat = await fs.stat(resolved);
  if (stat.size > MAX_WRITE_BYTES) {
    await fs.unlink(resolved).catch(() => {});
    throw Object.assign(
      new Error(
        `Generated .xlsx too large (${stat.size} bytes; max ${MAX_WRITE_BYTES})`,
      ),
      { status: 413 },
    );
  }
  return {
    path: relative,
    size: stat.size,
    written: true,
    kind: "xlsx",
    rows: body.rows.length,
  };
}

async function handleMkdir(body) {
  const dirPath = String(body?.path ?? "").trim();
  if (!dirPath) {
    throw Object.assign(new Error("path is required"), { status: 400 });
  }
  const { resolved, relative } = resolveSafe(dirPath);
  await fs.mkdir(resolved, { recursive: true });
  return { path: relative, created: true };
}

/**
 * Simple recursive text search (no ripgrep dependency).
 * @param {string} query
 * @param {string} [subpath]
 */
async function handleSearch(body) {
  const query = String(body?.query ?? "").trim();
  if (!query) {
    throw Object.assign(new Error("query is required"), { status: 400 });
  }
  if (query.length > 200) {
    throw Object.assign(new Error("query too long"), { status: 400 });
  }
  const { root, resolved: start } = resolveSafe(body?.path || ".");
  const needle = query.toLowerCase();
  /** @type {{ path: string, line: number, text: string }[]} */
  const hits = [];

  async function walk(dir) {
    if (hits.length >= MAX_SEARCH_HITS) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (hits.length >= MAX_SEARCH_HITS) return;
      if (SEARCH_SKIP.has(ent.name) || ent.name.startsWith(".")) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!ent.isFile()) continue;
      let stat;
      try {
        stat = await fs.stat(full);
      } catch {
        continue;
      }
      if (stat.size > MAX_READ_BYTES || stat.size === 0) continue;
      let text;
      try {
        text = await fs.readFile(full, "utf8");
      } catch {
        continue;
      }
      // Skip likely binary
      if (text.includes("\0")) continue;
      const lines = text.split(/\r?\n/);
      const rel = path.relative(root, full).split(path.sep).join("/");
      for (let i = 0; i < lines.length; i++) {
        if (hits.length >= MAX_SEARCH_HITS) return;
        if (lines[i].toLowerCase().includes(needle)) {
          hits.push({
            path: rel,
            line: i + 1,
            text: lines[i].slice(0, 200),
          });
        }
      }
    }
  }

  await walk(start);
  return { query, hits, truncated: hits.length >= MAX_SEARCH_HITS };
}

/**
 * Append chunk into a capped Buffer; marks truncated when the cap is hit.
 * @param {{ buf: Buffer, truncated: boolean }} state
 * @param {Buffer | string} chunk
 */
function appendCapped(state, chunk) {
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  if (state.buf.length >= MAX_RUN_OUTPUT_BYTES) {
    state.truncated = true;
    return;
  }
  const room = MAX_RUN_OUTPUT_BYTES - state.buf.length;
  if (buf.length > room) {
    state.buf = Buffer.concat([state.buf, buf.subarray(0, room)]);
    state.truncated = true;
  } else {
    state.buf = Buffer.concat([state.buf, buf]);
  }
}

/**
 * Kill a spawned shell process (and children on POSIX via negative PID when possible).
 * @param {import("node:child_process").ChildProcess} child
 */
function killRunChild(child) {
  try {
    if (child.pid && process.platform !== "win32") {
      // Process group: spawn with detached below so SIGTERM reaches shell children.
      try {
        process.kill(-child.pid, "SIGTERM");
        return;
      } catch {
        // fall through to child.kill
      }
    }
    child.kill("SIGTERM");
  } catch {
    // ignore
  }
}

/**
 * Force-kill after a grace period.
 * @param {import("node:child_process").ChildProcess} child
 */
function forceKillRunChild(child) {
  try {
    if (child.pid && process.platform !== "win32") {
      try {
        process.kill(-child.pid, "SIGKILL");
        return;
      } catch {
        // fall through
      }
    }
    child.kill("SIGKILL");
  } catch {
    // ignore
  }
}

/**
 * Compare two directory paths (realpath when possible).
 * @param {string} a
 * @param {string} b
 */
async function rootsMatch(a, b) {
  try {
    const ra = await fs.realpath(a);
    const rb = await fs.realpath(b);
    return ra === rb;
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

/**
 * Heuristic: does this shell command target paths outside the project?
 * Catches `cd /`, `cd ~`, `ls /tmp`, absolute paths under /Users|/home|… that
 * are not under projectRoot. Used to require allowOutsideProject approval.
 * @param {string} command
 * @param {string} root
 */
function commandLeavesProject(command, root) {
  const raw = String(command ?? "").trim();
  if (!raw) return false;
  const rootAbs = path.resolve(root);

  /** @param {string} candidate */
  const outside = (candidate) => {
    const c = String(candidate ?? "").trim();
    if (!c) return false;
    if (c === "~" || c.startsWith("~/") || c === "$HOME" || c.startsWith("$HOME/") || c.startsWith("${HOME}")) {
      return true;
    }
    if (!path.isAbsolute(c) && !/^[A-Za-z]:[\\/]/.test(c)) return false;
    const abs = path.resolve(c);
    const rel = path.relative(rootAbs, abs);
    return rel.startsWith("..") || path.isAbsolute(rel);
  };

  // cd / pushd to home, root, or absolute outside project
  const cdRe =
    /(?:^|[;&|\n]|(?:&&|\|\|))\s*(?:cd|pushd)\s+(?:(?:--|-[LP]\s+)*)([^\s;|&]+)/gi;
  let m;
  while ((m = cdRe.exec(raw)) !== null) {
    let target = m[1].replace(/^['"]|['"]$/g, "");
    if (target === "-" || target === "--") continue;
    if (outside(target) || target === "/" || target === "\\" ) return true;
  }

  // Absolute path tokens (POSIX + common roots). Relative paths ignored.
  const absRe =
    /(?:^|[\s"'`=:(])((?:\/(?:Users|home|private|tmp|var|etc|Volumes|mnt|opt|root)(?:\/[^\s"'`;|&<>]*)?)|(?:\/)|(?:~(?:\/[^\s"'`;|&<>]*)?)|(?:\$\{?HOME\}?(?:\/[^\s"'`;|&<>]*)?))/g;
  while ((m = absRe.exec(raw)) !== null) {
    const token = m[1];
    if (token === "/" || token === "~" || token.startsWith("~/") || /\$\{?HOME\}?/.test(token)) {
      return true;
    }
    if (outside(token)) return true;
  }

  return false;
}

/**
 * Run a shell command with starting cwd under the bound project root.
 * Body: { command, cwd?, timeoutMs?, expectedRoot?, allowOutsideProject? }
 *
 * Uses `shell: true` so pipelines like `npm test && echo ok` work (same class
 * of agent UX as Cline). Starting cwd is always confined via resolveSafe to the
 * bound project (never process.cwd()). Commands that reference paths outside
 * the project require allowOutsideProject: true (UI approval).
 *
 * When `res` is provided, client disconnect / AbortSignal cancels the child
 * (response `close` before settle).
 *
 * @param {Record<string, unknown>} body
 * @param {http.ServerResponse | null} [res]
 */
function handleRun(body, res = null) {
  if (!projectRoot) {
    throw Object.assign(new Error("No project open"), { status: 400 });
  }
  const command = String(body?.command ?? "").trim();
  if (!command) {
    throw Object.assign(new Error("command is required"), { status: 400 });
  }
  if (command.length > MAX_COMMAND_CHARS) {
    throw Object.assign(
      new Error(`command too long (max ${MAX_COMMAND_CHARS} chars)`),
      { status: 400 },
    );
  }
  const denied = isDeniedTerminalCommand(command);
  if (denied.denied) {
    throw Object.assign(
      new Error(
        denied.reason ||
          "Command blocked as dangerous by terminal deny-list",
      ),
      { status: 403 },
    );
  }

  const allowOutsideProject = Boolean(body?.allowOutsideProject);
  const expectedRaw =
    body?.expectedRoot === undefined || body?.expectedRoot === null
      ? ""
      : String(body.expectedRoot).trim();

  const cwdInput =
    body?.cwd === undefined || body?.cwd === null
      ? "."
      : String(body.cwd).trim() || ".";

  let timeoutMs = Number(body?.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS);
  if (!Number.isFinite(timeoutMs)) timeoutMs = DEFAULT_RUN_TIMEOUT_MS;
  timeoutMs = Math.min(
    MAX_RUN_TIMEOUT_MS,
    Math.max(MIN_RUN_TIMEOUT_MS, Math.round(timeoutMs)),
  );

  return (async () => {
    if (expectedRaw) {
      const expected = path.resolve(expectedRaw);
      if (!(await rootsMatch(projectRoot, expected))) {
        throw Object.assign(
          new Error(
            `Sidecar project root mismatch. Bound: ${projectRoot}. Expected: ${expected}. Re-open the project and retry.`,
          ),
          { status: 409 },
        );
      }
    }

    // Starting cwd is always under the bound project — never process.cwd().
    const { resolved: cwd, relative, root } = resolveSafe(cwdInput);

    if (commandLeavesProject(command, root) && !allowOutsideProject) {
      throw Object.assign(
        new Error(
          "Command targets paths outside the bound project. Approve outside-project terminal access (权限) before running.",
        ),
        { status: 403 },
      );
    }

    let stat;
    try {
      stat = await fs.stat(cwd);
    } catch {
      throw Object.assign(new Error(`cwd not found: ${relative}`), {
        status: 404,
      });
    }
    if (!stat.isDirectory()) {
      throw Object.assign(new Error("cwd must be a directory"), {
        status: 400,
      });
    }

    return new Promise((resolve, reject) => {
      const stdoutState = { buf: Buffer.alloc(0), truncated: false };
      const stderrState = { buf: Buffer.alloc(0), truncated: false };
      let settled = false;
      let timedOut = false;
      let aborted = false;

      const child = spawn(command, {
        cwd,
        shell: true,
        windowsHide: true,
        env: process.env,
        // New process group on POSIX so timeout/abort can signal the whole tree
        // (shell + sleep/pipeline children), not only the wrapping shell.
        detached: process.platform !== "win32",
      });

      const timer = setTimeout(() => {
        timedOut = true;
        killRunChild(child);
        setTimeout(() => forceKillRunChild(child), 2_000).unref?.();
      }, timeoutMs);

      const onClientGone = () => {
        if (settled) return;
        aborted = true;
        killRunChild(child);
        setTimeout(() => forceKillRunChild(child), 2_000).unref?.();
      };

      // Client AbortSignal / disconnect: response closes before we finish.
      // (Request 'close' is unreliable here — body was already fully read.)
      if (res) {
        res.on("close", onClientGone);
      }

      child.stdout?.on("data", (chunk) => appendCapped(stdoutState, chunk));
      child.stderr?.on("data", (chunk) => appendCapped(stderrState, chunk));

      const shapeResult = (extra) => ({
        exitCode: extra.exitCode,
        stdout: stdoutState.buf.toString("utf8"),
        stderr: extra.stderr ?? stderrState.buf.toString("utf8"),
        truncated: stdoutState.truncated || stderrState.truncated,
        /** Relative to project root ("." or "subdir"). */
        cwd: relative,
        /** Absolute starting cwd (always under project root). */
        cwdAbsolute: cwd,
        /** Absolute bound project root used for this run. */
        projectRoot: root,
        timedOut: Boolean(extra.timedOut),
        ...(extra.aborted ? { aborted: true } : {}),
      });

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (res) res.off?.("close", onClientGone);
        reject(
          Object.assign(
            new Error(err instanceof Error ? err.message : "Failed to spawn"),
            { status: 500 },
          ),
        );
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (res) res.off?.("close", onClientGone);
        // Client already gone — do not bother shaping a body they will not read.
        if (aborted && res && res.writableEnded === false && res.destroyed) {
          resolve(
            shapeResult({
              exitCode: 130,
              timedOut: false,
              aborted: true,
            }),
          );
          return;
        }
        let stderr = stderrState.buf.toString("utf8");
        if (timedOut) {
          stderr = stderr
            ? `${stderr}\n(command timed out after ${timeoutMs}ms)`
            : `(command timed out after ${timeoutMs}ms)`;
        }
        resolve(
          shapeResult({
            exitCode: typeof code === "number" ? code : timedOut ? 124 : 1,
            stderr,
            timedOut,
          }),
        );
      });
    });
  })();
}

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  const pathname = url.pathname.replace(/\/$/, "") || "/";

  try {
    if (req.method === "POST" && pathname === "/project/open") {
      const body = await readBody(req);
      return sendJson(res, 200, await handleOpen(body));
    }
    if (req.method === "POST" && pathname === "/project/pick-folder") {
      return sendJson(res, 200, await handlePickFolder());
    }
    if (req.method === "GET" && pathname === "/project") {
      return sendJson(res, 200, { root: projectRoot });
    }
    if (req.method === "POST" && pathname === "/project/close") {
      projectRoot = null;
      return sendJson(res, 200, { root: null });
    }
    if (req.method === "GET" && pathname === "/fs/list") {
      return sendJson(res, 200, await handleList(url.searchParams));
    }
    if (req.method === "GET" && pathname === "/fs/read") {
      return sendJson(res, 200, await handleRead(url.searchParams));
    }
    if (req.method === "POST" && pathname === "/fs/write") {
      const body = await readBody(req);
      return sendJson(res, 200, await handleWrite(body));
    }
    if (req.method === "POST" && pathname === "/fs/search_replace") {
      const body = await readBody(req);
      return sendJson(res, 200, await handleSearchReplace(body));
    }
    if (req.method === "POST" && pathname === "/fs/apply_patch") {
      const body = await readBody(req);
      return sendJson(res, 200, await handleApplyPatch(body));
    }
    if (req.method === "POST" && pathname === "/fs/write_docx") {
      const body = await readBody(req);
      return sendJson(res, 200, await handleWriteDocx(body));
    }
    if (req.method === "POST" && pathname === "/fs/write_xlsx") {
      const body = await readBody(req);
      return sendJson(res, 200, await handleWriteXlsx(body));
    }
    if (req.method === "POST" && pathname === "/fs/mkdir") {
      const body = await readBody(req);
      return sendJson(res, 200, await handleMkdir(body));
    }
    if (req.method === "POST" && pathname === "/fs/search") {
      const body = await readBody(req);
      return sendJson(res, 200, await handleSearch(body));
    }
    if (req.method === "POST" && pathname === "/fs/run") {
      const body = await readBody(req);
      const result = await handleRun(body, res);
      if (res.writableEnded || res.destroyed) return;
      return sendJson(res, 200, result);
    }
    if (req.method === "GET" && pathname === "/health") {
      return sendJson(res, 200, { ok: true, root: projectRoot });
    }
    sendError(res, 404, `Unknown route: ${req.method} ${pathname}`);
  } catch (e) {
    const status = /** @type {{ status?: number }} */ (e).status || 500;
    const message = e instanceof Error ? e.message : "Internal error";
    sendError(res, status, message);
  }
}

const server = http.createServer((req, res) => {
  void handler(req, res);
});

server.listen(PORT, HOST, () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  console.log(`ForkNote sidecar listening on http://${HOST}:${PORT}`);
  console.log(`  cwd hint: ${path.resolve(here, "..")}`);
  console.log(`  health:   GET /health`);
});

function portOwnerHint() {
  return process.platform === "win32"
    ? `netstat -ano | findstr :${PORT}`
    : `lsof -nP -iTCP:${PORT} -sTCP:LISTEN`;
}

/** @returns {Promise<boolean>} */
function probeOwnHealth() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: HOST, port: PORT, path: "/health", timeout: 800 },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          body += c;
        });
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            resolve(res.statusCode === 200 && data && data.ok === true);
          } catch {
            resolve(false);
          }
        });
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

// Fail fast if port taken — with an actionable message (and reuse if already us).
server.on("error", (err) => {
  const code = /** @type {{ code?: string }} */ (err).code;
  if (code === "EADDRINUSE") {
    void probeOwnHealth().then((healthy) => {
      if (healthy) {
        console.log(
          `ForkNote sidecar already listening on http://${HOST}:${PORT} — nothing to start.`,
        );
        console.log(`  health: GET http://${HOST}:${PORT}/health`);
        process.exit(0);
        return;
      }
      console.error(
        `ForkNote sidecar could not bind http://${HOST}:${PORT} (address already in use).`,
      );
      console.error(
        `  Another process owns that port and it is not a healthy ForkNote sidecar.`,
      );
      console.error(`  See who owns it: ${portOwnerHint()}`);
      console.error(
        `  Free the port, or set SIDECAR_PORT to an unused port, then retry.`,
      );
      process.exit(1);
    });
    return;
  }
  console.error(err);
  process.exit(1);
});
