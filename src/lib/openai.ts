import type { ApiSettings } from "../types";
import { formatApiError } from "./apiError";
import {
  isLikelyLocalEndpoint,
  proxyTargetFromBaseUrl,
  resolveApiUrl,
} from "./settings";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type StreamChatOptions = {
  signal?: AbortSignal;
  /** 默认 0.6；追问澄清建议更低，减少发散 */
  temperature?: number;
};

export async function streamChat(
  settings: ApiSettings,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  options?: StreamChatOptions | AbortSignal,
): Promise<string> {
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

  const response = await fetch(url, {
    method: "POST",
    headers,
    signal: opts.signal,
    body: JSON.stringify({
      model: settings.model,
      messages,
      stream: true,
      temperature,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(formatApiError(response.status, errText));
  }

  if (!response.body) {
    throw new Error("Empty response body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

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
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            onDelta(delta);
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
  return full;
}
