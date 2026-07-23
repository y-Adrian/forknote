import type { ChatMessage } from "./openai";
import {
  listDir,
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
  | "search_files";

export type AgentToolCall = {
  tool: AgentToolName;
  path?: string;
  content?: string;
  query?: string;
};

export type AgentActivity = {
  id: string;
  kind: "list" | "read" | "write" | "search" | "error" | "info";
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
  "search_files",
]);

/** System prompt appendix when a local project is bound. */
export function buildCodingToolsSystem(projectRoot: string): string {
  return `

你已连接到本地项目，可通过工具读写文件。项目根目录：${projectRoot}

工具调用格式（严格）：需要读写文件时，在回复中输出一个或多个 XML 标签，每个标签内为单行 JSON，不要用 Markdown 代码围栏包裹：
<tool_call>{"tool":"list_dir","path":"."}</tool_call>
<tool_call>{"tool":"read_file","path":"package.json"}</tool_call>
<tool_call>{"tool":"write_file","path":"README.md","content":"完整文件内容"}</tool_call>
<tool_call>{"tool":"search_files","query":"export function"}</tool_call>

规则：
1. path 必须是相对项目根的相对路径，禁止 .. 与绝对路径。
2. write_file 的 content 必须是完整文件内容（会覆盖整文件）。
3. 同一轮可发出多个 tool_call；发出工具调用时不要写长篇最终答案，等工具结果返回后再总结。
4. 没有工具结果前，不要声称已修改文件。
5. 完成任务后用中文 Markdown 做简短总结；仍可用【N】分点格式。
6. 仅在确实需要访问项目文件时使用工具。`;
}

const TOOL_CALL_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;

export function parseToolCalls(text: string): AgentToolCall[] {
  const calls: AgentToolCall[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(TOOL_CALL_RE.source, TOOL_CALL_RE.flags);
  while ((m = re.exec(text)) !== null) {
    const raw = m[1]?.trim();
    if (!raw) continue;
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const tool = String(obj.tool ?? obj.name ?? "");
      if (!TOOL_NAMES.has(tool)) continue;
      calls.push({
        tool: tool as AgentToolName,
        path: typeof obj.path === "string" ? obj.path : undefined,
        content: typeof obj.content === "string" ? obj.content : undefined,
        query: typeof obj.query === "string" ? obj.query : undefined,
      });
    } catch {
      // skip malformed
    }
  }
  return calls;
}

/** Remove tool_call tags (and leftover fences) for user-visible assistant text. */
export function stripToolCalls(text: string): string {
  return text
    .replace(TOOL_CALL_RE, "")
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
): Promise<{
  ok: boolean;
  resultText: string;
  activity: Omit<AgentActivity, "id" | "at">;
  change?: Omit<AgentFileChange, "at">;
}> {
  try {
    switch (call.tool) {
      case "list_dir": {
        const path = call.path?.trim() || ".";
        const { entries } = await listDir(path, sidecarUrl);
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
        const path = call.path?.trim();
        if (!path) {
          return {
            ok: false,
            resultText: "Error: path is required",
            activity: { kind: "error", message: "read_file missing path" },
          };
        }
        const { content, size } = await readFile(path, sidecarUrl);
        return {
          ok: true,
          resultText: content,
          activity: {
            kind: "read",
            message: `Reading ${path} (${size} bytes)`,
          },
        };
      }
      case "write_file": {
        const path = call.path?.trim();
        if (!path) {
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
        const { size } = await writeFile(path, call.content, sidecarUrl);
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
          call.path?.trim() || ".",
          sidecarUrl,
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
