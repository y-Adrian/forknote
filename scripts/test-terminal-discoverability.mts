/**
 * Probe #454: run_terminal already ships (default on). Assert registration,
 * Settings filter-off, and discoverability copy / Project panel deep-link.
 *
 * Usage: npx tsx scripts/test-terminal-discoverability.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getProjectOpenAITools } from "../src/lib/agentTools.ts";
import { t } from "../src/lib/i18n.ts";
import {
  normalizeApiSettings,
  resolveAgentAllowTerminal,
} from "../src/lib/settings.ts";

{
  assert.equal(resolveAgentAllowTerminal({}), true);
  assert.equal(resolveAgentAllowTerminal({ agentAllowTerminal: true }), true);
  assert.equal(resolveAgentAllowTerminal({ agentAllowTerminal: false }), false);
  assert.equal(normalizeApiSettings({}).agentAllowTerminal, true);
  console.log("[PASS] agentAllowTerminal defaults on");
}

{
  const namesOn = getProjectOpenAITools().map((x) => x.function.name);
  const namesExplicit = getProjectOpenAITools({ allowTerminal: true }).map(
    (x) => x.function.name,
  );
  const namesOff = getProjectOpenAITools({ allowTerminal: false }).map(
    (x) => x.function.name,
  );
  assert.ok(namesOn.includes("run_terminal"), "default tools include run_terminal");
  assert.ok(
    namesExplicit.includes("run_terminal"),
    "allowTerminal:true includes run_terminal",
  );
  assert.ok(
    !namesOff.includes("run_terminal"),
    "allowTerminal:false strips run_terminal",
  );
  console.log("[PASS] OpenAI tools list filters run_terminal");
}

{
  for (const locale of ["en", "zh"] as const) {
    const disabled = t("agent.activity.terminalDisabled", undefined, locale);
    const lead = t("projectPanel.lead", undefined, locale);
    const settingsLead = t("projectSettings.lead", undefined, locale);
    const on = t("projectPanel.terminalOn", undefined, locale);
    const off = t("projectPanel.terminalOff", undefined, locale);
    const link = t("projectPanel.terminalSettings", undefined, locale);
    assert.match(disabled, /Settings|设置/);
    assert.match(disabled, /Project|项目/);
    assert.match(lead, /run_terminal/);
    assert.match(settingsLead, /run_terminal/);
    assert.match(on, /run_terminal/);
    assert.match(off, /run_terminal/);
    assert.ok(link.trim().length > 0);
  }
  console.log("[PASS] i18n discoverability copy (en/zh)");
}

{
  const panel = readFileSync("src/components/ProjectPanel.tsx", "utf8");
  assert.match(panel, /resolveAgentAllowTerminal/);
  assert.match(panel, /setSettingsOpen\(true,\s*"project"\)/);
  assert.match(panel, /projectPanel\.terminalOn/);
  assert.match(panel, /projectPanel\.terminalOff/);
  assert.match(panel, /projectPanel\.terminalSettings/);

  const settings = readFileSync("src/components/SettingsPanel.tsx", "utf8");
  assert.match(settings, /agentAllowTerminal/);
  assert.match(settings, /projectSettings\.agentAllowTerminal/);

  const tools = readFileSync("src/lib/agentTools.ts", "utf8");
  assert.match(
    tools,
    /Settings → Project → Allow terminal tool \(run_terminal\)/,
  );
  console.log("[PASS] Project panel + Settings wiring");
}

console.log("\nAll terminal discoverability checks passed.");
