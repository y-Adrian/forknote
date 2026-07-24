/**
 * ForkNote local project sidecar — filesystem ops confined under a bound root.
 * Listen: http://127.0.0.1:8787
 */

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.SIDECAR_PORT || 8787);
const HOST = process.env.SIDECAR_HOST || "127.0.0.1";
const MAX_READ_BYTES = 200 * 1024;
const MAX_WRITE_BYTES = 2 * 1024 * 1024;
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

// Fail fast if port taken
server.on("error", (err) => {
  console.error(err);
  process.exit(1);
});
