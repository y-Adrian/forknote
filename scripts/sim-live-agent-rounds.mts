/**
 * Multi-round live simulation against cached ForkNote DeepSeek settings.
 *
 * Loads API settings from Electron Local Storage (never prints the key).
 * Usage:
 *   npx tsx scripts/sim-live-agent-rounds.mts
 * Optional:
 *   FORKNOTE_LIVE_PROJECT=/path/to/project
 *   FORKNOTE_ELECTRON_USER_DATA=~/Library/Application Support/forknote
 *   FORKNOTE_API_KEY / FORKNOTE_BASE_URL / FORKNOTE_MODEL
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { webcrypto } from "node:crypto";
import { runAgentTurn } from "../src/lib/agentTurn.ts";
import type {
  ApiSettings,
  ChatMessage,
  ChatSession,
  ThreadRoot,
} from "../src/types.ts";

Object.defineProperty(globalThis, "crypto", {
  value: webcrypto,
  configurable: true,
});

type LoadedSettings = Pick<
  ApiSettings,
  | "baseUrl"
  | "apiKey"
  | "model"
  | "useProxy"
  | "agentRequireApproval"
  | "agentAllowTerminal"
>;

function redactMeta(s: LoadedSettings) {
  return {
    baseUrl: s.baseUrl,
    model: s.model,
    useProxy: s.useProxy,
    apiKeySet: Boolean(s.apiKey?.trim()),
    apiKeyLen: s.apiKey?.trim().length ?? 0,
  };
}

function decodeChromiumLocalStorageBlobs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    let buf: Buffer;
    try {
      buf = readFileSync(path);
    } catch {
      continue;
    }
    for (const enc of ["utf8", "utf16le"] as const) {
      try {
        out.push(buf.toString(enc));
      } catch {
        /* ignore */
      }
    }
  }
  return out;
}

function extractForknoteSettings(blobs: string[]): LoadedSettings | null {
  for (const text of blobs) {
    const keyIdx = text.indexOf("forknote-settings");
    if (keyIdx < 0) continue;
    const window = text.slice(keyIdx, keyIdx + 12000);
    const start = window.indexOf("{");
    if (start < 0) continue;
    let depth = 0;
    let end = -1;
    for (let i = start; i < window.length; i++) {
      const ch = window[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end < 0) continue;
    try {
      const raw = JSON.parse(window.slice(start, end)) as Record<string, unknown>;
      const apiKey = String(raw.apiKey ?? "").trim();
      const baseUrl = String(raw.baseUrl ?? "").trim();
      const model = String(raw.model ?? "").trim();
      if (!apiKey || !baseUrl) continue;
      return {
        baseUrl,
        apiKey,
        model: model || "deepseek-chat",
        useProxy: false,
        agentRequireApproval: false,
        agentAllowTerminal: true,
      };
    } catch {
      /* try next blob */
    }
  }
  return null;
}

function loadCachedDeepSeekSettings(): LoadedSettings {
  const fromEnvKey = process.env.FORKNOTE_API_KEY?.trim();
  const fromEnvBase = process.env.FORKNOTE_BASE_URL?.trim();
  const fromEnvModel = process.env.FORKNOTE_MODEL?.trim();
  if (fromEnvKey && fromEnvBase) {
    return {
      baseUrl: fromEnvBase,
      apiKey: fromEnvKey,
      model: fromEnvModel || "deepseek-chat",
      useProxy: false,
      agentRequireApproval: false,
      agentAllowTerminal: true,
    };
  }

  // Local cache file (gitignored) written from Electron settings extract.
  try {
    const localPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../.forknote/live-api.local.json",
    );
    const raw = JSON.parse(readFileSync(localPath, "utf8")) as Record<
      string,
      unknown
    >;
    const apiKey = String(raw.apiKey ?? "").trim();
    const baseUrl = String(raw.baseUrl ?? "").trim();
    const model = String(raw.model ?? "").trim();
    if (apiKey && baseUrl) {
      return {
        baseUrl,
        apiKey,
        model: model || "deepseek-chat",
        useProxy: false,
        agentRequireApproval: false,
        agentAllowTerminal: true,
      };
    }
  } catch {
    /* fall through */
  }

  const userData =
    process.env.FORKNOTE_ELECTRON_USER_DATA?.trim() ||
    join(homedir(), "Library/Application Support/forknote");
  const leveldb = join(userData, "Local Storage", "leveldb");
  const settings = extractForknoteSettings(decodeChromiumLocalStorageBlobs(leveldb));
  if (!settings) {
    throw new Error(
      `Could not load forknote-settings from ${leveldb}. Set FORKNOTE_API_KEY + FORKNOTE_BASE_URL, or create .forknote/live-api.local.json.`,
    );
  }
  return settings;
}

function emptyThread(): ThreadRoot {
  return {
    id: "thread-live",
    messages: [],
    createdAt: Date.now(),
  };
}

function emptySession(thread: ThreadRoot): ChatSession {
  return {
    id: "session-live",
    title: "live-sim",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    thread,
  };
}

