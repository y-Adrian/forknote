/**
 * Unified tool Result — errors are first-class, not free-form strings.
 * ACT produces these; OBSERVE normalizes; REFLECT branches on errorType.
 */

export type ToolResultStatus = "success" | "partial" | "error";

export type ToolErrorType =
  | "timeout"
  | "invalid_input"
  | "permission"
  | "not_found"
  | "unknown";

export interface ToolResult {
  status: ToolResultStatus;
  /** Convenience: status !== "error" */
  ok: boolean;
  data?: Record<string, unknown>;
  errorType?: ToolErrorType;
  /** Untruncated tool payload for logs / UI. */
  rawOutput: string;
  /** Signal fed back to the model (may be normalized/truncated). */
  resultText: string;
}

export type LegacyToolExecution = {
  ok: boolean;
  resultText: string;
  activity: { kind: string; message: string; [k: string]: unknown };
  change?: { path: string; [k: string]: unknown };
};

const TIMEOUT_RE =
  /timeout|timed?\s*out|ETIMEDOUT|AbortError|aborted/i;
const PERMISSION_RE =
  /permission|EACCES|EPERM|denied|not allowed|outside (the )?project|unauthorized/i;
const NOT_FOUND_RE =
  /ENOENT|not found|no such file|does not exist|missing path/i;
const INVALID_RE =
  /invalid|required|must be|bad request|parse|malformed|empty (path|command)/i;

/** Classify a failed tool string into a stable error_type. */
export function classifyToolError(
  message: string,
  opts?: { timedOut?: boolean; exitCode?: number | null },
): ToolErrorType {
  if (opts?.timedOut) return "timeout";
  const text = message ?? "";
  if (TIMEOUT_RE.test(text)) return "timeout";
  if (PERMISSION_RE.test(text)) return "permission";
  if (NOT_FOUND_RE.test(text)) return "not_found";
  if (INVALID_RE.test(text)) return "invalid_input";
  if (opts?.exitCode != null && opts.exitCode !== 0) return "unknown";
  return "unknown";
}

/**
 * Drop noise from successful tool output so Reflect/Plan see task-relevant signal.
 * Rule-based (no LLM) for predictability and low cost.
 */
export function normalizeObserveOutput(
  raw: string,
  options?: { maxChars?: number },
): string {
  const max = options?.maxChars ?? 8_000;
  let text = (raw ?? "").replace(/\r\n/g, "\n");
  // Collapse long blank runs from logs.
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.7);
  const tail = max - head - 32;
  return `${text.slice(0, head)}\n…(observe truncated ${text.length - max} chars)…\n${text.slice(-tail)}`;
}

/** Caps for web_search / web_fetch observe payloads (model context). */
export const WEB_SEARCH_MAX_RESULTS = 6;
export const WEB_SEARCH_TITLE_MAX = 120;
export const WEB_SEARCH_URL_MAX = 200;
export const WEB_SEARCH_SNIPPET_MAX = 220;
export const WEB_SEARCH_RESULT_MAX_CHARS = 3_500;
export const WEB_FETCH_BODY_MAX_CHARS = 4_000;
export const WEB_FETCH_RESULT_MAX_CHARS = 4_500;

const WEB_BOILERPLATE_RE =
  /(?:cookie|cookies|privacy policy|terms of (?:use|service)|subscribe(?:\s+to)?\s+(?:our\s+)?newsletter|sign\s*up\s+for\s+(?:our\s+)?newsletter|accept\s+all\s+cookies|we\s+use\s+cookies|all\s+rights\s+reserved|©\s*\d{4}|跳过导航|接受全部 Cookie|隐私政策|用户协议)/gi;

