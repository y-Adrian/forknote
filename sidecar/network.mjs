/**
 * Sidecar network helpers: SSRF-safe fetch + lightweight web search.
 * Used by /net/* routes (Node has no browser CORS).
 */
import dns from "node:dns/promises";
import net from "node:net";
import { URL } from "node:url";

const MAX_FETCH_BYTES = 400 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_SEARCH_RESULTS = 8;

/**
 * @param {string} hostname
 */
function isPrivateOrLocalHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (
    host === "localhost" ||
    host === "localhost.localdomain" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "::" ||
    host === "::1" ||
    host === "[::1]"
  ) {
    return true;
  }
  // Block cloud metadata hostnames
  if (
    host === "metadata.google.internal" ||
    host === "metadata" ||
    host.endsWith(".internal")
  ) {
    return true;
  }
  return false;
}

/**
 * @param {string} ip
 */
export function isPrivateIp(ip) {
  const version = net.isIP(ip);
  if (version === 4) {
    const parts = ip.split(".").map((n) => Number(n));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return true;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    // Note: do NOT treat 198.18.0.0/15 as private. VPN/proxy fake-IP modes
    // (Clash, Surge, …) map public hostnames there; blocking breaks web tools.
    return false;
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
    if (lower.startsWith("fe80")) return true; // link-local
    if (lower.startsWith("::ffff:")) {
      const v4 = lower.slice("::ffff:".length);
      return isPrivateIp(v4);
    }
    return false;
  }
  return true;
}

/**
 * Allow hostname when at least one resolved address is publicly routable.
 * VPN fake-IP stacks often return dual A (198.18.x) + AAAA (ULA); blocking on
 * *any* private address false-positives those environments.
 * Literal private IPs in the URL are still blocked by the caller.
 * @param {Array<{ address: string }>} records
 */
export function hasPublicResolvedAddress(records) {
  if (!Array.isArray(records) || records.length === 0) return false;
  return records.some((rec) => rec && !isPrivateIp(String(rec.address || "")));
}

/**
 * @param {string} rawUrl
 */
export async function assertPublicHttpUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || "").trim());
  } catch {
    throw new Error("Invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URLs with credentials are not allowed");
  }
  const host = parsed.hostname;
  if (!host || isPrivateOrLocalHost(host)) {
    throw new Error("Private / local hosts are blocked");
  }
  // Literal IP in URL — always enforce (no "any public" escape hatch).
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error("Private IP addresses are blocked");
    return parsed;
  }
  let records;
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error(`Could not resolve host: ${host}`);
  }
  if (!records.length) throw new Error(`Could not resolve host: ${host}`);
  // Only block when *every* address is private (DNS sinkhole / pure LAN name).
  if (!hasPublicResolvedAddress(records)) {
    throw new Error("Host resolves to a private address (blocked)");
  }
  return parsed;
}

/**
 * @param {string} html
 */
export function htmlToText(html) {
  let text = String(html || "");
  text = text.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  text = text.replace(/[ \t]{2,}/g, " ").trim();
  return text;
}

/**
 * @param {unknown} body
 */
