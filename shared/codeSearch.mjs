/**
 * Lightweight lexical "semantic" search (BM25) over code chunks.
 * No embedding API / no extra deps — good enough for “where is X handled?”.
 */

import { extractSymbols, isCodeFile, shouldSkipDir } from "./codeIntel.mjs";

const MAX_CHUNKS = 800;
const MAX_RESULTS = 20;

/** @param {string} text */
export function tokenize(text) {
  const raw = String(text || "");
  /** @type {string[]} */
  const tokens = [];
  const parts = raw.match(/[A-Za-z0-9_$]+/g) || [];
  for (const p of parts) {
    if (p.length < 2) continue;
    const lower = p.toLowerCase();
    tokens.push(lower);
    const split = p
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ")
      .toLowerCase()
      .split(/\s+/);
    for (const c of split) {
      if (c.length >= 2 && c !== lower) tokens.push(c);
    }
  }
  return tokens;
}

/**
 * @typedef {{ path: string, startLine: number, endLine: number, title: string, text: string }} CodeChunk
 */

/**
 * @param {string} rel
 * @param {string} source
 * @returns {CodeChunk[]}
 */
export function chunkSource(rel, source) {
  const lines = source.split("\n");
  /** @type {CodeChunk[]} */
  const chunks = [];
  const symbols = extractSymbols(source);
  if (symbols.length === 0) {
    const text = source.slice(0, 4000);
    if (text.trim()) {
      chunks.push({
        path: rel,
        startLine: 1,
        endLine: Math.min(lines.length, 120),
        title: rel,
        text: `${rel}\n${text}`,
      });
    }
    return chunks;
  }

  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    const start = Math.max(1, sym.line);
    const next = symbols[i + 1]?.line ?? Math.min(lines.length + 1, start + 80);
    const end = Math.min(lines.length, Math.max(start, next - 1), start + 79);
    const body = lines.slice(start - 1, end).join("\n");
    chunks.push({
      path: rel,
      startLine: start,
      endLine: end,
      title: `${sym.kind} ${sym.name}`,
      text: `${rel} ${sym.kind} ${sym.name}\n${body}`,
    });
  }
  return chunks;
}

/**
 * @param {CodeChunk[]} chunks
 * @param {string} query
 * @param {number} [limit]
 */
export function bm25Search(chunks, query, limit = 10) {
  const qTokens = tokenize(query);
  if (!qTokens.length || !chunks.length) return [];

  const N = chunks.length;
  /** @type {Map<string, number>} */
  const df = new Map();
  /** @type {Array<Map<string, number>>} */
  const tfs = [];

  for (const chunk of chunks) {
    const tokens = tokenize(chunk.text);
    /** @type {Map<string, number>} */
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    tfs.push(tf);
    const seen = new Set(tf.keys());
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }

  const avgdl =
    tfs.reduce((s, tf) => {
      let n = 0;
      for (const v of tf.values()) n += v;
      return s + n;
    }, 0) / Math.max(1, N);

  const k1 = 1.2;
  const b = 0.75;
  /** @type {Array<{ chunk: CodeChunk, score: number }>} */
  const scored = [];

  for (let i = 0; i < chunks.length; i++) {
    const tf = tfs[i];
    let dl = 0;
    for (const v of tf.values()) dl += v;
    let score = 0;
    for (const term of qTokens) {
      const f = tf.get(term) || 0;
      if (!f) continue;
      const n = df.get(term) || 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const denom = f + k1 * (1 - b + (b * dl) / Math.max(1, avgdl));
      score += idf * ((f * (k1 + 1)) / denom);
    }
    // Path / title boost
    const pathTok = tokenize(`${chunks[i].path} ${chunks[i].title}`);
    for (const term of qTokens) {
      if (pathTok.includes(term)) score += 1.5;
    }
    if (score > 0) scored.push({ chunk: chunks[i], score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.min(limit, MAX_RESULTS));
}

/**
 * Cancellable BM25 variant for sidecar requests. Yielding between batches lets
 * a client disconnect reach the AbortSignal while a large corpus is scored.
 *
 * @param {CodeChunk[]} chunks
 * @param {string} query
 * @param {number} [limit]
 * @param {{ signal?: AbortSignal }} [options]
 */
export async function bm25SearchAsync(
  chunks,
  query,
  limit = 10,
  options = {},
) {
  const { signal } = options;
  const check = () => {
    if (!signal?.aborted) return;
    throw Object.assign(new Error("Request aborted"), {
      name: "AbortError",
      code: "ABORT_ERR",
    });
  };
  const yieldToEvents = () =>
    new Promise((resolve) => setImmediate(resolve));
  const qTokens = tokenize(query);
  if (!qTokens.length || !chunks.length) return [];

  const N = chunks.length;
  /** @type {Map<string, number>} */
  const df = new Map();
  /** @type {Array<Map<string, number>>} */
  const tfs = [];

  for (let i = 0; i < chunks.length; i++) {
    check();
    const tokens = tokenize(chunks[i].text);
    /** @type {Map<string, number>} */
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    tfs.push(tf);
    for (const t of new Set(tf.keys())) {
      df.set(t, (df.get(t) || 0) + 1);
    }
    if (i > 0 && i % 25 === 0) await yieldToEvents();
  }

  let totalLength = 0;
  for (let i = 0; i < tfs.length; i++) {
    check();
    for (const value of tfs[i].values()) totalLength += value;
    if (i > 0 && i % 50 === 0) await yieldToEvents();
  }
  const avgdl = totalLength / Math.max(1, N);
  const k1 = 1.2;
  const b = 0.75;
  /** @type {Array<{ chunk: CodeChunk, score: number }>} */
  const scored = [];

  for (let i = 0; i < chunks.length; i++) {
    check();
    const tf = tfs[i];
    let dl = 0;
    for (const value of tf.values()) dl += value;
    let score = 0;
    for (const term of qTokens) {
      const f = tf.get(term) || 0;
      if (!f) continue;
      const n = df.get(term) || 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const denom = f + k1 * (1 - b + (b * dl) / Math.max(1, avgdl));
      score += idf * ((f * (k1 + 1)) / denom);
    }
    const pathTokens = tokenize(`${chunks[i].path} ${chunks[i].title}`);
    for (const term of qTokens) {
      if (pathTokens.includes(term)) score += 1.5;
    }
    if (score > 0) scored.push({ chunk: chunks[i], score });
    if (i > 0 && i % 25 === 0) await yieldToEvents();
  }

  check();
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.min(limit, MAX_RESULTS));
}

export { MAX_CHUNKS, isCodeFile, shouldSkipDir };
