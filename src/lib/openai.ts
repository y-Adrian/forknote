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

export async function streamChat(
  settings: ApiSettings,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
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
    signal,
    body: JSON.stringify({
      model: settings.model,
      messages,
      stream: true,
      temperature: 0.6,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(formatApiError(response.status, errText));
  }

  if (!response.body) {
    throw new Error("响应体为空");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

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

  return full;
}
