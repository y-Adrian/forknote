/**
 * Probe #371: locale switch hot-swaps without a full-page reload.
 *
 * Usage: npx tsx scripts/test-locale-hot-swap.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { t } from "../src/lib/i18n.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const settings = readFileSync(
  join(root, "src/components/SettingsPanel.tsx"),
  "utf8",
);
const i18n = readFileSync(join(root, "src/lib/i18n.ts"), "utf8");
const css = readFileSync(join(root, "src/index.css"), "utf8");

// Prove the prior failure: language confirm used to reload.
assert.match(settings, /confirmLanguageSwitch/);
assert.match(settings, /applyLocale\(pendingLocale\)/);
assert.doesNotMatch(
  settings,
  /confirmLanguageSwitch[\s\S]*?window\.location\.reload\(\)/,
  "language confirm must not call window.location.reload",
);
assert.doesNotMatch(
  settings,
  /applyLocale\(pendingLocale\);\s*window\.location\.reload\(\)/,
);

// applyLocale already notifies useLocale subscribers for a hot swap.
assert.match(i18n, /export function applyLocale/);
assert.match(i18n, /notify\(locale\)/);
assert.match(i18n, /listeners\.add\(onNotify\)/);

// Copy no longer promises a destructive reload.
assert.doesNotMatch(
  t("general.languageDesc", undefined, "en"),
  /\breloads?\b/i,
);
assert.match(t("general.languageDesc", undefined, "en"), /without reloading/i);
assert.match(t("general.languageDesc", undefined, "zh"), /不会刷新/);
assert.doesNotMatch(
  t("general.langConfirmBody", { lang: "中文" }, "en"),
  /\breloads?\b/i,
);
assert.doesNotMatch(
  t("general.langConfirmBody", { lang: "English" }, "zh"),
  /刷新/,
);
assert.match(
  t("general.langConfirmBody", { lang: "English" }, "en"),
  /kept|drafts|composer/i,
);

const confirmBackdrop = css.slice(
  css.indexOf(".fn-lang-confirm-backdrop"),
  css.indexOf(".fn-lang-confirm-modal.modal"),
);
assert.match(
  confirmBackdrop,
  /z-index:\s*calc\(var\(--fn-z-modal\) \+ 10\)/,
  "language confirmation must render above the Settings modal",
);

console.log("[PASS] locale hot-swap without full-page reload");
console.log("test-locale-hot-swap: ok");
