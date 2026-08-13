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

/** Lift a legacy executeToolCall payload into the unified Result. */
export function toToolResult(
  legacy: Pick<LegacyToolExecution, "ok" | "resultText"> & {
    timedOut?: boolean;
    exitCode?: number | null;
    data?: Record<string, unknown>;
    partial?: boolean;
  },
): ToolResult {
  const rawOutput = legacy.resultText ?? "";
  if (legacy.ok) {
    const status: ToolResultStatus = legacy.partial ? "partial" : "success";
    const resultText = normalizeObserveOutput(rawOutput);
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
  const head = result.ok
    ? `${tool}: ${result.status}`
    : `${tool}: error/${result.errorType ?? "unknown"}`;
  const body = (result.ok ? result.resultText : result.rawOutput)
    .replace(/\s+/g, " ")
    .trim();
  if (!body) return head;
  const slice = body.length > max ? `${body.slice(0, max)}…` : body;
  return `${head} — ${slice}`;
}
