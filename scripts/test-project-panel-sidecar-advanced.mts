/**
 * Static probe: Local project panel keeps Sidecar proxy URL under Advanced,
 * with copy that clarifies /sidecar is a frontend proxy path (not a folder).
 * Usage: npx tsx scripts/test-project-panel-sidecar-advanced.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const panel = readFileSync(
  join(root, "src/components/ProjectPanel.tsx"),
  "utf8",
);
const i18n = readFileSync(join(root, "src/lib/i18n.ts"), "utf8");
const css = readFileSync(join(root, "src/index.css"), "utf8");
const vite = readFileSync(join(root, "vite.config.ts"), "utf8");
const electron = readFileSync(join(root, "electron/uiServer.cjs"), "utf8");
const sidecarClient = readFileSync(join(root, "src/lib/sidecar.ts"), "utf8");

assert.ok(
  /DEFAULT_SIDECAR_URL/.test(panel),
  "panel must use DEFAULT_SIDECAR_URL",
);
assert.ok(
  /projectPanel\.advanced/.test(panel) && /advancedOpen/.test(panel),
  "Sidecar URL must sit behind Advanced disclosure",
);
assert.ok(
  /projectPanel\.path/.test(panel) &&
    panel.indexOf("projectPanel.path") < panel.indexOf("projectPanel.advanced"),
  "project folder field should come before Advanced",
);
assert.ok(
  /setAdvancedOpen\(nextUrl !== DEFAULT_SIDECAR_URL\)/.test(panel),
  "non-default Sidecar URL should auto-expand Advanced",
);
assert.ok(
  /projectPanel\.sidecarUrlHint/.test(panel),
  "advanced body must show sidecar URL hint",
);

assert.ok(
  /"projectPanel\.advanced": "Advanced"/.test(i18n) &&
    /"projectPanel\.advanced": "高级"/.test(i18n),
  "Advanced / 高级 i18n keys required",
);
assert.ok(
  /not a project folder path/i.test(i18n) &&
    /这不是项目目录路径/.test(i18n),
  "copy must clarify /sidecar is not a folder path",
);
assert.ok(
  /"projectPanel\.sidecarUrl": "Sidecar proxy URL"/.test(i18n),
  "EN label should say proxy URL",
);

assert.ok(
  /\.fn-project-advanced/.test(css) && /\.fn-project-advanced-toggle/.test(css),
  "advanced disclosure styles required",
);

assert.ok(
  /DEFAULT_SIDECAR_URL = "\/sidecar"/.test(sidecarClient),
  "client default remains /sidecar",
);
assert.ok(
  /"\/sidecar": sidecarProxy/.test(vite) &&
    /rewrite: \(p\) => p\.replace\(\/\^\\\/sidecar\/, ""\)/.test(vite),
  "Vite must proxy /sidecar → :8787",
);
assert.ok(
  /url\.startsWith\("\/sidecar"\)/.test(electron),
  "Electron UI server must proxy /sidecar",
);

console.log("ok project panel sidecar advanced UX");
