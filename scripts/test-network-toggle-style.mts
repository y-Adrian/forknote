/**
 * Probe (#464): the enabled, online Network toggle must stay visibly lit.
 * A late theme override once reset `.fn-network-toggle.is-on` to the plain
 * surface colour; the last rule for that state must use the accent fill.
 *
 * Usage: npx tsx scripts/test-network-toggle-style.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync("src/index.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selectors: m[1]!.split(",").map((s) => s.trim()),
  body: m[2]!,
}));

/** Rules that can style the online, enabled toggle at rest (no hover / offline). */
const onlineOn = rules.filter((r) =>
  r.selectors.some((s) => {
    const required = s.replace(/:not\([^)]*\)/g, "");
    return (
      required.startsWith(".fn-network-toggle.is-on") &&
      !required.includes(".is-offline") &&
      !required.includes(":hover") &&
      /background/.test(r.body)
    );
  }),
);
const last = onlineOn.at(-1);
assert.ok(last, "a rule styles the enabled Network toggle");
assert.match(last.body, /background:[^;]*var\(--ds-accent\)/, `last enabled rule uses the accent fill:\n${last.body}`);
assert.doesNotMatch(last.body, /background:\s*var\(--ds-surface\)\s*;/, "enabled state must not fall back to the plain surface");

const offline = rules.filter((r) => r.selectors.some((s) => s === ".fn-network-toggle.is-on.is-offline"));
assert.ok(offline.length > 0 && /--ds-warning/.test(offline.at(-1)!.body), "offline warning styling is kept");

console.log("test-network-toggle-style: ok");
