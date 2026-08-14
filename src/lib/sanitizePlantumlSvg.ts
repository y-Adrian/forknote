/**
 * Harden PlantUML SVG before display. Remote/server SVG must not be injected
 * via innerHTML; prefer an inert image/blob boundary after light sanitization.
 */

const SCRIPT_OR_FOREIGN =
  /<\s*(script|foreignObject|iframe|object|embed)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const SCRIPT_SELF_CLOSE =
  /<\s*(script|foreignObject|iframe|object|embed)\b[^>]*\/\s*>/gi;
const EVENT_HANDLER_ATTR =
  /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URL_ATTR =
  /(\s+(?:href|xlink:href|src)\s*=\s*)(["'])\s*javascript:[^"']*\2/gi;

/**
 * Strip common XSS vectors from PlantUML SVG markup.
 * Not a full HTML sanitizer — pair with blob/img rendering.
 */
export function sanitizePlantumlSvg(raw: string): string {
  let svg = String(raw ?? "");
  // Drop XML/HTML comments that can hide payloads.
  svg = svg.replace(/<!--[\s\S]*?-->/g, "");
  svg = svg.replace(SCRIPT_OR_FOREIGN, "");
  svg = svg.replace(SCRIPT_SELF_CLOSE, "");
  svg = svg.replace(EVENT_HANDLER_ATTR, "");
  svg = svg.replace(JS_URL_ATTR, "$1$2#$2");
  // Reject non-SVG payloads early.
  if (!/<svg[\s>]/i.test(svg)) {
    throw new Error("PlantUML render did not return SVG markup");
  }
  return svg.trim();
}

/**
 * Build an inert object URL for sanitized SVG (safe for <img src>).
 * Caller must revoke with URL.revokeObjectURL when done.
 */
export function plantumlSvgToObjectUrl(raw: string): string {
  const svg = sanitizePlantumlSvg(raw);
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  return URL.createObjectURL(blob);
}
