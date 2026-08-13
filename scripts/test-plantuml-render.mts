/**
 * Unit tests for PlantUML settings normalize + sidecar helpers + browser fallback.
 * Usage: npx tsx scripts/test-plantuml-render.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  encodePlantumlText,
  wrapPlantumlSource,
  assertPlantumlServerUrl,
  resolveLocalPlantumlInvocation,
  spawnPlantumlPipe,
  buildPlantumlEnv,
  handlePlantumlLocalRender,
} from "../sidecar/plantuml.mjs";
import {
  assertPlantumlServerUrlClient,
  encodePlantumlTextClient,
  isSidecarUnreachableError,
  PLANTUML_LOCAL_SIDECAR_HINT,
  wrapPlantumlSourceClient,
} from "../src/lib/plantumlClient.ts";
import {
  DEFAULT_PLANTUML_SERVER_URL,
  normalizeApiSettings,
  resolvePlantumlJavaPath,
  resolvePlantumlLocalPath,
  resolvePlantumlRenderMode,
  resolvePlantumlServerUrl,
} from "../src/lib/settings.ts";
import { renderPlantuml } from "../src/lib/sidecar.ts";


const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function testNormalizeDefaults() {
  const s = normalizeApiSettings({});
  assert.equal(s.plantumlRenderMode, "off");
  assert.equal(s.plantumlServerUrl, DEFAULT_PLANTUML_SERVER_URL);
  assert.equal(s.plantumlLocalPath, "");
  assert.equal(s.plantumlJavaPath, "java");
  assert.equal(resolvePlantumlRenderMode(s), "off");
  console.log("ok plantuml defaults");
}

function testNormalizeModes() {
  assert.equal(
    resolvePlantumlRenderMode(
      normalizeApiSettings({ plantumlRenderMode: "server" }),
    ),
    "server",
  );
  assert.equal(
    resolvePlantumlRenderMode(
      normalizeApiSettings({ plantumlRenderMode: "local" }),
    ),
    "local",
  );
  assert.equal(
    resolvePlantumlRenderMode(
      normalizeApiSettings({
        plantumlRenderMode: "nope" as unknown as "off",
      }),
    ),
    "off",
  );
  const server = normalizeApiSettings({
    plantumlRenderMode: "server",
    plantumlServerUrl: "  https://kroki.example/  ",
  });
  assert.equal(resolvePlantumlServerUrl(server), "https://kroki.example/");
  assert.equal(
    resolvePlantumlServerUrl(normalizeApiSettings({ plantumlServerUrl: "  " })),
    DEFAULT_PLANTUML_SERVER_URL,
  );
  assert.equal(
    resolvePlantumlLocalPath(
      normalizeApiSettings({ plantumlLocalPath: " /tmp/plantuml.jar " }),
    ),
    "/tmp/plantuml.jar",
  );
  assert.equal(
    resolvePlantumlJavaPath(normalizeApiSettings({ plantumlJavaPath: "" })),
    "java",
  );
  console.log("ok plantuml mode branching + normalize");
}

function testWrapAndEncode() {
  assert.equal(
    wrapPlantumlSource("A -> B"),
    "@startuml\nA -> B\n@enduml",
  );
  assert.equal(
    wrapPlantumlSource("@startuml\nA -> B\n@enduml"),
    "@startuml\nA -> B\n@enduml",
  );
  assert.throws(() => wrapPlantumlSource("   "), /empty/i);
  const encoded = encodePlantumlText("@startuml\nA -> B\n@enduml");
  assert.ok(encoded.length > 8);
  assert.match(encoded, /^[0-9A-Za-z\-_]+$/);
  console.log("ok wrap + plantuml encode");
}

async function testServerUrlSsrf() {
  await assert.rejects(
    () => assertPlantumlServerUrl("file:///etc/passwd"),
    /http/i,
  );
  await assert.rejects(
    () => assertPlantumlServerUrl("https://user:pass@example.com"),
    /credential/i,
  );
  await assert.rejects(
    () => assertPlantumlServerUrl("http://169.254.169.254/latest"),
    /link-local|metadata|Blocked/i,
  );
  // Self-hosted localhost is intentionally allowed for PlantUML.
  const local = await assertPlantumlServerUrl("http://127.0.0.1:8000");
  assert.equal(local.hostname, "127.0.0.1");
  const kroki = await assertPlantumlServerUrl("https://kroki.io");
  assert.equal(kroki.hostname, "kroki.io");
  console.log("ok plantuml server URL policy");
}

function testWiringStatic() {
  const fence = readFileSync(join(root, "src/components/DiagramFence.tsx"), "utf8");
  const sidecar = readFileSync(join(root, "sidecar/index.js"), "utf8");
  const client = readFileSync(join(root, "src/lib/sidecar.ts"), "utf8");
  const plantumlClient = readFileSync(
    join(root, "src/lib/plantumlClient.ts"),
    "utf8",
  );
  const uiServer = readFileSync(join(root, "electron/uiServer.cjs"), "utf8");
  const settingsUi = readFileSync(
    join(root, "src/components/SettingsPanel.tsx"),
    "utf8",
  );
  const i18n = readFileSync(join(root, "src/lib/i18n.ts"), "utf8");

  assert.ok(/PlantumlDiagram/.test(fence), "PlantumlDiagram component");
  assert.ok(/renderPlantuml/.test(fence), "calls renderPlantuml");
  assert.ok(/plantumlRenderMode/.test(fence), "reads plantumlRenderMode");
  assert.ok(/\/plantuml\/server/.test(sidecar), "sidecar server route");
  assert.ok(/\/plantuml\/local/.test(sidecar), "sidecar local route");
  assert.ok(
    /renderPlantumlServerDirect/.test(client),
    "client falls back to direct server render",
  );
  assert.ok(
    /isSidecarUnreachableError/.test(plantumlClient),
    "detects sidecar-down errors",
  );
  assert.ok(
    /kind === "sidecar"/.test(uiServer) && /SIDECAR_UNREACHABLE/.test(uiServer),
    "Electron proxy maps sidecar ECONNREFUSED to actionable JSON",
  );
  assert.ok(/general\.plantuml\.mode/.test(settingsUi), "settings UI wired");
  assert.ok(
    /general\.plantuml\.title/.test(i18n) &&
      /general\.plantuml\.mode\.server/.test(i18n) &&
      /Enable server or local rendering/.test(i18n) &&
      /public Kroki/.test(i18n),
    "i18n en keys present",
  );
  assert.ok(
    /PlantUML 渲染/.test(i18n) &&
      /服务端（Kroki/.test(i18n) &&
      /公共 Kroki/.test(i18n),
    "i18n zh keys present",
  );
  console.log("ok static wiring");
}

async function testClientEncodeMatchesSidecar() {
  const source = wrapPlantumlSource("A -> B: hi");
  const fromSidecar = encodePlantumlText(source);
  const fromClient = await encodePlantumlTextClient(source);
  assert.equal(fromClient, fromSidecar);
  assert.equal(
    wrapPlantumlSourceClient("A -> B"),
    wrapPlantumlSource("A -> B"),
  );
  assert.throws(() => assertPlantumlServerUrlClient("file:///etc/passwd"), /http/i);
  assert.throws(
    () => assertPlantumlServerUrlClient("http://169.254.169.254/latest"),
    /link-local|metadata|Blocked/i,
  );
  console.log("ok client encode + URL policy matches sidecar");
}

function testSidecarUnreachableDetection() {
  assert.equal(
    isSidecarUnreachableError(
      new Error(
        "Proxy upstream error (http://127.0.0.1:8787): connect ECONNREFUSED 127.0.0.1:8787",
      ),
    ),
    true,
  );
  assert.equal(
    isSidecarUnreachableError(
      new Error(
        "Sidecar unreachable on 127.0.0.1:8787. Run npm run sidecar (or npm run dev), then retry.",
      ),
    ),
    true,
  );
  assert.equal(
    isSidecarUnreachableError(new TypeError("Failed to fetch")),
    true,
  );
  assert.equal(
    isSidecarUnreachableError(new Error("PlantUML server HTTP 502: boom")),
    false,
  );
  assert.ok(/sidecar/i.test(PLANTUML_LOCAL_SIDECAR_HINT));
  console.log("ok sidecar-unreachable detection");
}

async function testServerDirectFallbackWithoutSidecar() {
  const prevFetch = globalThis.fetch;
  let sidecarHits = 0;
  let krokiHits = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/plantuml/server") || url.includes("127.0.0.1:8787")) {
      sidecarHits += 1;
      throw new TypeError("Failed to fetch");
    }
    if (url.includes("kroki.io/plantuml/svg")) {
      krokiHits += 1;
      assert.equal(init?.method, "POST");
      return new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', {
        status: 200,
        headers: { "Content-Type": "image/svg+xml" },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const result = await renderPlantuml(
      {
        mode: "server",
        source: "A -> B",
        serverUrl: "https://kroki.io",
        format: "svg",
      },
      "http://127.0.0.1:8787",
    );
    assert.equal(result.format, "svg");
    assert.ok(result.svg.includes("<svg"));
    assert.equal(sidecarHits, 1);
    assert.equal(krokiHits, 1);
  } finally {
    globalThis.fetch = prevFetch;
  }
  console.log("ok server mode direct Kroki fallback when sidecar down");
}

async function testLocalModeRequiresSidecarMessage() {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        renderPlantuml(
          {
            mode: "local",
            source: "A -> B",
            localPath: "/tmp/plantuml.jar",
            // No serverUrl → must surface sidecar hint (no soft fallback).
          },
          "http://127.0.0.1:8787",
        ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /Local PlantUML needs the sidecar/i);
        assert.match(err.message, /npm run sidecar/i);
        return true;
      },
    );
  } finally {
    globalThis.fetch = prevFetch;
  }
  console.log("ok local mode actionable sidecar-down message");
}

async function testLocalModeSoftFallsBackToServer() {
  const prevFetch = globalThis.fetch;
  let localHits = 0;
  let krokiHits = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/plantuml/local")) {
      localHits += 1;
      return new Response(
        JSON.stringify({
          error:
            "Local PlantUML render failed: Command failed: java -jar plantuml.jar -tsvg -pipe",
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/plantuml/server") || url.includes("127.0.0.1:8787")) {
      throw new TypeError("Failed to fetch");
    }
    if (url.includes("kroki.io/plantuml/svg")) {
      krokiHits += 1;
      assert.equal(init?.method, "POST");
      return new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', {
        status: 200,
        headers: { "Content-Type": "image/svg+xml" },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const result = await renderPlantuml(
      {
        mode: "local",
        source: "A -> B",
        localPath: "/tmp/plantuml.jar",
        serverUrl: "https://kroki.io",
        format: "svg",
      },
      "http://127.0.0.1:8787",
    );
    assert.equal(result.format, "svg");
    assert.ok(result.svg.includes("<svg"));
    assert.equal(localHits, 1);
    assert.equal(krokiHits, 1);
  } finally {
    globalThis.fetch = prevFetch;
  }
  console.log("ok local mode soft-falls back to Kroki when local spawn fails");
}

async function testResolveHomebrewJarToBinary() {
  const jar =
    "/opt/homebrew/Cellar/plantuml/1.2026.6/libexec/plantuml.jar";
  const bin = "/opt/homebrew/bin/plantuml";
  try {
    const { accessSync, constants } = await import("node:fs");
    accessSync(jar, constants.R_OK);
    accessSync(bin, constants.R_OK);
  } catch {
    console.log("skip homebrew jar→binary resolve (plantuml not installed)");
    return;
  }
  const resolved = await resolveLocalPlantumlInvocation(jar);
  assert.equal(resolved.kind, "bin");
  assert.match(resolved.path, /plantuml$/);
  assert.notEqual(resolved.path, jar);
  console.log("ok Homebrew cellar jar resolves to plantuml binary");
}

async function testLocalSpawnPipeAndStderr() {
  const bin = "/opt/homebrew/bin/plantuml";
  try {
    const { accessSync, constants } = await import("node:fs");
    accessSync(bin, constants.R_OK);
  } catch {
    console.log("skip local spawn pipe probe (plantuml not installed)");
    return;
  }

  const env = await buildPlantumlEnv({
    HOME: process.env.HOME,
    PATH: "/usr/bin:/bin",
    TMPDIR: process.env.TMPDIR || "/tmp",
  });
  const ok = await spawnPlantumlPipe(
    bin,
    ["-tsvg", "-charset", "UTF-8", "-pipe"],
    "@startuml\nA -> B\n@enduml\n",
    env,
  );
  assert.ok(ok.stdout.toString("utf8").includes("<svg"));

  await assert.rejects(
    () =>
      handlePlantumlLocalRender({
        source: "@startuml\nthis is not valid ((((\n@enduml",
        localPath: bin,
        format: "svg",
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Local PlantUML render failed/i);
      assert.match(err.message, /Syntax Error|ERROR/i);
      assert.doesNotMatch(err.message, /^Local PlantUML render failed: Command failed:/);
      return true;
    },
  );
  console.log("ok local spawn pipe + stderr surfaced");
}

async function main() {
  testNormalizeDefaults();
  testNormalizeModes();
  testWrapAndEncode();
  await testServerUrlSsrf();
  testWiringStatic();
  await testClientEncodeMatchesSidecar();
  testSidecarUnreachableDetection();
  await testServerDirectFallbackWithoutSidecar();
  await testLocalModeRequiresSidecarMessage();
  await testLocalModeSoftFallsBackToServer();
  await testResolveHomebrewJarToBinary();
  await testLocalSpawnPipeAndStderr();
  console.log("test-plantuml-render: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
