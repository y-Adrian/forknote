/**
 * PlantUML render helpers for the sidecar.
 * - server: proxy to Kroki-compatible POST or plantuml.com-style GET
 * - local: spawn plantuml binary or `java -jar plantuml.jar` with -pipe
 *
 * Server URLs come from user Settings (not diagram source). Self-hosted /
 * localhost is allowed; cloud metadata and non-http(s) schemes are blocked.
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import dns from "node:dns/promises";
import net from "node:net";
import { URL } from "node:url";
import { isPrivateIp } from "./network.mjs";

const MAX_SOURCE_CHARS = 100_000;
const MAX_RENDER_BYTES = 2 * 1024 * 1024;
const RENDER_TIMEOUT_MS = 30_000;
const LOCAL_TIMEOUT_MS = 45_000;
const STDERR_ERROR_CHARS = 280;

/** Homebrew / common macOS+Linux bin dirs for plantuml + Graphviz `dot`. */
const EXTRA_PATH_DIRS = [
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/local/bin",
  "/usr/local/sbin",
];

/**
 * JVM flags for `java -jar plantuml.jar` so macOS does not bounce a Java Dock
 * icon (AWT). Homebrew's `plantuml` wrapper already sets headless; we still
 * inject these for raw jar spawns and via JAVA_TOOL_OPTIONS for other wrappers.
 * `-Dapple.awt.UIElement=true` hides the Dock icon if AWT still initializes.
 */
export const PLANTUML_HEADLESS_JAVA_FLAGS = [
  "-Djava.awt.headless=true",
  "-Dapple.awt.UIElement=true",
];

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
 * @param {string} filePath
 */
async function isExistingFile(filePath) {
  try {
    const st = await fs.stat(filePath);
    return st.isFile();
  } catch {
    return false;
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
      new Error("Local PlantUML path must be absolute (e.g. /opt/homebrew/bin/plantuml or …/plantuml.jar)"),
      { status: 400 },
    );
  }
  if (!(await isExistingFile(trimmed))) {
    throw Object.assign(new Error(`Local PlantUML tool not found: ${trimmed}`), { status: 400 });
  }
  return trimmed;
}

/**
 * Homebrew's `plantuml` formula installs a wrapper that sets headless Java +
 * GRAPHVIZ_DOT. Prefer that over `java -jar …/Cellar/…/libexec/plantuml.jar`.
 * @param {string} toolPath
 * @returns {Promise<{ kind: "bin" | "jar"; path: string }>}
 */
export async function resolveLocalPlantumlInvocation(toolPath) {
  const tool = await assertLocalToolPath(toolPath);
  if (!/\.jar$/i.test(tool)) {
    return { kind: "bin", path: tool };
  }

  /** @type {string[]} */
  const candidates = [];
  // Cellar: …/plantuml/<ver>/libexec/plantuml.jar → …/plantuml/<ver>/bin/plantuml
  if (/[/\\](?:Cellar|opt)[/\\]plantuml[/\\]/i.test(tool) || /[/\\]libexec[/\\]plantuml\.jar$/i.test(tool)) {
    candidates.push(path.resolve(path.dirname(tool), "..", "bin", "plantuml"));
  }
  candidates.push("/opt/homebrew/bin/plantuml", "/usr/local/bin/plantuml");

  for (const candidate of candidates) {
    if (await isExistingFile(candidate)) {
      return { kind: "bin", path: candidate };
    }
  }
  return { kind: "jar", path: tool };
}

/**
 * @param {string} javaPath
 */
async function resolveJavaBin(javaPath) {
  const trimmed = String(javaPath || "java").trim() || "java";
  if (path.isAbsolute(trimmed)) {
    if (!(await isExistingFile(trimmed))) {
      throw Object.assign(new Error(`Java binary not found: ${trimmed}`), { status: 400 });
    }
  }
  return trimmed;
}

