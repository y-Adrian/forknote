import type { ApiSettings } from "../types";
import { formatApiError } from "./apiError";
import { diffSplitReasoning } from "./reasoning";
import { parseTokenUsage, type TokenUsage, type ModelMetrics } from "./modelMetrics";
import {
  isLikelyLocalEndpoint,
  proxyTargetFromBaseUrl,
  resolveApiUrl,
} from "./settings";

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
};

export type OpenAITool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type StreamChatOptions = {
  onMetrics?: (metrics: Omit<ModelMetrics, "phase">) => void;
  signal?: AbortSignal;
  /** 默认 0.6；追问澄清 / 工具调用建议更低 */
  temperature?: number;
  /** OpenAI-compatible function tools (Cursor-style native tool calling). */
  tools?: OpenAITool[];
  toolChoice?:
    | "auto"
    | "none"
    | "required"
    | { type: "function"; function: { name: string } };
  /** Provider reasoning deltas (and think-tags peeled from content) */
  onReasoningDelta?: (text: string) => void;
};

export type StreamTiming = {
  startedAt: number;
  firstReasoningAt: number | null;
  lastReasoningAt: number | null;
  firstVisibleContentAt: number | null;
};

export type StreamChatResult = {
  usage: TokenUsage | null;
  durationMs: number;
  content: string;
  /** Accumulated reasoning (empty if provider omits it) */
  reasoning: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
  timing: StreamTiming;
};

function modelSupportsReasoning(modelRaw: string): boolean {
  const model = modelRaw.toLowerCase();
  return /reasoner|thinking|\br1\b|qwen3|qwq|gpt-oss|magistral|distill-r1/.test(
    model,
  );
}

/** Models / hosts that can emit a real reasoning channel when asked. */
function attachThinkingRequestOptions(
  body: Record<string, unknown>,
  settings: ApiSettings,
): boolean {
  if (!modelSupportsReasoning(settings.model)) return false;
  // OpenAI-compatible servers vary: many accept `reasoning_effort`, some reject it.
  // We attach it for known reasoning models, then auto-retry without it on 4xx.
  body.reasoning_effort = "medium";
  return true;
}

function stripThinkingRequestOptions(body: Record<string, unknown>): void {
  delete body.reasoning_effort;
  delete body.reasoning;
}

function isReasoningUnsupportedResponse(status: number, body: string): boolean {
  if (status !== 400 && status !== 404 && status !== 422) return false;
  const text = body.toLowerCase();
  return (
    text.includes("reasoning_effort") ||
    text.includes("unsupported") && text.includes("reasoning") ||
    text.includes("unknown field") && text.includes("reasoning") ||
    text.includes("unknown parameter") && text.includes("reasoning")
  );
}

function normalizeReasoningChunk(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeReasoningChunk(item))
      .filter(Boolean)
      .join("");
  }
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    return (
      normalizeReasoningChunk(rec.text) ||
      normalizeReasoningChunk(rec.content) ||
      normalizeReasoningChunk(rec.value) ||
      normalizeReasoningChunk(rec.reasoning)
    );
  }
  return "";
}

function reasoningPieceFromDelta(delta: {
  reasoning_content?: unknown;
  reasoning?: unknown;
  thinking?: unknown;
  reasoning_text?: unknown;
}): string {
  // Field names vary by provider — prefer explicit reasoning channels only.
  return (
    normalizeReasoningChunk(delta.reasoning_content) ||
    normalizeReasoningChunk(delta.reasoning) ||
    normalizeReasoningChunk(delta.thinking) ||
    normalizeReasoningChunk(delta.reasoning_text)
  );
}