/** Strip common search/page chrome before observe. */
export function stripWebBoilerplate(text: string): string {
  return (text ?? "")
    .replace(WEB_BOILERPLATE_RE, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function clipField(value: string, max: number): string {
  const t = value.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

type ParsedSearchHit = { title: string; url: string; snippet: string };

/** Parse the numbered web_search dump produced by executeToolCall. */
export function parseWebSearchResultText(raw: string): {
  queryNote: string | null;
  hits: ParsedSearchHit[];
} {
  const text = (raw ?? "").trim();
  if (!text) return { queryNote: null, hits: [] };
  if (/^\(no results/i.test(text)) {
    return { queryNote: text, hits: [] };
  }
  const blocks = text.split(/\n(?=\d+\.\s)/);
  const hits: ParsedSearchHit[] = [];
  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;
    const titleLine = lines[0].replace(/^\d+\.\s*/, "").trim();
    let url = "";
    let snippetParts: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!url && /^https?:\/\//i.test(line)) {
        url = line;
        continue;
      }
      snippetParts.push(line);
    }
    if (!titleLine && !url) continue;
    hits.push({
      title: titleLine || url || "(untitled)",
      url,
      snippet: snippetParts.join(" "),
    });
  }
  return { queryNote: null, hits };
}

/**
 * Normalize web_search output: capped title/url/snippet rows, no raw SERP dump.
 */
export function normalizeWebSearchOutput(raw: string): string {
  const { queryNote, hits } = parseWebSearchResultText(raw);
  if (queryNote) return clipField(queryNote, 240);
  if (hits.length === 0) {
    // Unstructured fallback — still denoise + hard-cap.
    return normalizeObserveOutput(stripWebBoilerplate(raw), {
      maxChars: WEB_SEARCH_RESULT_MAX_CHARS,
    });
  }
  const lines = hits.slice(0, WEB_SEARCH_MAX_RESULTS).map((h, i) => {
    const title = clipField(stripWebBoilerplate(h.title), WEB_SEARCH_TITLE_MAX);
    const url = clipField(h.url, WEB_SEARCH_URL_MAX);
    const snippet = clipField(
      stripWebBoilerplate(h.snippet),
      WEB_SEARCH_SNIPPET_MAX,
    );
    const parts = [`${i + 1}. ${title}`];
    if (url) parts.push(`   ${url}`);
    if (snippet) parts.push(`   ${snippet}`);
    return parts.join("\n");
  });
  let out = lines.join("\n\n");
  if (hits.length > WEB_SEARCH_MAX_RESULTS) {
    out += `\n\n…(+${hits.length - WEB_SEARCH_MAX_RESULTS} more hits omitted)`;
  }
  return normalizeObserveOutput(out, { maxChars: WEB_SEARCH_RESULT_MAX_CHARS });
}

/**
 * Normalize web_fetch output: keep URL/status header, truncate + denoise body.
 */
export function normalizeWebFetchOutput(raw: string): string {
  const text = (raw ?? "").replace(/\r\n/g, "\n");
  const headerMatch = text.match(
    /^(URL:\s*[^\n]+\nHTTP:\s*[^\n]+\nType:\s*[^\n]+\n\n?)/i,
  );
  const header = headerMatch?.[1] ?? "";
  const bodyRaw = header ? text.slice(header.length) : text;
  const body = stripWebBoilerplate(bodyRaw);
  const clippedBody = normalizeObserveOutput(body, {
    maxChars: WEB_FETCH_BODY_MAX_CHARS,
  });
  const combined = header ? `${header}${clippedBody}` : clippedBody;
  return normalizeObserveOutput(combined, {
    maxChars: WEB_FETCH_RESULT_MAX_CHARS,
  });
}

/** Tool-aware observe normalization (web tools get structured denoise). */
export function normalizeObserveOutputForTool(
  tool: string | undefined,
  raw: string,
  options?: { maxChars?: number },
): string {
  if (tool === "web_search") return normalizeWebSearchOutput(raw);
  if (tool === "web_fetch") return normalizeWebFetchOutput(raw);
  return normalizeObserveOutput(raw, options);
}

/** Lift a legacy executeToolCall payload into the unified Result. */
export function toToolResult(
  legacy: Pick<LegacyToolExecution, "ok" | "resultText"> & {
    timedOut?: boolean;
    exitCode?: number | null;
    data?: Record<string, unknown>;
    partial?: boolean;
    /** When set, apply tool-specific observe normalization (e.g. web_*). */
    tool?: string;
  },
): ToolResult {
  const rawOutput = legacy.resultText ?? "";
  if (legacy.ok) {
    const status: ToolResultStatus = legacy.partial ? "partial" : "success";
    const resultText = normalizeObserveOutputForTool(legacy.tool, rawOutput);
    return {
      status,
      ok: true,
      data: legacy.data,
      rawOutput,
      resultText,
    };
  }
  const errorType = classifyToolError(rawOutput, {
    timedOut: legacy.timedOut,
    exitCode: legacy.exitCode,
  });
  return {
    status: "error",
    ok: false,
    errorType,
    data: legacy.data,
    rawOutput,
    resultText: rawOutput,
  };
}

/** Compact one-line observe signal for working memory / reflect prompts. */
export function summarizeToolResultForMemory(
  tool: string,
  result: ToolResult,
  max = 240,
): string {
  const web = tool === "web_search" || tool === "web_fetch";
  const cap = web ? Math.min(max, 180) : max;
  const head = result.ok
    ? `${tool}: ${result.status}`
    : `${tool}: error/${result.errorType ?? "unknown"}`;
  const body = (result.ok ? result.resultText : result.rawOutput)
    .replace(/\s+/g, " ")
    .trim();
  if (!body) return head;
  const slice = body.length > cap ? `${body.slice(0, cap)}…` : body;
  return `${head} — ${slice}`;
}
