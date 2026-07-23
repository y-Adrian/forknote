import type { ChatMessage, OpenAITool, ToolCall } from "./openai";
import {
  listDir,
  mkdir as sidecarMkdir,
  readFile,
  searchFiles,
  writeFile,
  type SearchHit,
} from "./sidecar";

export const MAX_AGENT_ROUNDS = 8;

export type AgentToolName =
  | "list_dir"
  | "read_file"
  | "write_file"
  | "mkdir"
  | "search_files";

export type AgentToolCall = {
  tool: AgentToolName;
  path?: string;
  content?: string;
  query?: string;
};

export type AgentActivity = {
  id: string;
  kind: "list" | "read" | "write" | "mkdir" | "search" | "error" | "info";
  message: string;
  at: number;
};

export type AgentFileChange = {
  path: string;
  size: number;
  at: number;
};

const TOOL_NAMES = new Set<string>([
  "list_dir",
  "read_file",
  "write_file",
  "mkdir",
  "search_files",
]);

/** Native OpenAI-compatible tools — same mechanism Cursor uses with the model API. */
export const PROJECT_OPENAI_TOOLS: OpenAITool[] = [
  {
    type: "function",
    function: {
      name: "list_dir",
      description:
        "List files and subdirectories under a path relative to the project root.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: 'Relative directory path. Use "." for project root.',
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a UTF-8 text file relative to the project root.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative file path, e.g. src/main.c or soft/hello.c",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mkdir",
      description:
        "Create a directory (and parents) relative to the project root.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative directory path, e.g. soft or src/demo",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Create or overwrite a UTF-8 file. Parent directories are created automatically. content must be the FULL file body.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative file path, e.g. soft/hello.c",
          },
          content: {
            type: "string",
            description: "Full file contents to write (overwrites existing).",
          },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search file contents under the project for a text query.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Substring to search for" },
          path: {
            type: "string",
            description: 'Subdirectory to search, default "."',
          },
        },
        required: ["query"],
      },
    },
  },
];

/** System prompt appendix when a local project is bound. */
export function buildCodingToolsSystem(projectRoot: string): string {
  return `

你已连接到本地项目：${projectRoot}

你有原生函数工具：list_dir、read_file、mkdir、write_file、search_files。
创建或修改文件时必须调用 write_file（或先 mkdir 再 write_file）。
只把代码写在 Markdown 里不会写入磁盘。
路径一律用相对项目根的相对路径（如 soft/hello.c 或 array_and_subarrays.cpp），不要用 /Users/... 这类绝对路径。
write_file 的 content 必须是完整文件内容。`;
}

export function agentCallFromOpenAI(tc: ToolCall): AgentToolCall | null {
  const name = tc.function.name?.trim();
  if (!name || !TOOL_NAMES.has(name)) return null;

  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
  } catch {
    const pathMatch = tc.function.arguments.match(
      /"path"\s*:\s*"((?:\\.|[^"\\])*)"/,
    );
    const contentKey = /"content"\s*:\s*"/.exec(tc.function.arguments);
    if (pathMatch) {
      args.path = pathMatch[1]
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }
    if (contentKey && contentKey.index !== undefined) {
      const start = contentKey.index + contentKey[0].length;
      const tail = tc.function.arguments.slice(start);
      const end = tail.search(/"\s*\}\s*$/);
      const raw = end >= 0 ? tail.slice(0, end) : tail;
      args.content = raw
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }
  }

  return {
    tool: name as AgentToolName,
    path: typeof args.path === "string" ? args.path : undefined,
    content: typeof args.content === "string" ? args.content : undefined,
    query: typeof args.query === "string" ? args.query : undefined,
  };
}

const TOOL_CALL_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
const TOOL_CONTENT_RE =
  /<tool_content(?:\s+path="([^"]*)")?\s*>\s*([\s\S]*?)\s*<\/tool_content>/gi;

/** Models often emit `/src/foo` or absolute paths under the project — normalize to relative. */
export function normalizeRelPath(
  input: string,
  projectRoot?: string | null,
): string {
  let s = input.trim().replace(/\\/g, "/");
  if (!s || s === ".") return s || ".";

  if (/^[a-zA-Z]:\//.test(s)) {
    if (projectRoot) {
      const root = projectRoot.replace(/\\/g, "/").replace(/\/$/, "");
      if (s.toLowerCase().startsWith(root.toLowerCase() + "/")) {
        return s.slice(root.length + 1) || ".";
      }
      if (s.toLowerCase() === root.toLowerCase()) return ".";
    }
    return s;
  }

  while (s.startsWith("./")) s = s.slice(2);

  if (projectRoot) {
    const root = projectRoot.replace(/\\/g, "/").replace(/\/$/, "");
    if (s === root) return ".";
    if (s.startsWith(root + "/")) {
      s = s.slice(root.length + 1);
    }
  }

  // "//foo.c" or "///src/a.cpp" — model typos, not UNC shares
  if (/^\/\/+/.test(s) && !/^\/\/[^/]+\/[^/]/.test(s)) {
    s = s.replace(/^\/+/, "");
  }

  if (s.startsWith("/") && !s.startsWith("//")) {
    if (/^\/(?:Users|home|private|var|tmp|etc|Volumes)\b/i.test(s)) {
      const base = s.split("/").filter(Boolean).pop();
      if (base && /\.\w{1,16}$/.test(base)) return base;
    }
    // "/file.cpp" or "/src/foo" → project-relative
    s = s.replace(/^\/+/, "");
  }

  return s || ".";
}

