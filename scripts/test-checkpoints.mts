/**
 * Per-turn checkpoints: the sidecar snapshots files before Agent edits and
 * restores the pre-turn state; the client captures before mutating and
 * refuses to edit when the snapshot fails.
 *
 * Usage: npx tsx scripts/test-checkpoints.mts
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkpointTargets, executeToolCall } from "../src/lib/agentTools.ts";
import { runAgentTurn } from "../src/lib/agentTurn.ts";
import { webcrypto } from "node:crypto";

Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = path.join(os.tmpdir(), `forknote-checkpoints-${process.pid}`);
const TOKEN = "c".repeat(64);

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      s.close(() => resolve(typeof addr === "object" && addr ? addr.port : 0));
    });
    s.on("error", reject);
  });
}

async function call(base: string, pathname: string, body: Record<string, unknown> = {}) {
  const res = await fetch(`${base}${pathname}`, {
    method: "POST",
    headers: { "X-ForkNote-Sidecar-Token": TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(pathname.startsWith("/fs/") ? { expectedRoot: PROJECT, ...body } : body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

const read = (rel: string) => fs.readFile(path.join(PROJECT, rel), "utf8");
const exists = (rel: string) => fs.access(path.join(PROJECT, rel)).then(() => true, () => false);

{
  assert.deepEqual(checkpointTargets({ tool: "write_file", path: "src/a.ts" }, "/p"), ["src/a.ts"]);
  assert.deepEqual(checkpointTargets({ tool: "rename_file", from: "a", to: "b" }, "/p"), ["a", "b"]);
  assert.deepEqual(checkpointTargets({ tool: "read_file", path: "a" }, "/p"), []);
  assert.deepEqual(checkpointTargets({ tool: "run_terminal", command: "rm a" }, "/p"), []);
  console.log("[PASS] checkpointTargets covers file-mutating tools only");
}

{
  // Client: capture happens before the write; a failed capture blocks it.
  const originalFetch = globalThis.fetch;
  const seen: string[] = [];
  let captureOk = true;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    seen.push(url.pathname);
    if (url.pathname.endsWith("/fs/checkpoint/capture")) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.checkpointId, "turn_t");
      assert.deepEqual(body.paths, ["a.txt"]);
      return captureOk
        ? Response.json({ id: "turn_t", paths: ["a.txt"] })
        : Response.json({ error: "disk full" }, { status: 500 });
    }
    if (url.pathname.endsWith("/fs/write")) {
      return Response.json({ path: "a.txt", size: 1, diff: "" });
    }
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  try {
    const ok = await executeToolCall({ tool: "write_file", path: "a.txt", content: "x" },
      "http://127.0.0.1:1", undefined, "/p", "en", { checkpointId: "turn_t" });
    assert.equal(ok.ok, true, ok.resultText);
    assert.deepEqual(seen.map((p) => p.replace(/^.*\/fs\//, "")), ["checkpoint/capture", "write"]);
    seen.length = 0;
    captureOk = false;
    const blocked = await executeToolCall({ tool: "write_file", path: "a.txt", content: "x" },
      "http://127.0.0.1:1", undefined, "/p", "en", { checkpointId: "turn_t" });
    assert.equal(blocked.ok, false);
    assert.match(blocked.resultText, /not applied/);
    assert.ok(!seen.some((p) => p.endsWith("/fs/write")), "write must not run after failed capture");
    console.log("[PASS] client captures before editing and fails closed");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  // Agent turn: the reply records one checkpoint id once a file edit succeeds.
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  let llmCalls = 0;
  const captureIds = new Set<string>();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/chat/completions")) {
      llmCalls += 1;
      const delta = llmCalls === 1
        ? { tool_calls: [{ index: 0, id: "w1", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "notes.md", content: "hi" }) } }] }
        : { content: "Done." };
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: null }] })}\n\n`));
          c.enqueue(encoder.encode("data: [DONE]\n\n"));
          c.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }
    if (url.pathname.endsWith("/fs/checkpoint/capture")) {
      captureIds.add(JSON.parse(String(init?.body)).checkpointId);
      return Response.json({ id: "x", paths: ["notes.md"] });
    }
    if (url.pathname.endsWith("/fs/write")) return Response.json({ path: "notes.md", size: 2, diff: "" });
    return Response.json({ error: "not found" }, { status: 404 });
  }) as typeof fetch;
  const patches: Array<{ checkpointId?: string }> = [];
  const settings = {
    baseUrl: "http://mock.local/v1", apiKey: "test", model: "test-model", useProxy: false,
    memoryLayerProject: false, memoryLayerPreferences: false, memoryLayerSession: false,
    agentRequireApproval: false, agentAllowTerminal: false, agentAutoDiagnostics: false, agentMaxRounds: 3,
  };
  const userText = "在项目里创建 notes.md 文件，内容写 hi";
  const thread = {
    id: "t", createdAt: 1,
    messages: [
      { id: "u", role: "user" as const, content: userText, children: [] as string[], createdAt: 1 },
      { id: "a", role: "assistant" as const, content: "", children: [] as string[], createdAt: 2 },
    ],
  };
  try {
    await runAgentTurn({
      llm: settings, settings, locale: "zh", session: undefined, userText, thread,
      projectRoot: "/tmp/forknote-ckpt-turn", sidecarUrl: "http://127.0.0.1:8787",
      signal: new AbortController().signal, isOwned: () => true,
      patchContent: (p) => patches.push(p), onAgentActivity: () => {}, onAgentChange: () => {},
      onAwaitPlanApproval: () => {},
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  const ids = patches.map((p) => p.checkpointId).filter(Boolean);
  assert.equal(captureIds.size, 1, "one checkpoint id per turn");
  assert.equal(ids.length, 1, "checkpointId is announced once");
  assert.ok(captureIds.has(ids[0]!) && /^turn_/.test(ids[0]!));
  console.log("[PASS] agent turn tags its reply with the checkpoint id");
}

await fs.rm(PROJECT, { recursive: true, force: true });
await fs.mkdir(PROJECT, { recursive: true });
await fs.writeFile(path.join(PROJECT, "a.txt"), "A");
await fs.writeFile(path.join(PROJECT, "c.txt"), "C");
await fs.writeFile(path.join(PROJECT, "e.txt"), "E");

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [path.join(ROOT, "sidecar/index.js")], {
  cwd: ROOT,
  env: { ...process.env, SIDECAR_PORT: String(port), SIDECAR_HOST: "127.0.0.1", SIDECAR_AUTH_TOKEN: TOKEN },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout?.on("data", (c) => { logs += String(c); });
child.stderr?.on("data", (c) => { logs += String(c); });

try {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(`${base}/health`, { headers: { "X-ForkNote-Sidecar-Token": TOKEN } });
      if (r.ok) break;
    } catch { /* retry */ }
    if (i > 100) throw new Error("sidecar did not start");
    await new Promise((r) => setTimeout(r, 80));
  }
  assert.equal((await call(base, "/project/open", { path: PROJECT })).status, 200);

  const id = "turn_test";
  const capture = (paths: string[]) => call(base, "/fs/checkpoint/capture", { checkpointId: id, paths });

  assert.equal((await capture(["a.txt"])).status, 200);
  await call(base, "/fs/write", { path: "a.txt", content: "A2" });
  // A second capture of the same path keeps the original pre-turn content.
  await capture(["a.txt"]);
  await call(base, "/fs/write", { path: "a.txt", content: "A3" });

  await capture(["new/dir/b.txt"]);
  await call(base, "/fs/write", { path: "new/dir/b.txt", content: "B" });

  await capture(["c.txt", "d.txt"]);
  assert.equal((await call(base, "/fs/rename", { from: "c.txt", to: "d.txt" })).status, 200);

  await capture(["e.txt"]);
  assert.equal((await call(base, "/fs/delete", { path: "e.txt" })).status, 200);

  const info = await call(base, "/fs/checkpoint/info", { checkpointId: id });
  assert.ok(info.data.paths.includes("a.txt") && info.data.paths.includes("new"), JSON.stringify(info.data));

  const restored = await call(base, "/fs/checkpoint/restore", { checkpointId: id });
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
  assert.equal(await read("a.txt"), "A");
  assert.equal(await read("c.txt"), "C");
  assert.equal(await read("e.txt"), "E");
  assert.equal(await exists("d.txt"), false);
  assert.equal(await exists("new"), false, "dirs created by the turn are removed");
  console.log("[PASS] restore reverts writes, creations, renames and deletes");

  assert.equal((await call(base, "/fs/checkpoint/info", { checkpointId: id })).data.missing, true);
  assert.equal((await call(base, "/fs/checkpoint/restore", { checkpointId: id })).status, 404);
  assert.equal((await call(base, "/fs/checkpoint/capture", { checkpointId: "../evil", paths: ["a.txt"] })).status, 400);
  assert.equal((await call(base, "/fs/checkpoint/capture", { checkpointId: id, paths: ["../outside.txt"] })).status, 400);
  console.log("[PASS] restored checkpoint is removed; bad ids and escaping paths rejected");

  for (let i = 0; i < 35; i++) {
    await call(base, "/fs/checkpoint/capture", { checkpointId: `old_${i}`, paths: ["a.txt"] });
  }
  const kept = await fs.readdir(path.join(PROJECT, ".forknote/checkpoints"));
  assert.ok(kept.length <= 30, `pruned to at most 30, got ${kept.length}`);
  assert.ok(kept.includes("old_34.json"), "newest checkpoint survives pruning");
  console.log("[PASS] old checkpoints are pruned");
} catch (e) {
  console.error("sidecar logs:\n", logs);
  throw e;
} finally {
  child.kill("SIGTERM");
  await fs.rm(PROJECT, { recursive: true, force: true });
}
console.log("All checkpoint probes passed.");
