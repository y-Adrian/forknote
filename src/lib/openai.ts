import type { ApiSettings } from "../types";
import { formatApiError } from "./apiError";
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
};

export type StreamChatResult = {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
};

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
    headers["X-Forknote-Target"] = proxyTargetFromBaseUrl(settings.baseUrl);
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
  };
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools;
    body.tool_choice = opts.toolChoice ?? "auto";
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    signal: opts.signal,
    body: JSON.stringify(body),
  });

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
  let full = "";
  let finishReason: string | null = null;
  const toolAcc = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();

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
            choices?: Array<{
              finish_reason?: string | null;
              delta?: {
                content?: string | null;
                tool_calls?: Array<{
                  index?: number;
                  id?: string;
                  type?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
            }>;
          };
          const choice = json.choices?.[0];
          if (choice?.finish_reason) {
            finishReason = choice.finish_reason;
          }
          const delta = choice?.delta;
          if (!delta) continue;

          if (typeof delta.content === "string" && delta.content) {
            full += delta.content;
            onDelta(delta.content);
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

  return { content: full, toolCalls, finishReason };
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
