import type { ChatMessage, ChatSession } from "../types";

/** Soft warn when encoded URL hash exceeds this (chars). Still allowed. */
export const SHARE_SOFT_LIMIT = 200_000;
/** Hard refuse above this encoded payload length (chars in hash after `#/share/`). */
export const SHARE_HARD_LIMIT = 1_500_000;

export const SHARE_HASH_PREFIX = "#/share/";

export interface ShareMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SharePayload {
  v: 1;
  title: string;
  messages: ShareMessage[];
}

export interface ShareableMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

/** Compact wire format to keep hash URLs shorter. */
interface WirePayload {
  v: 1;
  t: string;
  m: Array<{ r: "u" | "a"; c: string }>;
}

function toWire(payload: SharePayload): WirePayload {
  return {
    v: 1,
    t: payload.title,
    m: payload.messages.map((msg) => ({
      r: msg.role === "user" ? "u" : "a",
      c: msg.content,
    })),
  };
}

function fromWire(wire: WirePayload): SharePayload {
  return {
    v: 1,
    title: typeof wire.t === "string" ? wire.t : "",
    messages: (wire.m ?? []).map((msg) => ({
      role: msg.r === "u" ? "user" : "assistant",
      content: typeof msg.c === "string" ? msg.c : "",
    })),
  };
}

/** Main-thread messages suitable for sharing (non-empty content). */
export function getShareableMessages(session: ChatSession): ShareableMessage[] {
  const messages = session.thread?.messages ?? [];
  return messages
    .filter((msg) => msg.content.trim().length > 0)
    .map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
    }));
}

export function buildSharePayload(
  title: string,
  messages: Array<Pick<ChatMessage, "role" | "content">>,
): SharePayload {
  return {
    v: 1,
    title: title.trim() || "Untitled",
    messages: messages.map((msg) => ({
      role: msg.role,
      content: msg.content.trim(),
    })),
  };
}

/** Local-first share payload: title + selected (or all) main-thread messages as Markdown. */
export function sessionToShareMarkdown(
  session: ChatSession,
  selectedIds?: ReadonlySet<string>,
): string {
  const all = getShareableMessages(session);
  const messages =
    selectedIds == null
      ? all
      : all.filter((msg) => selectedIds.has(msg.id));
  return sharePayloadToMarkdown(
    buildSharePayload(session.title, messages),
  );
}