/**
 * Merge headless JVM options into JAVA_TOOL_OPTIONS for plantuml shell wrappers
 * that invoke `java -jar` without our argv flags.
 * @param {string} [prev]
 */
export function mergePlantumlJavaToolOptions(prev = "") {
  const existing = String(prev || "").trim();
  const parts = [];
  if (existing) parts.push(existing);
  for (const flag of PLANTUML_HEADLESS_JAVA_FLAGS) {
    const key = flag.split("=")[0];
    if (!key) continue;
    const re = new RegExp(`(^|\\s)${key.replace(/\./g, "\\.")}=`);
    if (!re.test(existing)) parts.push(flag);
  }
  return parts.join(" ");
}

/**
 * Build a PATH that can find Homebrew `dot` / plantuml even when the sidecar
 * was launched from an Electron app with a minimal environment.
 * Sets GRAPHVIZ_DOT when a known Graphviz binary exists, and JAVA_TOOL_OPTIONS
 * so non-Homebrew wrappers still run headless (no Dock bounce).
 * @param {NodeJS.ProcessEnv} [base]
 */
export async function buildPlantumlEnv(base = process.env) {
  const home = base.HOME || os.homedir();
  const mergedPath = [
    ...EXTRA_PATH_DIRS,
    ...(base.PATH ? base.PATH.split(path.delimiter) : []),
    "/usr/bin",
    "/bin",
  ]
    .filter(Boolean)
    .filter((dir, i, arr) => arr.indexOf(dir) === i)
    .join(path.delimiter);

  /** @type {NodeJS.ProcessEnv} */
  const env = {
    ...base,
    HOME: home,
    PATH: mergedPath,
    LANG: base.LANG || "en_US.UTF-8",
    LC_ALL: base.LC_ALL || base.LANG || "en_US.UTF-8",
    JAVA_TOOL_OPTIONS: mergePlantumlJavaToolOptions(base.JAVA_TOOL_OPTIONS),
  };

  if (!base.GRAPHVIZ_DOT) {
    const dots = [
      "/opt/homebrew/opt/graphviz/bin/dot",
      "/usr/local/opt/graphviz/bin/dot",
      "/opt/homebrew/bin/dot",
      "/usr/local/bin/dot",
    ];
    for (const dot of dots) {
      if (await isExistingFile(dot)) {
        env.GRAPHVIZ_DOT = dot;
        break;
      }
    }
  }
  return env;
}

/**
 * @param {unknown} err
 */
function truncateProcessDetail(err) {
  const stderr =
    err && typeof err === "object" && "stderr" in err && err.stderr
      ? Buffer.isBuffer(err.stderr)
        ? err.stderr.toString("utf8")
        : String(err.stderr)
      : "";
  const stdout =
    err && typeof err === "object" && "stdout" in err && err.stdout
      ? Buffer.isBuffer(err.stdout)
        ? err.stdout.toString("utf8")
        : String(err.stdout)
      : "";
  const raw = (stderr || stdout).trim().replace(/\s+/g, " ");
  return raw.slice(0, STDERR_ERROR_CHARS);
}

/**
 * @param {unknown} err
 */
function formatLocalPlantumlError(err) {
  if (err && typeof err === "object" && "status" in err) {
    return /** @type {Error} */ (err);
  }
  const message = err instanceof Error ? err.message : String(err);
  if (
    (err && typeof err === "object" && "code" in err && err.code === "ETIMEDOUT") ||
    /ETIMEDOUT|timed out/i.test(message)
  ) {
    return Object.assign(new Error("Local PlantUML render timed out"), { status: 504 });
  }

  const detail = truncateProcessDetail(err);
  const code =
    err && typeof err === "object" && "code" in err && err.code != null
      ? String(err.code)
      : "";
  let text = "Local PlantUML render failed";
  if (code && code !== "ETIMEDOUT" && !/^ERR_/i.test(code)) {
    text += ` (exit ${code})`;
  }
  if (detail) {
    text += `: ${detail}`;
  } else if (message && !/^Command failed:/i.test(message)) {
    text += `: ${message}`;
  } else {
    text +=
      ": no stderr captured — prefer the Homebrew `plantuml` binary over java -jar, and ensure Graphviz is installed (`brew install graphviz`)";
  }
  if (/(\bdot\b|graphviz)/i.test(`${detail}\n${message}`)) {
    text += " — install Graphviz (`brew install graphviz`) or set GRAPHVIZ_DOT";
  }
  return Object.assign(new Error(text), { status: 502 });
}

