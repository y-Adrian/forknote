/**
 * Unit tests for PlantUML settings normalize + sidecar helpers.
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
} from "../sidecar/plantuml.mjs";
import {
  DEFAULT_PLANTUML_SERVER_URL,
  normalizeApiSettings,
  resolvePlantumlJavaPath,
  resolvePlantumlLocalPath,
  resolvePlantumlRenderMode,
  resolvePlantumlServerUrl,
} from "../src/lib/settings.ts";

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
  assert.ok(/general\.plantuml\.mode/.test(settingsUi), "settings UI wired");
  assert.ok(
    /general\.plantuml\.title/.test(i18n) &&
      /general\.plantuml\.mode\.server/.test(i18n) &&
      /Enable server or local rendering/.test(i18n),
    "i18n en keys present",
  );
  assert.ok(
    /PlantUML 渲染/.test(i18n) && /服务端（Kroki/.test(i18n),
    "i18n zh keys present",
  );
  console.log("ok static wiring");
}

async function main() {
  testNormalizeDefaults();
  testNormalizeModes();
  testWrapAndEncode();
  await testServerUrlSsrf();
  testWiringStatic();
  console.log("test-plantuml-render: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
