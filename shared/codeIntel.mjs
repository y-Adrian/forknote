/**
 * Lightweight TS/JS symbol + import helpers for the ForkNote sidecar.
 * No runtime deps (works in packaged Electron without typescript in asar).
 */

export const CODE_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
]);

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".vite",
  "release",
]);

const MAX_FILE_BYTES = 400 * 1024;
const MAX_SYMBOLS = 200;
const MAX_REFS = 80;
const MAX_IMPORT_EDGES = 400;

/** @param {string} name */
export function shouldSkipDir(name) {
  return SKIP_DIRS.has(name) || name.startsWith(".");
}

/** @param {string} filePath */
export function isCodeFile(filePath) {
  const lower = filePath.toLowerCase();
  const i = lower.lastIndexOf(".");
  if (i < 0) return false;
  return CODE_EXTS.has(lower.slice(i));
}

/**
 * Strip // and /* * / comments and string/template literals for safer scans.
 * @param {string} source
 */
export function maskNoise(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1];
    if (c === "/" && n === "/") {
      out += "  ";
      i += 2;
      while (i < source.length && source[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    if (c === "/" && n === "*") {
      out += "  ";
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < source.length) {
        out += "  ";
        i += 2;
      }
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      out += " ";
      i++;
      while (i < source.length) {
        if (source[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          out += " ";
          i++;
          break;
        }
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** @param {string} source @param {number} index */
export function lineAt(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

/** @param {string} source @param {number} line */
export function lineText(source, line) {
  const lines = source.split("\n");
  return (lines[line - 1] ?? "").trim().slice(0, 160);
}

/**
 * @typedef {{ name: string, kind: string, line: number, exported: boolean, snippet: string }} SymbolHit
 */

/**
 * @param {string} source
 * @param {string} [filterName]
 * @returns {SymbolHit[]}
 */
export function extractSymbols(source, filterName) {
  const masked = maskNoise(source);
  /** @type {SymbolHit[]} */
  const hits = [];
  const seen = new Set();

  /** @param {string} name @param {string} kind @param {number} index @param {boolean} exported */
  const push = (name, kind, index, exported) => {
    if (!name || (filterName && name !== filterName)) return;
    const line = lineAt(source, index);
    const key = `${name}:${kind}:${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({
      name,
      kind,
      line,
      exported,
      snippet: lineText(source, line),
    });
  };

  const patterns = [
    {
      re: /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g,
      kind: "function",
    },
    {
      re: /\b(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g,
      kind: "class",
    },
    {
      re: /\b(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/g,
      kind: "interface",
    },
    {
      re: /\b(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<]/g,
      kind: "type",
    },
    {
      re: /\b(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/g,
      kind: "enum",
    },
    {
      re: /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
      kind: "variable",
    },
    {
      re: /\b(?:export\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
      kind: "function",
    },
  ];

  for (const { re, kind } of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(masked)) !== null) {
      const name = m[1];
      const start = m.index;
      const window = masked.slice(Math.max(0, start - 24), start + m[0].length);
      const exported = /\bexport\b/.test(window);
      push(name, kind, start, exported);
      if (hits.length >= MAX_SYMBOLS) return hits;
    }
  }

  return hits;
}

/**
 * @param {string} source
 * @param {string} name
 */
export function findIdentifierRefs(source, name) {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return [];
  const masked = maskNoise(source);
  const re = new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\b`, "g");
  /** @type {{ line: number, snippet: string }[]} */
  const refs = [];
  let m;
  while ((m = re.exec(masked)) !== null) {
    const line = lineAt(source, m.index);
    refs.push({ line, snippet: lineText(source, line) });
    if (refs.length >= MAX_REFS) break;
  }
  return refs;
}

/**
 * @param {string} source
 * @param {string} fromPath relative posix path of the file
 * @returns {{ from: string, to: string, kind: string, line: number }[]}
 */
export function extractImports(source, fromPath) {
  const masked = maskNoise(source);
  /** @type {{ from: string, to: string, kind: string, line: number }[]} */
  const edges = [];
  const patterns = [
    { re: /\bimport\s+(?:type\s+)?[\s\S]*?\bfrom\s+["']([^"']+)["']/g, kind: "import" },
    { re: /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, kind: "dynamic" },
    { re: /\bexport\s+[\s\S]*?\bfrom\s+["']([^"']+)["']/g, kind: "reexport" },
    { re: /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g, kind: "require" },
  ];
  for (const { re, kind } of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(masked)) !== null) {
      edges.push({
        from: fromPath,
        to: m[1],
        kind,
        line: lineAt(source, m.index),
      });
      if (edges.length >= MAX_IMPORT_EDGES) return edges;
    }
  }
  return edges;
}

/**
 * Resolve a relative/bare specifier against a file path (relative only for ./ ../).
 * @param {string} fromFile
 * @param {string} spec
 */
export function resolveImportSpec(fromFile, spec) {
  if (!spec.startsWith(".")) return { kind: "external", spec };
  const fromDir = fromFile.includes("/")
    ? fromFile.slice(0, fromFile.lastIndexOf("/"))
    : ".";
  const joined = (fromDir === "." ? spec : `${fromDir}/${spec}`)
    .replace(/\\/g, "/")
    .split("/");
  /** @type {string[]} */
  const stack = [];
  for (const part of joined) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return { kind: "relative", spec: stack.join("/") };
}
