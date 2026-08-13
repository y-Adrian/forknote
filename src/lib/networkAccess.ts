/**
 * Network access preference + reachability for agent web tools.
 */
import type { ApiSettings } from "../types";
import { resolveAgentAllowNetwork } from "./settings";
import { DEFAULT_SIDECAR_URL } from "./sidecar";

export type NetworkReachability = {
  /** User toggle (settings.agentAllowNetwork). */
  wanted: boolean;
  /** navigator.onLine when available. */
  browserOnline: boolean;
  /** Sidecar probe result (null if not probed / sidecar down). */
  probedOnline: boolean | null;
  /** Tools may run only when wanted && browserOnline && probed !== false. */
  toolsAllowed: boolean;
  reason: "off" | "offline" | "sidecar_unreachable" | "ok";
};

export { resolveAgentAllowNetwork };

export function isBrowserOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

function base(url: string): string {
  return url.replace(/\/$/, "");
}

/** Probe via sidecar (bypasses browser CORS). Soft-fail if sidecar is down. */
export async function probeNetworkReachable(
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
): Promise<boolean | null> {
  try {
    const res = await fetch(`${base(sidecarUrl)}/net/status`, { signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { online?: boolean };
    return Boolean(data.online);
  } catch {
    return null;
  }
}

export async function resolveNetworkReachability(args: {
  settings: ApiSettings;
  sidecarUrl?: string;
  signal?: AbortSignal;
}): Promise<NetworkReachability> {
  const wanted = resolveAgentAllowNetwork(args.settings);
  const browserOnline = isBrowserOnline();
  if (!wanted) {
    return {
      wanted: false,
      browserOnline,
      probedOnline: null,
      toolsAllowed: false,
      reason: "off",
    };
  }
  if (!browserOnline) {
    return {
      wanted: true,
      browserOnline: false,
      probedOnline: null,
      toolsAllowed: false,
      reason: "offline",
    };
  }
  const probedOnline = await probeNetworkReachable(
    args.sidecarUrl ?? DEFAULT_SIDECAR_URL,
    args.signal,
  );
  if (probedOnline === null) {
    // Sidecar down / probe transport failed — cannot run web tools.
    return {
      wanted: true,
      browserOnline: true,
      probedOnline: null,
      toolsAllowed: false,
      reason: "sidecar_unreachable",
    };
  }
  // Prefer navigator.onLine when the sidecar answered. A failed upstream probe
  // (DNS sinkhole, captive portal, flaky endpoint) must not hard-block tools
  // or surface as a chat-breaking "offline" error — tools fail softly per URL.
  if (probedOnline === false) {
    return {
      wanted: true,
      browserOnline: true,
      probedOnline: false,
      toolsAllowed: true,
      reason: "ok",
    };
  }
  return {
    wanted: true,
    browserOnline: true,
    probedOnline: true,
    toolsAllowed: true,
    reason: "ok",
  };
}

/**
 * Soft web-tool round budget by task complexity (network-only turns).
 * Prefer Reflect for "search again" — this is a ceiling, not "search once".
 */
export type WebTaskComplexity = "simple" | "multi";

export function estimateWebTaskComplexity(userText: string): WebTaskComplexity {
  const t = (userText ?? "").trim();
  if (!t) return "simple";
  const lower = t.toLowerCase();
  const multiHints =
    /对比|比较|调研|综述|多方|几个|分别|以及|还有|详细|全面|compare|versus|\bvs\b|research|survey|pros\s*and\s*cons|both|several|multiple|sources?|and then|step by step/i;
  const questionMarks = (t.match(/[?？]/g) ?? []).length;
  if (multiHints.test(t) || questionMarks >= 2 || t.length >= 160) {
    return "multi";
  }
  // Short single-fact asks stay simple even if they mention "latest".
  if (t.length <= 80 && !/\b(and|与|和|以及)\b/i.test(lower)) return "simple";
  return t.length >= 120 ? "multi" : "simple";
}

/** Soft cap for web tool batches; never raises above agentMaxRounds. */
export function resolveWebToolRoundBudget(
  complexity: WebTaskComplexity,
  agentMaxRounds: number,
): number {
  const soft = complexity === "simple" ? 3 : 6;
  return Math.max(1, Math.min(agentMaxRounds, soft));
}

export function formatNetworkStatusSystem(
  reach: NetworkReachability,
  locale: "zh" | "en",
): string {
  if (locale === "zh") {
    if (reach.reason === "off") {
      return "【联网】用户未开启联网开关。禁止调用 web_search / web_fetch；不要假装已上网检索。若需要最新公开信息，可提示用户打开输入框左侧的「联网」。";
    }
    if (reach.reason === "offline") {
      return "【联网】用户已开启联网，但当前设备网络不可用。禁止声称已检索或打开网页；请明确说明离线，并仅基于已有知识谨慎作答（标注可能过时）。";
    }
    if (reach.reason === "sidecar_unreachable") {
      return "【联网】用户已开启联网，但本地 sidecar 网络代理不可达（请确认已运行 npm run sidecar / npm run dev）。暂时无法 web_search / web_fetch；请说明原因，不要编造网页内容。";
    }
    return [
      "【联网】用户已开启联网且网络可用。由你（主模型）决定是否检索——不要另设分类器；不要编造未返回的网页内容。",
      "何时搜索：需要时效/公开事实、版本与发布说明、文档原文、新闻或用户粘贴的 URL 时，用 web_search；已知 URL 用 web_fetch。",
      "何时不搜索：纯概念/推理/写作、本地项目已能回答、闲聊或绘图，以及用户未要求核验的常识——直接作答。",
      "搜几次：按任务复杂度——简单事实通常一次够用；对比/多源/信息不足时，经 Reflect 换关键词或角度再搜，不要固定「只搜一次就停」。",
      "例1：「量子纠缠是什么」→ 不搜，直接讲清。例2：「OpenAI 本周有什么发布」→ web_search。例3：首轮结果偏题/过旧 → Reflect 后换查询再搜或 web_fetch 权威页。",
    ].join("\n");
  }
  if (reach.reason === "off") {
    return "[Network] The user left network access off. Do not call web_search / web_fetch or pretend you browsed the web. If live info is needed, ask them to enable Network beside the model selector.";
  }
  if (reach.reason === "offline") {
    return "[Network] The user enabled network access, but the device is offline. Do not claim you fetched the web; say you are offline and answer cautiously from prior knowledge (note it may be stale).";
  }
  if (reach.reason === "sidecar_unreachable") {
    return "[Network] Network is enabled, but the local sidecar network proxy is unreachable (ensure npm run sidecar / npm run dev). web_search / web_fetch are unavailable — explain that; do not invent page contents.";
  }
  return [
    "[Network] Access is on. You (the main model) decide whether to search — no separate classifier. Do not invent page contents you did not retrieve.",
    "When to search: live/public facts, release notes, docs, news, or a user-pasted URL — use web_search; known URLs → web_fetch.",
    "When not to: pure concepts/reasoning/writing, answers already available locally, chit-chat/diagrams, or unchallenged general knowledge — answer directly.",
    "How many: tie to complexity — one good search often enough for simple facts; for compare/multi-source or thin results, Reflect and search again with a different query/angle (not a fixed one-and-done).",
    'Ex1: "What is entanglement?" → no search. Ex2: "What did OpenAI ship this week?" → web_search. Ex3: first hits off-topic/stale → Reflect, then new query or web_fetch an authoritative page.',
  ].join("\n");
}

export async function sidecarWebFetch(
  url: string,
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
): Promise<{
  ok: boolean;
  status: number;
  url: string;
  contentType: string;
  text: string;
}> {
  const res = await fetch(`${base(sidecarUrl)}/net/fetch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      res.ok ? "Invalid JSON from /net/fetch" : `Sidecar error ${res.status}`,
    );
  }
  if (!res.ok) {
    const err =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `Sidecar error ${res.status}`;
    throw new Error(err);
  }
  return data as {
    ok: boolean;
    status: number;
    url: string;
    contentType: string;
    text: string;
  };
}

export async function sidecarWebSearch(
  query: string,
  sidecarUrl = DEFAULT_SIDECAR_URL,
  signal?: AbortSignal,
): Promise<{
  ok: boolean;
  query: string;
  results: Array<{ title: string; url: string; snippet: string }>;
}> {
  const res = await fetch(`${base(sidecarUrl)}/net/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      res.ok ? "Invalid JSON from /net/search" : `Sidecar error ${res.status}`,
    );
  }
  if (!res.ok) {
    const err =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `Sidecar error ${res.status}`;
    throw new Error(err);
  }
  return data as {
    ok: boolean;
    query: string;
    results: Array<{ title: string; url: string; snippet: string }>;
  };
}