function unescapeJsonString(raw: string): string {
  return raw
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function parseWriteFileLoose(raw: string): AgentToolCall | null {
  if (!/"tool"\s*:\s*"write_file"/.test(raw) && !/\bwrite_file\b/.test(raw)) {
    return null;
  }
  const pathMatch = raw.match(/"path"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (!pathMatch) return null;
  const path = unescapeJsonString(pathMatch[1]);

  const contentKey = /"content"\s*:\s*"/.exec(raw);
  if (!contentKey || contentKey.index === undefined) {
    return { tool: "write_file", path };
  }
  const start = contentKey.index + contentKey[0].length;
  const tail = raw.slice(start);
  const end = tail.search(/"\s*\}\s*$/);
  if (end < 0) {
    return { tool: "write_file", path, content: unescapeJsonString(tail) };
  }
  return {
    tool: "write_file",
    path,
    content: unescapeJsonString(tail.slice(0, end)),
  };
}

function parseOneToolCall(raw: string): AgentToolCall | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const tool = String(obj.tool ?? obj.name ?? "");
    if (!TOOL_NAMES.has(tool)) return null;
    return {
      tool: tool as AgentToolName,
      path: typeof obj.path === "string" ? obj.path : undefined,
      content: typeof obj.content === "string" ? obj.content : undefined,
      query: typeof obj.query === "string" ? obj.query : undefined,
    };
  } catch {
    return parseWriteFileLoose(raw);
  }
}

export function parseToolCalls(text: string): AgentToolCall[] {
  const contents: { path?: string; body: string }[] = [];
  let cm: RegExpExecArray | null;
  const contentRe = new RegExp(TOOL_CONTENT_RE.source, TOOL_CONTENT_RE.flags);
  while ((cm = contentRe.exec(text)) !== null) {
    contents.push({
      path: cm[1]?.trim() || undefined,
      body: cm[2] ?? "",
    });
  }

  const calls: AgentToolCall[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(TOOL_CALL_RE.source, TOOL_CALL_RE.flags);
  let contentIdx = 0;

  while ((m = re.exec(text)) !== null) {
    const raw = m[1]?.trim();
    if (!raw) continue;
    const call = parseOneToolCall(raw);
    if (!call) continue;

    if (call.tool === "write_file" && typeof call.content !== "string") {
      const byPath = call.path
        ? contents.find(
            (c) =>
              c.path &&
              normalizeRelPath(c.path) === normalizeRelPath(call.path!),
          )
        : undefined;
      const next = byPath ?? contents[contentIdx];
      if (next) {
        call.content = next.body;
        if (byPath) {
          const i = contents.indexOf(byPath);
          if (i >= 0) contents.splice(i, 1);
        } else {
          contentIdx += 1;
        }
      }
    }

    if (call.path) call.path = normalizeRelPath(call.path);
    calls.push(call);
  }

  for (const c of contents) {
    if (!c.path || !c.body.trim()) continue;
    const path = normalizeRelPath(c.path);
    if (calls.some((x) => x.tool === "write_file" && x.path === path)) continue;
    calls.push({ tool: "write_file", path, content: c.body });
  }

  return calls;
}

export function extractWriteIntentsFromMarkdown(text: string): AgentToolCall[] {
  const calls: AgentToolCall[] = [];
  const seen = new Set<string>();

  const push = (pathRaw: string, content: string) => {
    const path = normalizeRelPath(
      pathRaw.replace(/^[`"'[{<]+|[`"'\]}>]+$/g, ""),
    );
    if (!path || path === "." || !content.trim()) return;
    if (!/[./]/.test(path) && !/\.\w+$/.test(path)) return;
    if (seen.has(path)) return;
    seen.add(path);
    calls.push({ tool: "write_file", path, content });
  };

  const fenceWithPath =
    /```[\w+-]*(?:[ \t]+|:|=)([^\n`]+)\n([\s\S]*?)```/g;
  let fm: RegExpExecArray | null;
  while ((fm = fenceWithPath.exec(text)) !== null) {
    const info = fm[1]
      .trim()
      .replace(/^path\s*=\s*/i, "")
      .replace(/^file\s*=\s*/i, "");
    if (!/[./\\]/.test(info) && !/\.\w{1,8}$/.test(info)) continue;
    push(info.split(/\s+/)[0]!, fm[2] ?? "");
  }

  const headerFence =
    /(?:^|\n)(?:File|文件|路径|Path)\s*[:：]\s*([^\n]+)\n\s*```[\w+-]*\n([\s\S]*?)```/gi;
  while ((fm = headerFence.exec(text)) !== null) {
    push(fm[1].trim(), fm[2] ?? "");
  }

  const hashFence =
    /(?:^|\n)#{1,6}\s+([^\n]+?\.\w{1,8})\s*\n\s*```[\w+-]*\n([\s\S]*?)```/g;
  while ((fm = hashFence.exec(text)) !== null) {
    push(fm[1].trim(), fm[2] ?? "");
  }

  return calls;
}

export function collectToolCalls(text: string): AgentToolCall[] {
  const explicit = parseToolCalls(text);
  if (explicit.length > 0) return explicit;
  return extractWriteIntentsFromMarkdown(text);
}

const CREATE_FILE_EXT =
  String.raw`cpp|cc|cxx|c|h|hpp|hxx|py|ts|tsx|js|jsx|mjs|cjs|go|rs|java|kt|swift|md|txt|json|toml|ya?ml|css|scss|html|sh|bash|cmake|txt|sql|rs|vue|svelte`;

/**
 * Detect "帮我生成一个文件 foo.cpp" style intents.
 * Returns a project-relative path (often just the filename at repo root).
 */
export function inferCreateFilePath(userText: string): string | null {
  const t = userText.trim();
  if (!t) return null;

  const tick = t.match(
    new RegExp(String.raw`\`([\w./\\-]+\.(?:${CREATE_FILE_EXT}))\``, "i"),
  );
  if (tick?.[1]) return normalizeRelPath(tick[1]);

  const quoted = t.match(
    new RegExp(
      String.raw`["'“”‘’]([\w./\\-]+\.(?:${CREATE_FILE_EXT}))["'“”‘’]`,
      "i",
    ),
  );
  if (quoted?.[1]) return normalizeRelPath(quoted[1]);

  const createVerb =
    /(?:生成|创建|写|新增|添加|建立|输出|保存|帮我写|帮我生成|帮我创建|create|generate|write|add|make)\s*/i.test(
      t,
    ) || /文件/.test(t);

  const named = t.match(
    new RegExp(
      String.raw`(?:生成|创建|写(?:一个|个)?|新增|添加|建立|输出|保存)?(?:一个|个)?(?:文件|源文件|代码文件)?\s*[：:\s]*([\w./\\-]+\.(?:${CREATE_FILE_EXT}))`,
      "i",
    ),
  );
  if (named?.[1] && createVerb) return normalizeRelPath(named[1]);

  const en = t.match(
    new RegExp(
      String.raw`(?:create|generate|write|add|make)\s+(?:a\s+)?(?:new\s+)?(?:file\s+)?["']?([\w./\\-]+\.(?:${CREATE_FILE_EXT}))`,
      "i",
    ),
  );
  if (en?.[1]) return normalizeRelPath(en[1]);

  // "帮我生成 array_and_subarrays.cpp" without the word 文件
  if (createVerb) {
    const bare = t.match(
      new RegExp(String.raw`\b([\w./\\-]+\.(?:${CREATE_FILE_EXT}))\b`, "i"),
    );
    if (bare?.[1]) return normalizeRelPath(bare[1]);
  }

  return null;
}