async function runRound(opts: {
  label: string;
  userText: string;
  projectRoot: string | null;
  settings: ApiSettings;
  expect: {
    preferTools?: boolean;
    forbidTools?: boolean;
    maxChars?: number;
    mustInclude?: RegExp;
    mustNotInclude?: RegExp;
  };
}) {
  const thread = emptyThread();
  thread.messages.push({
    id: "u1",
    role: "user",
    content: opts.userText,
    children: [],
    createdAt: Date.now(),
  } satisfies ChatMessage);
  const assistantId = "a1";
  thread.messages.push({
    id: assistantId,
    role: "assistant",
    content: "",
    children: [],
    createdAt: Date.now(),
  } satisfies ChatMessage);

  const session = emptySession(thread);
  let finalContent = "";
  const activities: string[] = [];
  const ac = new AbortController();

  const outcome = await runAgentTurn({
    llm: opts.settings,
    settings: opts.settings,
    locale: "zh",
    session,
    userText: opts.userText,
    thread,
    projectRoot: opts.projectRoot,
    sidecarUrl: process.env.SIDECAR_URL?.trim() || "http://127.0.0.1:8787",
    signal: ac.signal,
    isOwned: () => true,
    patchContent: (patch) => {
      if (typeof patch.content === "string") finalContent = patch.content;
      const msg = thread.messages.find((m) => m.id === assistantId);
      if (msg && typeof patch.content === "string") msg.content = patch.content;
      if (msg && typeof patch.reasoning === "string") msg.reasoning = patch.reasoning;
    },
    onAgentActivity: (a) => {
      activities.push(`${a.kind}:${a.message.slice(0, 80)}`);
    },
    onAgentChange: () => {},
    onAwaitPlanApproval: ({ continueExecution }) => {
      void continueExecution();
    },
  });

  const toolsUsed = activities.length > 0;
  const preview = finalContent.replace(/\s+/g, " ").trim().slice(0, 220);
  console.log(
    `\n[${opts.label}] outcome=${outcome} tools=${toolsUsed ? activities.join(" | ") : "none"} chars=${finalContent.length}`,
  );
  console.log(`  Q: ${opts.userText}`);
  console.log(`  A: ${preview}${finalContent.length > 220 ? "…" : ""}`);

  assert.equal(outcome, "completed", `${opts.label}: completed`);
  if (opts.expect.forbidTools) {
    assert.equal(toolsUsed, false, `${opts.label}: expected no tools`);
  }
  if (opts.expect.preferTools) {
    assert.equal(toolsUsed, true, `${opts.label}: expected tools`);
  }
  if (opts.expect.maxChars != null) {
    assert.ok(
      finalContent.length <= opts.expect.maxChars,
      `${opts.label}: too long (${finalContent.length} > ${opts.expect.maxChars})`,
    );
  }
  if (opts.expect.mustInclude) {
    assert.match(finalContent, opts.expect.mustInclude, `${opts.label}: mustInclude`);
  }
  if (opts.expect.mustNotInclude) {
    assert.doesNotMatch(
      finalContent,
      opts.expect.mustNotInclude,
      `${opts.label}: mustNotInclude`,
    );
  }

  return { finalContent, activities, toolsUsed };
}

async function main() {
  const loaded = loadCachedDeepSeekSettings();
  console.log("live-sim settings:", JSON.stringify(redactMeta(loaded)));

  const settings: ApiSettings = {
    baseUrl: loaded.baseUrl,
    apiKey: loaded.apiKey,
    model: loaded.model,
    useProxy: false,
    contextMemoryEnabled: false,
    memoryLayerPreferences: false,
    memoryLayerProject: false,
    memoryLayerSession: false,
    compressAfterArchive: false,
    memoryDir: ".forknote/memory",
    contextWindowTurns: 16,
    contextAutoSummary: false,
    agentMaxRounds: 8,
    agentRequireApproval: false,
    agentAllowTerminal: true,
    agentAutoDiagnostics: false,
    agentPlanModel: "",
    agentCodeModel: "",
    agentSummaryModel: loaded.model,
  };

  const projectRoot =
    process.env.FORKNOTE_LIVE_PROJECT?.trim() ||
    "/Users/debris/cursor/AI-Advanced";

  const sidecarUrl = process.env.SIDECAR_URL?.trim() || "http://127.0.0.1:8787";
  try {
    const bind = await fetch(`${sidecarUrl}/project/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projectRoot }),
    });
    if (!bind.ok) {
      console.warn(`sidecar bind failed: HTTP ${bind.status}`);
    } else {
      console.log(`sidecar bound to ${projectRoot}`);
    }
  } catch (err) {
    console.warn(
      `sidecar unreachable at ${sidecarUrl}:`,
      err instanceof Error ? err.message : err,
    );
  }

  await runRound({
    label: "r1-advice",
    userText: "如果我想成为一个科技博主，我可以做什么事情？请尽量简短回答。",
    projectRoot,
    settings,
    expect: {
      forbidTools: true,
      maxChars: 1800,
      mustNotInclude: /list_dir|write_file|CMake|package\.json/i,
    },
  });

  await runRound({
    label: "r2-eval-project",
    userText: "看看这个项目怎么样？给三点简短建议就行。",
    projectRoot,
    settings,
    expect: {
      // May read a couple files; must not mutate.
      maxChars: 2200,
      mustNotInclude: /write_file|search_replace|已写入/i,
    },
  });

  await runRound({
    label: "r3-list-dir",
    userText: "列出当前目录有哪些文件，只列目录，不要改任何文件。",
    projectRoot,
    settings,
    expect: {
      maxChars: 3500,
      mustNotInclude: /已修改 README|write_file|search_replace/i,
    },
  });

  await runRound({
    label: "r4-sample-code",
    userText: "随便给我写一段 Python 打印 hello 的代码，不要写到磁盘。",
    projectRoot,
    settings,
    expect: {
      forbidTools: true,
      maxChars: 1200,
      mustInclude: /```[\s\S]*print\s*\(/i,
      mustNotInclude: /write_file|list_dir|CMake/i,
    },
  });

  console.log("\nsim-live-agent-rounds: ok");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