export async function handleNetFetch(body) {
  const urlRaw =
    body && typeof body === "object" && "url" in body
      ? String(/** @type {{ url?: unknown }} */ (body).url ?? "")
      : "";
  const parsed = await assertPublicHttpUrl(urlRaw);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(parsed.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "ForkNote-sidecar/1.0 (+local agent; web_fetch)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
      },
    });
    // Re-check final URL after redirects
    const finalUrl = res.url || parsed.toString();
    await assertPublicHttpUrl(finalUrl);

    const contentType = res.headers.get("content-type") || "";
    const buf = Buffer.from(await res.arrayBuffer());
    const truncated = buf.length > MAX_FETCH_BYTES;
    const slice = truncated ? buf.subarray(0, MAX_FETCH_BYTES) : buf;
    let text;
    if (/html|xml/i.test(contentType) || /^\s*</.test(slice.toString("utf8").slice(0, 64))) {
      text = htmlToText(slice.toString("utf8"));
    } else {
      text = slice.toString("utf8");
    }
    if (truncated) {
      text += `\n\n…(truncated at ${MAX_FETCH_BYTES} bytes)`;
    }
    return {
      ok: res.ok,
      status: res.status,
      url: finalUrl,
      contentType,
      text: text.slice(0, MAX_FETCH_BYTES),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Lightweight search via DuckDuckGo HTML (no API key).
 * @param {unknown} body
 */
export async function handleNetSearch(body) {
  const query =
    body && typeof body === "object" && "query" in body
      ? String(/** @type {{ query?: unknown }} */ (body).query ?? "").trim()
      : "";
  if (!query) throw new Error("query is required");
  if (query.length > 300) throw new Error("query too long");

  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  await assertPublicHttpUrl(searchUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(searchUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ForkNote-sidecar/1.0; +local agent web_search)",
        Accept: "text/html",
      },
    });
    if (!res.ok) {
      throw new Error(`Search upstream HTTP ${res.status}`);
    }
    const html = await res.text();
    /** @type {Array<{ title: string, url: string, snippet: string }>} */
    const results = [];
    const blockRe =
      /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td|div)>)?/gi;
    let match;
    while ((match = blockRe.exec(html)) && results.length < MAX_SEARCH_RESULTS) {
      let href = match[1] || "";
      // DDG sometimes wraps as //duckduckgo.com/l/?uddg=<encoded>
      try {
        const u = new URL(href, "https://duckduckgo.com");
        if (u.hostname.includes("duckduckgo.com") && u.searchParams.get("uddg")) {
          href = decodeURIComponent(u.searchParams.get("uddg") || href);
        } else {
          href = u.toString();
        }
      } catch {
        // keep raw
      }
      const title = htmlToText(match[2] || "").slice(0, 200);
      const snippet = htmlToText(match[3] || "").slice(0, 400);
      if (!title || !href) continue;
      try {
        await assertPublicHttpUrl(href);
      } catch {
        continue;
      }
      results.push({ title, url: href, snippet });
    }

    // Fallback: looser title links if strict class parse failed
    if (results.length === 0) {
      const loose =
        /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      while ((match = loose.exec(html)) && results.length < MAX_SEARCH_RESULTS) {
        const href = match[1] || "";
        if (/duckduckgo\.com/i.test(href)) continue;
        const title = htmlToText(match[2] || "").slice(0, 200);
        if (!title || title.length < 3) continue;
        try {
          await assertPublicHttpUrl(href);
        } catch {
          continue;
        }
        results.push({ title, url: href, snippet: "" });
      }
    }

    return { ok: true, query, results };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Soft connectivity probe URLs (no SSRF gate — known public endpoints only).
 * Prefer Cloudflare / example.com over Google generate_204: some VPN / captive-
 * portal helpers treat Google probes specially and may bounce the default
 * browser (Chrome) in the Dock. ForkNote itself never launches a browser —
 * probes and web_search / web_fetch use Node `fetch` only.
 */
export const STATUS_PROBE_URLS = [
  "https://cloudflare.com/cdn-cgi/trace",
  "https://1.1.1.1/cdn-cgi/trace",
  "https://example.com/",
];

/**
 * Cheap reachability probe. Soft-fail: never throws; DNS/SSRF quirks must not
 * hard-fail the Network toggle or spam chat.
 */
export async function handleNetStatus() {
  for (const url of STATUS_PROBE_URLS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    try {
      const res = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        redirect: "manual",
      });
      // Any HTTP response means the stack can reach the public net (or a proxy).
      if (res.status > 0) {
        return {
          online: true,
          probed: true,
          status: res.status,
          via: url,
        };
      }
    } catch {
      // try next endpoint
    } finally {
      clearTimeout(timer);
    }
  }
  return { online: false, probed: true, status: 0 };
}
