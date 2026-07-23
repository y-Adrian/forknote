export function formatApiError(status: number, errText: string): string {
  let detail = errText.trim().slice(0, 300) || `HTTP ${status}`;
  try {
    const json = JSON.parse(errText) as {
      error?: { message?: string };
      message?: string;
    };
    detail =
      json.error?.message?.trim() ||
      json.message?.trim() ||
      detail;
  } catch {
    // keep raw slice
  }

  if (status === 401) {
    return [
      "API 401: Authentication failed (DeepSeek governor).",
      "Check: (1) Create and copy an API Key at platform.deepseek.com;",
      "(2) In settings, Base URL is https://api.deepseek.com and Model is deepseek-chat;",
      "(3) Key has no leading/trailing spaces and is not an OpenAI sk- key; (4) Save and retry.",
      detail ? `Server: ${detail}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (status === 402) {
    return `API 402: Insufficient balance — top up in the DeepSeek console.${detail ? ` (${detail})` : ""}`;
  }

  return `API ${status}: ${detail}`;
}
