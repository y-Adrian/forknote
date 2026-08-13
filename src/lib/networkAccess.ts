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
    return "【联网】用户已开启联网且网络可用。需要最新公开信息时，优先调用 web_search；已知 URL 时用 web_fetch。不要编造未检索到的网页内容。";
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
  return "[Network] Network access is on and reachable. Prefer web_search for live public info; use web_fetch for known URLs. Do not invent page contents you did not retrieve.";
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
