/**
 * Content-Security-Policy for the packaged Electron UI server.
 * Compatible with Vite-bundled assets, Mermaid/PlantUML (blob + https),
 * and same-origin `/sidecar` + `/openai` proxies. Blocks unexpected
 * script/frame sources.
 */
const PACKAGED_UI_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // React and theme boot set inline style attributes; keep styles local.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // Same-origin proxies + optional direct loopback sidecar / HTTPS PlantUML.
  "connect-src 'self' https: http://127.0.0.1:* http://localhost:* http://[::1]:*",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

module.exports = { PACKAGED_UI_CSP };
