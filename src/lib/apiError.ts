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
      "API 401: Authentication failed.",
      "Check: (1) API Key in settings matches your configured Base URL provider;",
      "(2) Key has no leading/trailing spaces;",
      "(3) Model name matches the provider console; (4) Save and retry.",
      detail ? `Server: ${detail}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (status === 402) {
    return `API 402: Insufficient balance — top up your provider account.${detail ? ` (${detail})` : ""}`;
  }

  return `API ${status}: ${detail}`;
}