export function sharePayloadToMarkdown(payload: SharePayload): string {
  const lines: string[] = [`# ${payload.title.trim() || "Untitled"}`, ""];
  if (payload.messages.length === 0) {
    lines.push("_Empty note_");
    return lines.join("\n").trimEnd() + "\n";
  }
  for (const msg of payload.messages) {
    const heading = msg.role === "user" ? "User" : "Assistant";
    lines.push(`## ${heading}`, "", msg.content.trim(), "");
  }
  return lines.join("\n").trimEnd() + "\n";
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const padded = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  const b64 = padded + "=".repeat(padLen);
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function gzipCompress(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") {
    throw new Error("CompressionStream unavailable");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(
    new CompressionStream("gzip"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gzipDecompress(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("DecompressionStream unavailable");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(
    new DecompressionStream("gzip"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Encode a share payload into a compact hash token: `g.<b64>` (gzip) or `r.<b64>` (raw).
 * Prefer gzip when CompressionStream is available.
 */
export async function encodeSharePayload(
  payload: SharePayload,
): Promise<{ token: string; encodedLength: number }> {
  const json = JSON.stringify(toWire(payload));
  const raw = new TextEncoder().encode(json);
  let token: string;
  try {
    const gz = await gzipCompress(raw);
    token = `g.${bytesToBase64Url(gz)}`;
  } catch {
    token = `r.${bytesToBase64Url(raw)}`;
  }
  return { token, encodedLength: token.length };
}

export async function decodeSharePayload(
  token: string,
): Promise<SharePayload | null> {
  const trimmed = token.trim();
  const dot = trimmed.indexOf(".");
  if (dot <= 0) return null;
  const kind = trimmed.slice(0, dot);
  const body = trimmed.slice(dot + 1);
  if (!body || (kind !== "g" && kind !== "r")) return null;
  try {
    const bytes = base64UrlToBytes(body);
    const raw =
      kind === "g" ? await gzipDecompress(bytes) : bytes;
    const text = new TextDecoder().decode(raw);
    const wire = JSON.parse(text) as WirePayload;
    if (wire?.v !== 1 || !Array.isArray(wire.m)) return null;
    return fromWire(wire);
  } catch {
    return null;
  }
}

export function buildShareUrl(token: string): string {
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}${SHARE_HASH_PREFIX}${token}`;
}

/** Parse `#/share/<token>` from a location hash. */
export function parseShareHash(hash: string): string | null {
  const h = hash.startsWith("#") ? hash : `#${hash}`;
  if (!h.startsWith(SHARE_HASH_PREFIX)) return null;
  const token = h.slice(SHARE_HASH_PREFIX.length);
  return token.length > 0 ? token : null;
}

export function previewText(content: string, max = 120): string {
  const oneLine = content.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

/** Escape text for safe embedding in HTML (XSS-safe for text nodes / attributes). */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface ShareHtmlLabels {
  brand?: string;
  roleUser: string;
  roleAssistant: string;
  empty?: string;
  footerNote?: string;
}

/**
 * Build a self-contained HTML document for selected messages.
 * Inline CSS only — opens offline / via file:// with no external deps.
 */
export function sharePayloadToHtml(
  payload: SharePayload,
  labels: ShareHtmlLabels,
): string {
  const titleRaw = payload.title.trim() || "Untitled";
  const title = escapeHtml(titleRaw);
  const brand = escapeHtml(labels.brand ?? "ForkNote");
  const empty = escapeHtml(labels.empty ?? "Empty note");
  const footerNote = escapeHtml(
    labels.footerNote ?? "Exported from ForkNote · read-only",
  );

  const body =
    payload.messages.length === 0
      ? `<p class="empty">${empty}</p>`
      : payload.messages
          .map((msg) => {
            const roleLabel =
              msg.role === "user" ? labels.roleUser : labels.roleAssistant;
            const roleClass =
              msg.role === "user" ? "role-user" : "role-assistant";
            return [
              `<article class="msg">`,
              `  <p class="role ${roleClass}">${escapeHtml(roleLabel)}</p>`,
              `  <div class="content">${escapeHtml(msg.content.trim())}</div>`,
              `</article>`,
            ].join("\n");
          })
          .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>${title} · ${brand}</title>
<style>
  :root {
    --bg: #f5f6f8;
    --main: #ffffff;
    --text: #1f2430;
    --text-dim: #4a5568;
    --muted: #8b95a8;
    --border: rgba(15, 23, 42, 0.08);
    --accent: #4d6bfe;
    --user-soft: #eef1ff;
    --radius: 14px;
    --font: system-ui, -apple-system, "Segoe UI", sans-serif;
    --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    font-family: var(--font);
    font-size: 1.05rem;
    line-height: 1.55;
    letter-spacing: -0.011em;
    color: var(--text);
    background: var(--bg);
  }
  .wrap {
    max-width: 720px;
    margin: 0 auto;
    padding: 32px 20px 48px;
  }
  header {
    margin-bottom: 28px;
    padding-bottom: 20px;
    border-bottom: 1px solid var(--border);
  }
  .brand {
    margin: 0 0 8px;
    font-size: 0.78rem;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--accent);
  }
  h1 {
    margin: 0;
    font-size: 1.55rem;
    font-weight: 650;
    letter-spacing: -0.03em;
    line-height: 1.25;
  }
  .msg {
    background: var(--main);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px 18px;
    margin: 0 0 12px;
  }
  .role {
    margin: 0 0 8px;
    font-size: 0.72rem;
    font-weight: 650;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .role-user { color: var(--text-dim); }
  .role-assistant { color: var(--accent); }
  .content {
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text);
  }
  .empty {
    margin: 24px 0;
    color: var(--muted);
    text-align: center;
  }
  footer {
    margin-top: 28px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
    font-size: 0.78rem;
    color: var(--muted);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #12141c;
      --main: #171a24;
      --text: #e8eaf2;
      --text-dim: #a8b0c4;
      --muted: #7a849c;
      --border: rgba(180, 190, 220, 0.1);
      --accent: #7b8fff;
      --user-soft: rgba(154, 172, 255, 0.12);
    }
  }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <p class="brand">${brand}</p>
      <h1>${title}</h1>
    </header>
    <main>
${body}
    </main>
    <footer>${footerNote}</footer>
  </div>
</body>
</html>
`;
}

/** `forknote-share-<title-or-date>.html` — filesystem-safe slug. */
export function buildShareHtmlFilename(
  title: string,
  now: Date = new Date(),
): string {
  const date = now.toISOString().slice(0, 10);
  const slug = title
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "")
    .toLowerCase();
  return `forknote-share-${slug || date}.html`;
}

/** Trigger a browser download of a UTF-8 text/HTML file. */
export function downloadShareHtml(html: string, filename: string): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
