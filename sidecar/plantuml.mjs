/**
 * PlantUML render helpers for the sidecar.
 * - server: proxy to Kroki-compatible POST or plantuml.com-style GET
 * - local: spawn plantuml binary or `java -jar plantuml.jar` with -pipe
 *
 * Server URLs come from user Settings (not diagram source). Self-hosted /
 * localhost is allowed; cloud metadata and non-http(s) schemes are blocked.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import dns from "node:dns/promises";
import net from "node:net";
import { URL } from "node:url";
import { isPrivateIp } from "./network.mjs";

const execFileAsync = promisify(execFile);

const MAX_SOURCE_CHARS = 100_000;
const MAX_RENDER_BYTES = 2 * 1024 * 1024;
const RENDER_TIMEOUT_MS = 30_000;
const LOCAL_TIMEOUT_MS = 45_000;

const PLANTUML_ENCODE_TABLE =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";

/**
 * Validate a user-configured PlantUML / Kroki base URL.
 * Allows localhost and private LAN (self-hosted), blocks metadata + weird schemes.
 * @param {string} rawUrl
 * @returns {Promise<URL>}
 */
export async function assertPlantumlServerUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || "").trim());
  } catch {
    throw Object.assign(new Error("Invalid PlantUML server URL"), { status: 400 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw Object.assign(new Error("Only http(s) PlantUML server URLs are allowed"), {
      status: 400,
    });
  }
  if (parsed.username || parsed.password) {
    throw Object.assign(new Error("PlantUML server URLs with credentials are not allowed"), {
      status: 400,
    });
  }
  const host = parsed.hostname;
  if (!host) {
    throw Object.assign(new Error("PlantUML server URL is missing a host"), { status: 400 });
  }

  // Block cloud metadata / unspecified any-addr; allow localhost + LAN self-host.
  if (host === "metadata.google.internal" || host === "metadata" || host.endsWith(".internal")) {
    throw Object.assign(new Error("Blocked PlantUML server host"), { status: 400 });
  }
  if (net.isIP(host)) {
    if (host === "0.0.0.0" || host === "::") {
      throw Object.assign(new Error("Blocked PlantUML server host"), { status: 400 });
    }
    if (host === "169.254.169.254" || host.startsWith("169.254.")) {
      throw Object.assign(new Error("Link-local / metadata addresses are blocked"), {
        status: 400,
      });
    }
    return parsed;
  }

  try {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    if (!records.length) {
      throw Object.assign(new Error(`Could not resolve host: ${host}`), { status: 400 });
    }
    for (const rec of records) {
      const addr = String(rec.address || "");
      if (addr === "169.254.169.254" || addr.startsWith("169.254.")) {
        throw Object.assign(new Error("Host resolves to a link-local / metadata address"), {
          status: 400,
        });
      }
    }
  } catch (e) {
    if (e && typeof e === "object" && "status" in e) throw e;
    throw Object.assign(new Error(`Could not resolve host: ${host}`), { status: 400 });
  }
  return parsed;
}

/**
 * Normalize source so PlantUML always sees @startuml … @enduml.
 * @param {string} source
 */
export function wrapPlantumlSource(source) {
  const text = String(source ?? "").trim();
  if (!text) {
    throw Object.assign(new Error("PlantUML source is empty"), { status: 400 });
  }
  if (text.length > MAX_SOURCE_CHARS) {
    throw Object.assign(
      new Error(`PlantUML source too large (${text.length} chars; max ${MAX_SOURCE_CHARS})`),
      { status: 400 },
    );
  }
  if (/@startuml/i.test(text)) return text;
  return `@startuml\n${text}\n@enduml`;
}

/**
 * PlantUML text encoding used by plantuml.com /svg/{encoded}.
 * @param {string} text
 */
export function encodePlantumlText(text) {
  const deflated = zlib.deflateRawSync(Buffer.from(text, "utf8"), { level: 9 });
  let result = "";
  for (let i = 0; i < deflated.length; i += 3) {
    const b1 = deflated[i];
    const b2 = i + 1 < deflated.length ? deflated[i + 1] : 0;
    const b3 = i + 2 < deflated.length ? deflated[i + 2] : 0;
    result += PLANTUML_ENCODE_TABLE.charAt(b1 >> 2);
    result += PLANTUML_ENCODE_TABLE.charAt(((b1 & 0x3) << 4) | (b2 >> 4));
    result += PLANTUML_ENCODE_TABLE.charAt(((b2 & 0xf) << 2) | (b3 >> 6));
    result += PLANTUML_ENCODE_TABLE.charAt(b3 & 0x3f);
  }
  return result;
}

/**
 * @param {URL} base
 */
function isPlantumlDotCom(base) {
  const host = base.hostname.toLowerCase();
  return host === "plantuml.com" || host === "www.plantuml.com";
}

/**
 * @param {Buffer} buf
 * @param {string} contentType
 */
function shapeImageResult(buf, contentType) {
  const ct = (contentType || "").toLowerCase();
  const isSvg =
    ct.includes("svg") ||
    /^\s*<svg[\s>]/i.test(buf.toString("utf8", 0, Math.min(buf.length, 256)));
  const isPng = ct.includes("png") || (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50);
  if (!isSvg && !isPng) {
    const head = buf.toString("utf8", 0, Math.min(buf.length, 240)).trim();
    throw Object.assign(
      new Error(
        `PlantUML server returned unexpected content-type (${contentType || "unknown"}): ${head.slice(0, 160)}`,
      ),
      { status: 502 },
    );
  }
  if (isSvg) {
    const svg = buf.toString("utf8");
    if (!/<svg[\s>]/i.test(svg)) {
      throw Object.assign(new Error("PlantUML server returned non-SVG body"), { status: 502 });
    }
    return { ok: true, format: "svg", contentType: "image/svg+xml", svg };
  }
  return {
    ok: true,
    format: "png",
    contentType: "image/png",
    imageBase64: buf.toString("base64"),
  };
}

/**
 * @param {unknown} body
 */
export async function handlePlantumlServerRender(body) {
  const source =
    body && typeof body === "object" && "source" in body
      ? String(/** @type {{ source?: unknown }} */ (body).source ?? "")
      : "";
  const serverUrl =
    body && typeof body === "object" && "serverUrl" in body
      ? String(/** @type {{ serverUrl?: unknown }} */ (body).serverUrl ?? "")
      : "";
  const formatRaw =
    body && typeof body === "object" && "format" in body
      ? String(/** @type {{ format?: unknown }} */ (body).format ?? "svg")
      : "svg";
  const format = formatRaw.toLowerCase() === "png" ? "png" : "svg";

  const wrapped = wrapPlantumlSource(source);
  const base = await assertPlantumlServerUrl(serverUrl || "https://kroki.io");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS);
  try {
    /** @type {Response} */
    let res;
    if (isPlantumlDotCom(base)) {
      const root = base.toString().replace(/\/$/, "");
      const prefix = /\/plantuml$/i.test(root) ? root : `${root}/plantuml`;
      const encoded = encodePlantumlText(wrapped);
      const url = `${prefix}/${format}/${encoded}`;
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          Accept: format === "png" ? "image/png" : "image/svg+xml,text/plain;q=0.8,*/*;q=0.5",
          "User-Agent": "ForkNote-sidecar/1.0 (+plantuml server render)",
        },
      });
    } else {
      const root = base.toString().replace(/\/$/, "");
      const url = `${root}/plantuml/${format}`;
      res = await fetch(url, {
        method: "POST",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          Accept: format === "png" ? "image/png" : "image/svg+xml,text/plain;q=0.8,*/*;q=0.5",
          "User-Agent": "ForkNote-sidecar/1.0 (+plantuml kroki render)",
        },
        body: wrapped,
      });
    }

    const finalUrl = res.url || base.toString();
    await assertPlantumlServerUrl(finalUrl);

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_RENDER_BYTES) {
      throw Object.assign(
        new Error(`PlantUML response too large (${buf.length} bytes; max ${MAX_RENDER_BYTES})`),
        { status: 502 },
      );
    }
    if (!res.ok) {
      const errText = buf.toString("utf8", 0, Math.min(buf.length, 400)).trim();
      throw Object.assign(
        new Error(
          `PlantUML server HTTP ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`,
        ),
        { status: 502 },
      );
    }
    return shapeImageResult(buf, res.headers.get("content-type") || "");
  } catch (e) {
    if (e && typeof e === "object" && "status" in e) throw e;
    const message = e instanceof Error ? e.message : String(e);
    if (/aborted|AbortError/i.test(message)) {
      throw Object.assign(new Error("PlantUML server render timed out"), { status: 504 });
    }
    throw Object.assign(new Error(`PlantUML server render failed: ${message}`), { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} toolPath
 */
async function assertLocalToolPath(toolPath) {
  const trimmed = String(toolPath || "").trim();
  if (!trimmed) {
    throw Object.assign(
      new Error("Local PlantUML path is empty — set Settings → PlantUML local path"),
      { status: 400 },
    );
  }
  if (!path.isAbsolute(trimmed)) {
    throw Object.assign(
      new Error("Local PlantUML path must be absolute (e.g. /usr/local/bin/plantuml or …/plantuml.jar)"),
      { status: 400 },
    );
  }
  try {
    const st = await fs.stat(trimmed);
    if (!st.isFile()) {
      throw Object.assign(new Error("Local PlantUML path is not a file"), { status: 400 });
    }
  } catch (e) {
    if (e && typeof e === "object" && "status" in e) throw e;
    throw Object.assign(new Error(`Local PlantUML tool not found: ${trimmed}`), { status: 400 });
  }
  return trimmed;
}

/**
 * @param {string} javaPath
 */
async function resolveJavaBin(javaPath) {
  const trimmed = String(javaPath || "java").trim() || "java";
  if (path.isAbsolute(trimmed)) {
    try {
      const st = await fs.stat(trimmed);
      if (!st.isFile()) {
        throw Object.assign(new Error("Java path is not a file"), { status: 400 });
      }
    } catch (e) {
      if (e && typeof e === "object" && "status" in e) throw e;
      throw Object.assign(new Error(`Java binary not found: ${trimmed}`), { status: 400 });
    }
  }
  return trimmed;
}

/**
 * @param {unknown} body
 */
export async function handlePlantumlLocalRender(body) {
  const source =
    body && typeof body === "object" && "source" in body
      ? String(/** @type {{ source?: unknown }} */ (body).source ?? "")
      : "";
  const localPath =
    body && typeof body === "object" && "localPath" in body
      ? String(/** @type {{ localPath?: unknown }} */ (body).localPath ?? "")
      : "";
  const javaPath =
    body && typeof body === "object" && "javaPath" in body
      ? String(/** @type {{ javaPath?: unknown }} */ (body).javaPath ?? "java")
      : "java";
  const formatRaw =
    body && typeof body === "object" && "format" in body
      ? String(/** @type {{ format?: unknown }} */ (body).format ?? "svg")
      : "svg";
  const format = formatRaw.toLowerCase() === "png" ? "png" : "svg";

  const wrapped = wrapPlantumlSource(source);
  const tool = await assertLocalToolPath(localPath);
  const isJar = /\.jar$/i.test(tool);

  /** @type {string} */
  let bin;
  /** @type {string[]} */
  let args;
  if (isJar) {
    bin = await resolveJavaBin(javaPath);
    args = ["-jar", tool, format === "png" ? "-tpng" : "-tsvg", "-pipe"];
  } else {
    bin = tool;
    args = [format === "png" ? "-tpng" : "-tsvg", "-pipe"];
  }

  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      encoding: "buffer",
      timeout: LOCAL_TIMEOUT_MS,
      maxBuffer: MAX_RENDER_BYTES,
      input: wrapped,
      windowsHide: true,
    });
    const out = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || "");
    if (!out.length) {
      const errText = Buffer.isBuffer(stderr)
        ? stderr.toString("utf8", 0, 400)
        : String(stderr || "");
      throw Object.assign(
        new Error(
          `Local PlantUML produced no output${errText ? `: ${errText.trim().slice(0, 200)}` : ""}`,
        ),
        { status: 502 },
      );
    }
    return shapeImageResult(
      out,
      format === "png" ? "image/png" : "image/svg+xml",
    );
  } catch (e) {
    if (e && typeof e === "object" && "status" in e) throw e;
    const message = e instanceof Error ? e.message : String(e);
    if (/ETIMEDOUT|timed out/i.test(message)) {
      throw Object.assign(new Error("Local PlantUML render timed out"), { status: 504 });
    }
    throw Object.assign(new Error(`Local PlantUML render failed: ${message}`), { status: 502 });
  }
}
