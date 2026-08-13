/**
 * Browser-side PlantUML helpers: wrap/encode + direct server render (Kroki /
 * plantuml.com) when the local sidecar is down. Mermaid stays unrelated.
 */

const MAX_SOURCE_CHARS = 100_000;
const MAX_RENDER_BYTES = 2 * 1024 * 1024;
const PLANTUML_ENCODE_TABLE =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";

export type PlantumlDirectResult =
  | {
      ok: true;
      format: "svg";
      contentType: string;
      svg: string;
    }
  | {
      ok: true;
      format: "png";
      contentType: string;
      imageBase64: string;
    };

/** Normalize source so PlantUML always sees @startuml … @enduml. */
export function wrapPlantumlSourceClient(source: string): string {
  const text = String(source ?? "").trim();
  if (!text) {
    throw new Error("PlantUML source is empty");
  }
  if (text.length > MAX_SOURCE_CHARS) {
    throw new Error(
      `PlantUML source too large (${text.length} chars; max ${MAX_SOURCE_CHARS})`,
    );
  }
  if (/@startuml/i.test(text)) return text;
  return `@startuml\n${text}\n@enduml`;
}

async function deflateRawBytes(input: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") {
    throw new Error("deflate-raw is unavailable in this runtime");
  }
  const stream = new CompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  await writer.write(input);
  await writer.close();
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** PlantUML text encoding used by plantuml.com /svg/{encoded}. */
export async function encodePlantumlTextClient(text: string): Promise<string> {
  const deflated = await deflateRawBytes(new TextEncoder().encode(text));
  let result = "";
  for (let i = 0; i < deflated.length; i += 3) {
    const b1 = deflated[i]!;
    const b2 = i + 1 < deflated.length ? deflated[i + 1]! : 0;
    const b3 = i + 2 < deflated.length ? deflated[i + 2]! : 0;
    result += PLANTUML_ENCODE_TABLE.charAt(b1 >> 2);
    result += PLANTUML_ENCODE_TABLE.charAt(((b1 & 0x3) << 4) | (b2 >> 4));
    result += PLANTUML_ENCODE_TABLE.charAt(((b2 & 0xf) << 2) | (b3 >> 6));
    result += PLANTUML_ENCODE_TABLE.charAt(b3 & 0x3f);
  }
  return result;
}

function isPlantumlDotCom(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "plantuml.com" || host === "www.plantuml.com";
}

/**
 * Lightweight URL checks for the browser fallback (no DNS lookup).
 * Blocks credentials, non-http(s), and cloud-metadata style hosts.
 */
export function assertPlantumlServerUrlClient(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(String(rawUrl || "").trim());
  } catch {
    throw new Error("Invalid PlantUML server URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http(s) PlantUML server URLs are allowed");
  }
  if (parsed.username || parsed.password) {
    throw new Error("PlantUML server URLs with credentials are not allowed");
  }
  const host = parsed.hostname;
  if (!host) {
    throw new Error("PlantUML server URL is missing a host");
  }
  if (
    host === "metadata.google.internal" ||
    host === "metadata" ||
    host.endsWith(".internal")
  ) {
    throw new Error("Blocked PlantUML server host");
  }
  if (host === "169.254.169.254" || host.startsWith("169.254.")) {
    throw new Error("Link-local / metadata addresses are blocked");
  }
  if (host === "0.0.0.0" || host === "::") {
    throw new Error("Blocked PlantUML server host");
  }
  return parsed;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function shapeImageResult(
  buf: Uint8Array,
  contentType: string,
): PlantumlDirectResult {
  const ct = (contentType || "").toLowerCase();
  const head = new TextDecoder().decode(buf.subarray(0, Math.min(buf.length, 256)));
  const isSvg =
    ct.includes("svg") || /^\s*<svg[\s>]/i.test(head);
  const isPng =
    ct.includes("png") || (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50);
  if (!isSvg && !isPng) {
    throw new Error(
      `PlantUML server returned unexpected content-type (${contentType || "unknown"}): ${head.trim().slice(0, 160)}`,
    );
  }
  if (isSvg) {
    const svg = new TextDecoder().decode(buf);
    if (!/<svg[\s>]/i.test(svg)) {
      throw new Error("PlantUML server returned non-SVG body");
    }
    return { ok: true, format: "svg", contentType: "image/svg+xml", svg };
  }
  return {
    ok: true,
    format: "png",
    contentType: "image/png",
    imageBase64: bytesToBase64(buf),
  };
}

/** True when the failure looks like the local sidecar / Vite proxy is down. */
export function isSidecarUnreachableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /sidecar unreachable|could not reach sidecar|econnrefused|failed to fetch|networkerror|proxy upstream error|err_connection_refused|load failed/i.test(
    message,
  );
}

export const PLANTUML_SERVER_SIDECAR_HINT =
  "PlantUML server render needs network access. Sidecar is down — direct Kroki/plantuml.com fallback failed. Run npm run sidecar or npm run dev (or check the server URL / network), then retry.";

export const PLANTUML_LOCAL_SIDECAR_HINT =
  "Local PlantUML needs the sidecar (jar/binary spawn). Run npm run sidecar or npm run dev, then retry.";

/**
 * Render via Kroki POST or plantuml.com GET directly from the browser/Electron
 * renderer. Used when sidecar health/proxy fails in server mode.
 */
export async function renderPlantumlServerDirect(options: {
  source: string;
  serverUrl?: string;
  format?: "svg" | "png";
  signal?: AbortSignal;
}): Promise<PlantumlDirectResult> {
  const format = options.format === "png" ? "png" : "svg";
  const wrapped = wrapPlantumlSourceClient(options.source);
  const base = assertPlantumlServerUrlClient(
    (options.serverUrl || "https://kroki.io").trim() || "https://kroki.io",
  );

  let res: Response;
  if (isPlantumlDotCom(base.hostname)) {
    const root = base.toString().replace(/\/$/, "");
    const prefix = /\/plantuml$/i.test(root) ? root : `${root}/plantuml`;
    const encoded = await encodePlantumlTextClient(wrapped);
    const url = `${prefix}/${format}/${encoded}`;
    res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: options.signal,
      headers: {
        Accept:
          format === "png"
            ? "image/png"
            : "image/svg+xml,text/plain;q=0.8,*/*;q=0.5",
      },
    });
  } else {
    const root = base.toString().replace(/\/$/, "");
    const url = `${root}/plantuml/${format}`;
    res = await fetch(url, {
      method: "POST",
      redirect: "follow",
      signal: options.signal,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        Accept:
          format === "png"
            ? "image/png"
            : "image/svg+xml,text/plain;q=0.8,*/*;q=0.5",
      },
      body: wrapped,
    });
  }

  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > MAX_RENDER_BYTES) {
    throw new Error(
      `PlantUML response too large (${buf.length} bytes; max ${MAX_RENDER_BYTES})`,
    );
  }
  if (!res.ok) {
    const errText = new TextDecoder()
      .decode(buf.subarray(0, Math.min(buf.length, 400)))
      .trim();
    throw new Error(
      `PlantUML server HTTP ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`,
    );
  }
  return shapeImageResult(buf, res.headers.get("content-type") || "");
}
