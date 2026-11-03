/**
 * Probe: text zoom clamp / step helpers.
 * Usage: npx tsx scripts/test-text-zoom.mts
 */
import { readFileSync } from "node:fs";

// Minimal localStorage so persistence is exercised in Node.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const {
  TEXT_ZOOM_DEFAULT,
  TEXT_ZOOM_MAX,
  TEXT_ZOOM_MIN,
  UI_TEXT_ZOOM_MAX,
  UI_TEXT_ZOOM_MIN,
  applyTextZoom,
  chatTextScale,
  stepTextZoom,
  uiTextScale,
} = await import("../src/lib/textZoom.ts");

const results: Array<{ name: string; pass: boolean }> = [];
function ok(name: string, pass: boolean) {
  results.push({ name, pass });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}`);
}

ok("apply 1.2", applyTextZoom(1.2, false) === 1.2);
ok("clamp max", applyTextZoom(9, false) === TEXT_ZOOM_MAX);
ok("clamp min", applyTextZoom(0.1, false) === TEXT_ZOOM_MIN);

applyTextZoom(1, false);
ok("step in", stepTextZoom("in") === 1.05);
ok("step out", stepTextZoom("out") === 1);
ok("step reset", stepTextZoom("reset") === TEXT_ZOOM_DEFAULT);

// Interface text size: its own range, storage key and change notifications.
ok("ui clamp max", uiTextScale.apply(9, false) === UI_TEXT_ZOOM_MAX);
ok("ui clamp min", uiTextScale.apply(0.1, false) === UI_TEXT_ZOOM_MIN);
const seen: number[] = [];
const unsubscribe = uiTextScale.subscribe((v) => seen.push(v));
uiTextScale.apply(1.1);
ok("ui persists", store.get(uiTextScale.storageKey) === "1.1");
ok("ui read back", uiTextScale.read() === 1.1);
ok("ui notifies", seen.at(-1) === 1.1);
ok("ui independent of chat", chatTextScale.get() === TEXT_ZOOM_DEFAULT);
uiTextScale.apply(TEXT_ZOOM_DEFAULT);
ok("ui default clears storage", !store.has(uiTextScale.storageKey));
unsubscribe();
uiTextScale.apply(1.05, false);
ok("unsubscribe stops notifications", seen.at(-1) === TEXT_ZOOM_DEFAULT);
chatTextScale.apply(1.2);
ok("chat persists to its own key", store.get(chatTextScale.storageKey) === "1.2" && chatTextScale.storageKey !== uiTextScale.storageKey);

// CSS: interface size scales the root font; chat sizes divide it back out.
const css = readFileSync("src/index.css", "utf8");
ok("root font follows ui scale", /html \{\s*font-size: calc\(100% \* var\(--fn-ui-text-zoom/.test(css));
ok("chat text independent of ui scale",
  /--fn-text-chat:\s*calc\(1\.05rem \* var\(--fn-text-zoom\) \/ var\(--fn-ui-text-zoom\)\)/.test(css));
const panel = readFileSync("src/components/SettingsPanel.tsx", "utf8");
ok("settings offers both sizes",
  /scale=\{chatTextScale\}/.test(panel) && /scale=\{uiTextScale\}/.test(panel));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
