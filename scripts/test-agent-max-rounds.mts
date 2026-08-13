/**
 * Settings → Project agentMaxRounds is the hard tool-round stop.
 * Soft web complexity budgets must not override a raised setting (e.g. 128).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_AGENT_MAX_ROUNDS,
  MAX_AGENT_MAX_ROUNDS,
  MIN_AGENT_MAX_ROUNDS,
  resolveAgentMaxRounds,
} from "../src/lib/settings.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const agentTurnSrc = readFileSync(join(root, "src/lib/agentTurn.ts"), "utf8");
const i18nSrc = readFileSync(join(root, "src/lib/i18n.ts"), "utf8");

function testResolveAgentMaxRounds() {
  assert.equal(MIN_AGENT_MAX_ROUNDS, 1);
  assert.equal(MAX_AGENT_MAX_ROUNDS, 128);
  assert.equal(DEFAULT_AGENT_MAX_ROUNDS, 50);
  assert.equal(resolveAgentMaxRounds({}), DEFAULT_AGENT_MAX_ROUNDS);
  assert.equal(resolveAgentMaxRounds({ agentMaxRounds: 128 }), 128);
  assert.equal(resolveAgentMaxRounds({ agentMaxRounds: 1 }), 1);
  assert.equal(resolveAgentMaxRounds({ agentMaxRounds: 999 }), 128);
  assert.equal(resolveAgentMaxRounds({ agentMaxRounds: 0 }), 1);
  assert.equal(resolveAgentMaxRounds({ agentMaxRounds: 12.7 }), 13);
  console.log("ok resolveAgentMaxRounds clamps 1–128");
}

function testAgentTurnHardLimitIsSettings() {
  assert.match(
    agentTurnSrc,
    /const agentMaxRoundsBase = resolveAgentMaxRounds\(settings\)/,
  );
  assert.match(
    agentTurnSrc,
    /const agentMaxRounds = agentMaxRoundsBase/,
  );
  assert.doesNotMatch(
    agentTurnSrc,
    /resolveWebToolRoundBudget/,
    "runAgentTurn must not soft-cap rounds via resolveWebToolRoundBudget",
  );
  assert.doesNotMatch(
    agentTurnSrc,
    /agentMaxRounds\s*=\s*networkOnlyTurn\s*\?/,
    "network-only turns must not pick a lower soft budget as hard stop",
  );
  console.log("ok runAgentTurn hard stop = settings agentMaxRounds");
}

function testSettingsHintCopy() {
  assert.match(i18nSrc, /projectSettings\.agentMaxRoundsHint/);
  assert.doesNotMatch(
    i18nSrc,
    /soft complexity budget \(simple ≈8, multi ≈16\) that never exceeds this value/,
  );
  assert.doesNotMatch(
    i18nSrc,
    /联网问答还会套一层复杂度软预算（简单约 8、复杂约 16）/,
  );
  assert.match(
    i18nSrc,
    /This value is always the effective hard stop/,
  );
  assert.match(
    i18nSrc,
    /此值始终是生效的硬上限/,
  );
  console.log("ok settings hint: settings is the hard stop");
}

testResolveAgentMaxRounds();
testAgentTurnHardLimitIsSettings();
testSettingsHintCopy();
console.log("all agent-max-rounds tests passed");