/**
 * Spawn plantuml with an explicit stdin end.
 *
 * IMPORTANT: Node `execFile(..., { input })` hangs for PlantUML `-pipe` on
 * macOS (process never finishes; timeout → "Command failed: … java -jar …").
 * Writing via spawn + stdin.end() works.
 *
 * @param {string} bin
 * @param {string[]} args
 * @param {string} input
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<{ stdout: Buffer; stderr: Buffer; code: number | null }>}
 */
export function spawnPlantumlPipe(bin, args, input, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env,
      cwd: env.HOME || os.homedir() || process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    /** @type {Buffer[]} */
    const outChunks = [];
    /** @type {Buffer[]} */
    const errChunks = [];
    let outBytes = 0;
    let settled = false;

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      fail(Object.assign(new Error("Local PlantUML render timed out"), { code: "ETIMEDOUT" }));
    }, LOCAL_TIMEOUT_MS);

    function fail(/** @type {Error & { stdout?: Buffer; stderr?: Buffer; code?: unknown }} */ err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      err.stdout = Buffer.concat(outChunks);
      err.stderr = Buffer.concat(errChunks);
      reject(err);
    }

    child.stdout.on("data", (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      outBytes += buf.length;
      if (outBytes > MAX_RENDER_BYTES) {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        fail(
          Object.assign(
            new Error(
              `Local PlantUML output too large (>${MAX_RENDER_BYTES} bytes)`,
            ),
            { code: "EFBIG" },
          ),
        );
        return;
      }
      outChunks.push(buf);
    });
    child.stderr.on("data", (chunk) => {
      errChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.on("error", (err) => fail(err));
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdout = Buffer.concat(outChunks);
      const stderr = Buffer.concat(errChunks);
      if (code && code !== 0) {
        const err = /** @type {Error & { code?: unknown; signal?: unknown; stdout?: Buffer; stderr?: Buffer }} */ (
          new Error(`Command failed: ${bin} ${args.join(" ")}`)
        );
        err.code = code;
        err.signal = signal;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout, stderr, code });
    });

    child.stdin.on("error", () => {
      /* ignore EPIPE after early exit */
    });
    child.stdin.end(input, "utf8");
  });
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
  const invocation = await resolveLocalPlantumlInvocation(localPath);
  const formatArg = format === "png" ? "-tpng" : "-tsvg";

  /** @type {string} */
  let bin;
  /** @type {string[]} */
  let args;
  if (invocation.kind === "jar") {
    bin = await resolveJavaBin(javaPath);
    args = [
      ...PLANTUML_HEADLESS_JAVA_FLAGS,
      "-jar",
      invocation.path,
      formatArg,
      "-charset",
      "UTF-8",
      "-pipe",
    ];
  } else {
    bin = invocation.path;
    args = [formatArg, "-charset", "UTF-8", "-pipe"];
  }

  const env = await buildPlantumlEnv();

  try {
    const { stdout, stderr } = await spawnPlantumlPipe(bin, args, wrapped, env);
    const out = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || "");
    if (!out.length) {
      const errText = Buffer.isBuffer(stderr)
        ? stderr.toString("utf8", 0, STDERR_ERROR_CHARS)
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
    throw formatLocalPlantumlError(e);
  }
}
