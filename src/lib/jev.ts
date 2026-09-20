import type { ApiSettings } from "../types";
import type { ReflectDecision } from "./agentLoop";
import { coerceApiBaseUrl, isValidApiBaseUrl } from "./settings";

type JevChoiceAnswer = {
  choice?: unknown;
  confidence?: unknown;
  probabilities?: unknown;
};

export type JevDecisionResult = {
  decision: ReflectDecision;
  confidence: number;
  probabilities: Record<string, number>;
};

function endpointFromBaseUrl(baseUrl: string): string | null {
  const base = coerceApiBaseUrl(baseUrl).replace(/\/$/, "");
  if (!isValidApiBaseUrl(base)) return null;
  return /\/v1\/systemone$/i.test(base) ? base : `${base}/v1/systemone`;
}

function proxyParts(endpoint: string): { url: string; target: string } {
  const parsed = new URL(endpoint);
  return {
    url: `${window.location.origin}/openai${parsed.pathname}${parsed.search}`,
    target: parsed.origin,
  };
}

function finiteProbability(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

/** Strictly decode the bounded subset used by Reflect. */
export function parseJevReflectResponse(
  raw: unknown,
  allowed: ReflectDecision[],
): JevDecisionResult | null {
  if (!raw || typeof raw !== "object") return null;
  const answers = (raw as { answers?: unknown }).answers;
  if (!answers || typeof answers !== "object") return null;
  const answer = (answers as { decision?: JevChoiceAnswer }).decision;
  if (!answer || typeof answer !== "object") return null;
  const decision = String(answer.choice ?? "") as ReflectDecision;
  if (!allowed.includes(decision)) return null;

  const probabilityEntries =
    answer.probabilities && typeof answer.probabilities === "object"
      ? Object.entries(answer.probabilities as Record<string, unknown>)
      : [];
  const probabilities: Record<string, number> = {};
  for (const [key, value] of probabilityEntries) {
    const probability = finiteProbability(value);
    if (probability != null) probabilities[key] = probability;
  }
  const confidence =
    finiteProbability(answer.confidence) ?? probabilities[decision] ?? 0;
  return { decision, confidence, probabilities };
}

export async function askJevReflectDecision(args: {
  settings: ApiSettings;
  state: Record<string, unknown>;
  allowed: ReflectDecision[];
  signal?: AbortSignal;
}): Promise<JevDecisionResult | null> {
  const { settings, allowed } = args;
  if (!settings.jevReflectEnabled || !settings.jevApiKey?.trim()) return null;
  const endpoint = endpointFromBaseUrl(
    settings.jevBaseUrl ?? "https://api.typesafe.ai",
  );
  if (!endpoint) return null;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${settings.jevApiKey.trim()}`,
  };
  let url = endpoint;
  if (settings.useProxy) {
    const proxy = proxyParts(endpoint);
    url = proxy.url;
    headers["X-Forknote-Target"] = proxy.target;
  }

  const criteria = Object.fromEntries(allowed.map((decision) => [decision, null]));
  const controller = new AbortController();
  const relayAbort = () => controller.abort();
  args.signal?.addEventListener("abort", relayAbort, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: settings.jevModel?.trim() || "jev-latest",
        state: args.state,
        questions: {
          decision: {
            type: "choice",
            instructions:
              "Choose the safest next Agent Reflect action that best matches the observed tool outcome and expected outcome.",
            criteria,
          },
        },
      }),
    });
    if (!response.ok) return null;
    return parseJevReflectResponse(await response.json(), allowed);
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
    args.signal?.removeEventListener("abort", relayAbort);
  }
}
