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
      "API 401：鉴权失败（DeepSeek governor）。",
      "请检查：① 在 platform.deepseek.com 创建并复制 API Key；",
      "② 设置里 Base URL 为 https://api.deepseek.com，Model 为 deepseek-chat；",
      "③ Key 无首尾空格、不是 OpenAI 的 sk- 密钥；④ 保存后重试。",
      detail ? `服务端：${detail}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (status === 402) {
    return `API 402：账户余额不足，请在 DeepSeek 控制台充值。${detail ? `（${detail}）` : ""}`;
  }

  return `API ${status}: ${detail}`;
}