/** Largest fenced code block in assistant text (for create-file fallback). */
export function extractBestCodeFence(text: string): string | null {
  const re = /```[\w+-]*[^\n]*\n([\s\S]*?)```/g;
  let best: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const body = (m[1] ?? "").replace(/\n$/, "");
    if (!body.trim()) continue;
    if (!best || body.length > best.length) best = body;
  }
  return best;
}

/**
 * If the user asked to create a specific file and the model only pasted code,
 * synthesize a write_file call.
 */
export function synthesizeWriteFromReply(
  userText: string,
  assistantText: string,
): AgentToolCall | null {
  const path = inferCreateFilePath(userText);
  if (!path) return null;
  const content = extractBestCodeFence(assistantText);
  if (!content?.trim()) return null;
  return { tool: "write_file", path, content };
}

export function stripToolCalls(text: string): string {
  return text
    .replace(TOOL_CALL_RE, "")
    .replace(TOOL_CONTENT_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatHits(hits: SearchHit[]): string {
  if (hits.length === 0) return "(no matches)";
  return hits
    .map((h) => `${h.path}:${h.line}: ${h.text}`)
    .join("\n");
}

export async function executeToolCall(
  call: AgentToolCall,
  sidecarUrl: string,
  signal?: AbortSignal,
  projectRoot?: string | null,
): Promise<{
  ok: boolean;
  resultText: string;
  activity: Omit<AgentActivity, "id" | "at">;
  change?: Omit<AgentFileChange, "at">;
}> {
  try {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    switch (call.tool) {
      case "list_dir": {
        const path = normalizeRelPath(call.path?.trim() || ".", projectRoot);
        const { entries } = await listDir(path, sidecarUrl, signal);
        const lines = entries.map(
          (e) => `${e.type === "dir" ? "dir " : "file"} ${e.path}`,
        );
        return {
          ok: true,
          resultText: lines.join("\n") || "(empty)",
          activity: { kind: "list", message: `Listed ${path}` },
        };
      }
      case "read_file": {
        const path = normalizeRelPath(call.path?.trim() || "", projectRoot);
        if (!path || path === ".") {
          return {
            ok: false,
            resultText: "Error: path is required",
            activity: { kind: "error", message: "read_file missing path" },
          };
        }
        const { content, size } = await readFile(path, sidecarUrl, signal);
        return {
          ok: true,
          resultText: content,
          activity: {
            kind: "read",
            message: `Reading ${path} (${size} bytes)`,
          },
        };
      }
      case "mkdir": {
        const path = normalizeRelPath(call.path?.trim() || "", projectRoot);
        if (!path || path === ".") {
          return {
            ok: false,
            resultText: "Error: path is required",
            activity: { kind: "error", message: "mkdir missing path" },
          };
        }
        await sidecarMkdir(path, sidecarUrl, signal);
        return {
          ok: true,
          resultText: `Created directory ${path}`,
          activity: { kind: "mkdir", message: `mkdir ${path}` },
        };
      }
      case "write_file": {
        const path = normalizeRelPath(call.path?.trim() || "", projectRoot);
        if (!path || path === ".") {
          return {
            ok: false,
            resultText: "Error: path is required",
            activity: { kind: "error", message: "write_file missing path" },
          };
        }
        if (typeof call.content !== "string") {
          return {
            ok: false,
            resultText: "Error: content is required",
            activity: { kind: "error", message: "write_file missing content" },
          };
        }
        const { size } = await writeFile(path, call.content, sidecarUrl, signal);
        return {
          ok: true,
          resultText: `Wrote ${path} (${size} bytes)`,
          activity: { kind: "write", message: `Wrote ${path}` },
          change: { path, size },
        };
      }
      case "search_files": {
        const query = call.query?.trim();
        if (!query) {
          return {
            ok: false,
            resultText: "Error: query is required",
            activity: { kind: "error", message: "search_files missing query" },
          };
        }
        const { hits, truncated } = await searchFiles(
          query,
          normalizeRelPath(call.path?.trim() || ".", projectRoot),
          sidecarUrl,
          signal,
        );
        return {
          ok: true,
          resultText:
            formatHits(hits) + (truncated ? "\n…(truncated)" : ""),
          activity: {
            kind: "search",
            message: `Search “${query}” → ${hits.length} hit(s)`,
          },
        };
      }
      default:
        return {
          ok: false,
          resultText: `Unknown tool: ${(call as AgentToolCall).tool}`,
          activity: { kind: "error", message: "Unknown tool" },
        };
    }
  } catch (e) {
    if (
      (e instanceof Error && e.name === "AbortError") ||
      (typeof DOMException !== "undefined" &&
        e instanceof DOMException &&
        e.name === "AbortError")
    ) {
      throw e;
    }
    const msg = e instanceof Error ? e.message : "Tool failed";
    return {
      ok: false,
      resultText: `Error: ${msg}`,
      activity: { kind: "error", message: msg },
    };
  }
}

export function toolResultMessage(
  call: AgentToolCall,
  resultText: string,
): ChatMessage {
  const label =
    call.tool === "search_files"
      ? `search_files query=${JSON.stringify(call.query ?? "")}`
      : `${call.tool} path=${JSON.stringify(call.path ?? ".")}`;
  const truncated =
    resultText.length > 120_000
      ? `${resultText.slice(0, 120_000)}\n…(truncated)`
      : resultText;
  return {
    role: "user",
    content: `【工具结果：${label}】\n${truncated}\n\n若任务未完成请继续调用工具；若已完成请给出最终中文总结（不要再输出 tool_call）。`,
  };
}

export function nativeToolResultMessage(
  toolCallId: string,
  name: string,
  resultText: string,
): ChatMessage {
  const truncated =
    resultText.length > 120_000
      ? `${resultText.slice(0, 120_000)}\n…(truncated)`
      : resultText;
  return {
    role: "tool",
    tool_call_id: toolCallId,
    name,
    content: truncated,
  };
}