export async function streamChat(
  settings: ApiSettings,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  options?: StreamChatOptions | AbortSignal,
): Promise<StreamChatResult> {
  // 兼容旧调用：第 4 参直接传 AbortSignal
  const opts: StreamChatOptions =
    options instanceof AbortSignal ? { signal: options } : (options ?? {});
  const temperature = opts.temperature ?? 0.6;

  const url = `${resolveApiUrl(settings)}/chat/completions`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (settings.useProxy) {
    const proxyTarget = proxyTargetFromBaseUrl(settings.baseUrl);
    if (!proxyTarget) {
      throw new Error(
        "Invalid Base URL for dev proxy. Open Settings → API, set Base URL (include https://), Save, and retry.",
      );
    }
    headers["X-Forknote-Target"] = proxyTarget;
  }
  // 本机服务通常不需要 Key；避免 localStorage 里残留的云端 Key 被误带上
  const apiKey = settings.apiKey.trim();
  if (apiKey && !isLikelyLocalEndpoint(settings.baseUrl)) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const body: Record<string, unknown> = {
    model: settings.model,
    messages,
    stream: true,
    temperature,
    stream_options: { include_usage: true },
  };
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools;
    body.tool_choice = opts.toolChoice ?? "auto";
  }
  const attachedThinkingHints = attachThinkingRequestOptions(body, settings);

  const doFetch = () =>
    fetch(url, {
      method: "POST",
      headers,
      signal: opts.signal,
      body: JSON.stringify(body),
    });

  let response = await doFetch();

  if (!response.ok && (response.status === 400 || response.status === 422)) {
    const errorText = await response.clone().text();
    if (/stream_options|include_usage/i.test(errorText)) {
      delete body.stream_options;
      response = await doFetch();
    }
  }

  if (!response.ok) {
    const errText = await response.text();
    if (attachedThinkingHints && isReasoningUnsupportedResponse(response.status, errText)) {
      stripThinkingRequestOptions(body);
      response = await doFetch();
    } else {
      const err = new Error(formatApiError(response.status, errText)) as Error & {
        status?: number;
        body?: string;
      };
      err.status = response.status;
      err.body = errText;
      throw err;
    }
  }

  if (!response.ok) {
    const errText = await response.text();
    const err = new Error(formatApiError(response.status, errText)) as Error & {
      status?: number;
      body?: string;
    };
    err.status = response.status;
    err.body = errText;
    throw err;
  }

  if (!response.body) {
    throw new Error("Empty response body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  /** Raw content channel (may still contain think-tags). */
  let contentRaw = "";
  /** Clean answer text after peeling think-tags. */
  let contentClean = "";
  let reasoningFull = "";
  let finishReason: string | null = null;
  let usage: TokenUsage | null = null;
  let splitCursor = { contentLen: 0, reasoningLen: 0 };
  const timing: StreamTiming = {
    startedAt: Date.now(),
    firstReasoningAt: null,
    lastReasoningAt: null,
    firstVisibleContentAt: null,
  };
  const toolAcc = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();
  const onReasoningDelta = opts.onReasoningDelta;

  const throwIfAborted = () => {
    if (opts.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
  };

  // Proxy streams sometimes ignore fetch abort until the reader is cancelled.
  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  opts.signal?.addEventListener("abort", onAbort);

  const appendApiReasoning = (piece: string) => {
    if (!piece) return;
    const now = Date.now();
    if (timing.firstReasoningAt == null) timing.firstReasoningAt = now;
    timing.lastReasoningAt = now;
    reasoningFull += piece;
    onReasoningDelta?.(piece);
  };

  const ingestContentPiece = (piece: string) => {
    if (!piece) return;
    contentRaw += piece;
    const diff = diffSplitReasoning(splitCursor, contentRaw);
    splitCursor = diff.next;
    contentClean = diff.content;
    if (diff.reasoningDelta) {
      // Think-tags live in the content channel for some local models.
      reasoningFull += diff.reasoningDelta;
      onReasoningDelta?.(diff.reasoningDelta);
    }
    if (diff.contentDelta) {
      if (timing.firstVisibleContentAt == null) {
        timing.firstVisibleContentAt = Date.now();
      }
      onDelta(diff.contentDelta);
    }
  };

  try {
    throwIfAborted();
    while (true) {
      throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      throwIfAborted();

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;

        try {
          const json = JSON.parse(data) as {
            usage?: unknown;
            choices?: Array<{
              finish_reason?: string | null;
              delta?: {
                content?: string | null;
                reasoning_content?: unknown;
                reasoning?: unknown;
                thinking?: unknown;
                reasoning_text?: unknown;
                tool_calls?: Array<{
                  index?: number;
                  id?: string;
                  type?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
            }>;
          };
          usage = parseTokenUsage(json.usage) ?? usage;
          const choice = json.choices?.[0];
          if (choice?.finish_reason) {
            finishReason = choice.finish_reason;
          }
          const delta = choice?.delta;
          if (!delta) continue;

          appendApiReasoning(reasoningPieceFromDelta(delta));

          if (typeof delta.content === "string" && delta.content) {
            ingestContentPiece(delta.content);
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const index = tc.index ?? 0;
              const cur = toolAcc.get(index) ?? {
                id: "",
                name: "",
                arguments: "",
              };
              if (tc.id) cur.id = tc.id;
              if (tc.function?.name) cur.name = tc.function.name;
              if (typeof tc.function?.arguments === "string") {
                cur.arguments += tc.function.arguments;
              }
              toolAcc.set(index, cur);
            }
          }
        } catch {
          // skip malformed chunks
        }
      }
    }
  } catch (e) {
    try {
      await reader.cancel();
    } catch {
      // ignore cancel errors
    }
    throw e;
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
  }

  throwIfAborted();

  const toolCalls: ToolCall[] = [...toolAcc.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, cur]) => ({
      id: cur.id || `call_${index}_${Date.now()}`,
      type: "function" as const,
      function: {
        name: cur.name,
        arguments: cur.arguments || "{}",
      },
    }))
    .filter((tc) => Boolean(tc.function.name));

  const durationMs = Date.now() - timing.startedAt;
  opts.onMetrics?.({ model: settings.model, durationMs, usage });
  return {
    usage,
    durationMs,
    content: contentClean,
    reasoning: reasoningFull,
    toolCalls,
    finishReason,
    timing,
  };
}

/** True when the provider likely rejected the tools parameter. */
export function isToolsUnsupportedError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const status = (e as Error & { status?: number }).status;
  const body = `${e.message} ${(e as Error & { body?: string }).body ?? ""}`.toLowerCase();
  if (status === 400 || status === 404 || status === 422) {
    return (
      body.includes("tool") ||
      body.includes("function") ||
      body.includes("tools") ||
      body.includes("tool_choice")
    );
  }
  return false;
}
