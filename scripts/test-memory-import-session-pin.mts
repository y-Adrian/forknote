/**
 * Probe #344: memory pack / session-memory imports must write to the
 * initiating session even if the active note changes mid-operation.
 *
 * Usage: npx tsx scripts/test-memory-import-session-pin.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import type { ApiSettings, ChatSession } from "../src/types.ts";

Object.defineProperty(globalThis, "crypto", {
  configurable: true,
  value: webcrypto,
});

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  },
});

{
  const ui = readFileSync("src/components/MemoryPanel.tsx", "utf8");
  const handler = ui.slice(
    ui.indexOf("const onImportFile"),
    ui.indexOf("return (", ui.indexOf("const onImportFile")),
  );
  assert.ok(handler.includes("pinnedSessionId"));
  assert.ok(handler.includes("{ sessionId: pinnedSessionId }"));
  assert.ok(handler.includes("setSessionMemory(parsed.sessionMemory!.summary, pinnedSessionId)"));
  console.log("[PASS] MemoryPanel pins initiating session through import awaits");
}

const { useAppStore } = await import("../src/store/useAppStore.ts");

const settings: ApiSettings = {
  baseUrl: "http://127.0.0.1:4567/v1",
  apiKey: "probe-key",
  model: "probe",
  useProxy: false,
  memoryLayerPreferences: false,
  memoryLayerProject: false,
  memoryLayerSession: false,
  agentAllowNetwork: false,
  agentRequireApproval: false,
};

function session(id: string): ChatSession {
  return {
    id,
    title: id,
    thread: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function reset(active: string): void {
  values.clear();
  useAppStore.setState({
    sessions: [session("A"), session("B")],
    activeSessionId: active,
    thread: null,
    settings,
    projectRoot: null,
    sidecarUrl: null,
    error: null,
  });
}

reset("A");
useAppStore.getState().switchSession("B");
assert.equal(useAppStore.getState().activeSessionId, "B");

await useAppStore.getState().saveContextMemoryFields(
  {
    summary: "imported-summary-A",
    tasks: "- [ ] A",
    decisions: "decide-A",
  },
  { sessionId: "A" },
);

{
  const a = useAppStore.getState().sessions.find((s) => s.id === "A")!;
  const b = useAppStore.getState().sessions.find((s) => s.id === "B")!;
  assert.equal(useAppStore.getState().activeSessionId, "B");
  assert.equal(a.contextMemory?.summary, "imported-summary-A");
  assert.equal(a.contextMemory?.tasks, "- [ ] A");
  assert.equal(b.contextMemory, undefined);
  console.log("[PASS] saveContextMemoryFields honors explicit sessionId");
}

reset("A");
useAppStore.getState().switchSession("B");
useAppStore.getState().setSessionMemory("session-note-A", "A");
{
  const a = useAppStore.getState().sessions.find((s) => s.id === "A")!;
  const b = useAppStore.getState().sessions.find((s) => s.id === "B")!;
  assert.equal(a.sessionMemory?.summary, "session-note-A");
  assert.equal(b.sessionMemory, undefined);
  console.log("[PASS] setSessionMemory honors explicit sessionId");
}

console.log("test-memory-import-session-pin: ok");
