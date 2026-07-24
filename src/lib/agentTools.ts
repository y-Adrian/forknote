import type { Locale } from "./i18n";
import type { ChatMessage, OpenAITool, ToolCall } from "./openai";
import {
  applyPatch,
  listDir,
  mkdir as sidecarMkdir,
  readFile,
  searchFiles,
  searchReplace,
  writeDocx,
  writeFile,
  writeXlsx,
  type SearchHit,
} from "./sidecar";

/** Default max tool loop rounds per main chat turn (project bound). */
export const DEFAULT_AGENT_MAX_ROUNDS = 20;

export const MIN_AGENT_MAX_ROUNDS = 1;
export const MAX_AGENT_MAX_ROUNDS = 64;

/** @deprecated use DEFAULT_AGENT_MAX_ROUNDS / resolveAgentMaxRounds */
export const MAX_AGENT_ROUNDS = DEFAULT_AGENT_MAX_ROUNDS;

export type AgentToolName =
  | "list_dir"
  | "read_file"
  | "write_file"
  | "search_replace"
  | "apply_patch"
  | "write_docx"
  | "write_xlsx"
  | "mkdir"
  | "search_files";

export type SpreadsheetCell = string | number | boolean | null;

export type TextEdit = {
  old_string: string;
  new_string: string;
  replace_all?: boolean;
};

export type AgentToolCall = {
  tool: AgentToolName;
  path?: string;
  content?: string;
  query?: string;
  title?: string;
  paragraphs?: string[];
  sheet_name?: string;
  rows?: SpreadsheetCell[][];
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
  edits?: TextEdit[];
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
  "search_replace",
  "apply_patch",
  "write_docx",
  "write_xlsx",
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
        "List files and subdirectories under a path relative to the project root. Use path=\".\" for the project root / current project folder. Call this before guessing what files exist.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              'Relative directory path. Use "." for project root (default if omitted).',
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read a UTF-8 text file relative to the project root. Use after list_dir when you need file contents.",
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
        "Create or overwrite a UTF-8 text file (source, markdown, csv, json, etc.). Parent directories are created automatically. content must be the FULL file body. Prefer search_replace / apply_patch for small edits to existing files. Do NOT use this for .docx/.xlsx.",
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
      name: "search_replace",
      description:
        "Edit an existing UTF-8 text file by replacing an exact old_string with new_string (mainstream agent-style patch). old_string must match uniquely unless replace_all=true. Prefer this over write_file for small changes.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative file path to edit",
          },
          old_string: {
            type: "string",
            description:
              "Exact text to find (copy from read_file; include enough context to be unique).",
          },
          new_string: {
            type: "string",
            description: "Replacement text (may be empty to delete).",
          },
          replace_all: {
            type: "boolean",
            description:
              "If true, replace every occurrence. Default false (require unique match).",
          },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_patch",
      description:
        "Apply several exact search/replace edits to one existing UTF-8 file in order. Use when multiple related changes are needed in the same file.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative file path to edit",
          },
          edits: {
            type: "array",
            items: {
              type: "object",
              properties: {
                old_string: { type: "string" },
                new_string: { type: "string" },
                replace_all: { type: "boolean" },
              },
              required: ["old_string", "new_string"],
            },
            description: "Ordered list of exact replacements",
          },
        },
        required: ["path", "edits"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_docx",
      description:
        "Create a Microsoft Word .docx file from a title and/or paragraphs. Generates a real Office document (not plain text). Path should end with .docx (added if missing).",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative path, e.g. docs/notes.docx",
          },
          title: {
            type: "string",
            description: "Optional document title (heading).",
          },
          paragraphs: {
            type: "array",
            items: { type: "string" },
            description:
              "Body paragraphs in order. Use [\"\"] or [] for an empty document.",
          },
        },
        required: ["path", "paragraphs"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_xlsx",
      description:
        "Create a Microsoft Excel .xlsx workbook from a 2D rows array (first row often headers). Generates a real spreadsheet. Path should end with .xlsx (added if missing).",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative path, e.g. data/report.xlsx",
          },
          sheet_name: {
            type: "string",
            description: 'Worksheet name, default "Sheet1".',
          },
          rows: {
            type: "array",
            items: {
              type: "array",
              items: {
                type: ["string", "number", "boolean", "null"],
              },
            },
            description:
              "Rows of cells. Example: [[\"Name\",\"Score\"],[\"Ada\",95]]",
          },
        },
        required: ["path", "rows"],
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

/** Planning-only system addendum — no tools until the user approves. */
export function buildPlanningPhaseSystem(locale: Locale): string {
  if (locale === "zh") {
    return `
【计划阶段】用户已连接本地项目。此轮禁止调用任何工具，禁止声称已读写文件。

原则（必须遵守）：
- 严格依据用户原话理解意图。
- 意图不清时：只输出简短澄清问题，并可给出编号选项供用户选择；不要写「执行计划」，不要编造文件操作，不要提「批准并执行」。
- 意图明确且需要改磁盘时：再输出精简计划；只包含必要步骤，禁止自行添加验证步骤（如写完再 list_dir）。
- 意图明确但无需工具时：直接回答，并写明「无需工具」。

当需要计划时，使用以下结构：
## 计划
1. 第一步…

## 预期操作（可选）
- 仅列出真正需要的工具；无操作则写「无」`;
  }
  return `
[Planning phase] A local project is connected. Do not call tools or claim files were read/written.

Rules (must follow):
- Ground everything in the user's words.
- If intent is unclear: ask a short clarifying question and/or numbered options only. Do NOT write an execution plan, invent file ops, or mention Approve & run.
- If intent is clear and needs disk changes: output a minimal plan with only necessary steps (no invented verification like list_dir after write).
- If intent is clear but no tools are needed: answer directly and say no tools are required.

When a plan is needed, use:
## Plan
1. First step…

## Expected operations (optional)
- Only required tools; write "none" if no tools`;
}

const TOOL_MENTION_RE =
  /\b(write_file|list_dir|read_file|search_replace|apply_patch|write_docx|write_xlsx|mkdir|search_files)\b/i;

/**
 * True when the planning reply should show Approve & run.
 * Clarifications / no-tools answers stay in chat only.
 */
export function planNeedsToolApproval(
  planText: string,
  steps: string[],
): boolean {
  const text = planText.trim();
  if (!text) return false;

  const lowered = text.toLowerCase();
  if (
    /无需工具|不需要工具|不要调用工具|无需调用|no tools(?:\s+needed|\s+required)?|tools?:\s*none|预期操作[：:]\s*无/.test(
      lowered,
    )
  ) {
    return false;
  }
  if (
    /意图不清|意图不明确|intent unclear|unclear intent|would you like|do you want|请告诉我|请选择|你想/.test(
      lowered,
    ) &&
    !TOOL_MENTION_RE.test(text)
  ) {
    return false;
  }

  if (TOOL_MENTION_RE.test(text)) return true;
  if (steps.some((s) => TOOL_MENTION_RE.test(s))) return true;

  const questionLike =
    /[?？]/.test(text) ||
    (steps.length > 0 &&
      steps.every((s) =>
        /[?？]|还是|或者|\bor\b|something else|其他/i.test(s),
      ));
  if (questionLike && !TOOL_MENTION_RE.test(text)) return false;

  if (
    steps.length > 0 &&
    steps.some((s) =>
      /创建|写入|修改|删除|列出|阅读|搜索|create|write|edit|delete|list|read|search/i.test(
        s,
      ),
    ) &&
    !questionLike
  ) {
    return true;
  }

  return false;
}

export function parseAgentPlan(text: string): {
  planText: string;
  steps: string[];
} {
  const planText = stripToolCalls(text).trim();
  const steps: string[] = [];
  const re = /^\s*(?:\d+[.)]|[-*•])\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(planText)) !== null) {
    const step = m[1]?.trim();
    if (step) steps.push(step);
  }
  return { planText, steps };
}

export function isWriteTool(tool: AgentToolName): boolean {
  return (
    tool === "write_file" ||
    tool === "search_replace" ||
    tool === "apply_patch" ||
    tool === "write_docx" ||
    tool === "write_xlsx" ||
    tool === "mkdir"
  );
}

export function batchNeedsWriteApproval(calls: AgentToolCall[]): boolean {
  return calls.some((c) => isWriteTool(c.tool));
}

/** System prompt appendix when a local project is bound. */
export function buildCodingToolsSystem(projectRoot: string): string {
  return `

你已连接到本地项目：${projectRoot}

你有原生函数工具：list_dir、read_file、mkdir、write_file、search_replace、apply_patch、write_docx、write_xlsx、search_files。

查看项目（必须用工具，不要凭空猜目录内容）：
- 列出目录 → list_dir（项目根用 path="."；子目录如 "src"）
- 阅读文件 → read_file（先 list_dir 再读具体路径）
- 全文搜索 → search_files

写入：
- 新建纯文本 → write_file
- 修改已有文本 → 优先 search_replace / apply_patch（先 read_file）
- Word → write_docx；Excel → write_xlsx

只把内容写在 Markdown 里不会写入磁盘。
路径一律用相对项目根的相对路径，不要用 /Users/... 这类绝对路径。
write_file 的 content 必须是完整文件内容；search_replace 的 old_string 必须与文件中原文完全一致。

多轮工作流（一次用户消息内可循环多轮）：
1. 依据用户明确意图决定是否需要工具；意图不清则先回答/澄清，不要擅自改文件或列目录
2. 需要工具时 → 只调用完成该意图所必需的工具（不要先写长计划代替执行）
3. 阅读 tool / 工具结果；若用户任务尚未完成 → 再调下一批必要工具
4. 全部做完 → 最后一轮用中文总结，不要再调工具
5. 禁止自行添加用户未要求的验证步骤（如写完再 list_dir、无必要的反复 read）`;
}

/** Extra planning hint when the user clearly asked to create one file. */
export function buildMinimalCreatePlanHint(
  createPath: string,
  locale: Locale,
): string {
  if (locale === "zh") {
    return `用户明确要求创建文件 "${createPath}"。计划中只需 write_file（path="${createPath}"）；不要添加 list_dir、read_file 或其他验证步骤。`;
  }
  return `The user clearly asked to create "${createPath}". The plan should only need write_file (path="${createPath}"); do not add list_dir, read_file, or other verification steps.`;
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
    title: typeof args.title === "string" ? args.title : undefined,
    sheet_name:
      typeof args.sheet_name === "string" ? args.sheet_name : undefined,
    paragraphs: Array.isArray(args.paragraphs)
      ? args.paragraphs.map((p) => String(p ?? ""))
      : undefined,
    rows: Array.isArray(args.rows)
      ? (args.rows as SpreadsheetCell[][]).map((row) =>
          Array.isArray(row)
            ? row.map((cell) => {
                if (
                  cell === null ||
                  typeof cell === "string" ||
                  typeof cell === "number" ||
                  typeof cell === "boolean"
                ) {
                  return cell;
                }
                return String(cell);
              })
            : [],
        )
      : undefined,
    old_string:
      typeof args.old_string === "string" ? args.old_string : undefined,
    new_string:
      typeof args.new_string === "string" ? args.new_string : undefined,
    replace_all:
      typeof args.replace_all === "boolean" ? args.replace_all : undefined,
    edits: Array.isArray(args.edits)
      ? args.edits
          .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
          .map((e) => ({
            old_string: String(e.old_string ?? ""),
            new_string: String(e.new_string ?? ""),
            replace_all:
              typeof e.replace_all === "boolean" ? e.replace_all : undefined,
          }))
      : undefined,
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

export function collectToolCalls(
  text: string,
  userText = "",
  reasoning = "",
): AgentToolCall[] {
  const assistantCtx = reasoning.trim()
    ? `${text}\n${reasoning}`
    : text;
  const explicit = parseToolCalls(text);
  if (explicit.length > 0) return explicit;
  const jsonStyle = parseJsonStyleToolCalls(text);
  if (jsonStyle.length > 0) return jsonStyle;
  const argsOnly = parseArgsOnlyToolCalls(text, userText, assistantCtx);
  if (argsOnly.length > 0) return argsOnly;
  return extractWriteIntentsFromMarkdown(text);
}

/**
 * Models (esp. local) often paste OpenAI-style tool JSON in Markdown instead of
 * emitting native tool_calls, e.g.
 * ```json
 * {"name":"write_xlsx","arguments":{"path":"a.xlsx","rows":[...]}}
 * ```
 */
export function parseJsonStyleToolCalls(text: string): AgentToolCall[] {
  const calls: AgentToolCall[] = [];
  const seen = new Set<string>();

  const pushFromObject = (obj: unknown) => {
    const call = agentToolCallFromUnknown(obj);
    if (!call) return;
    const key = `${call.tool}:${call.path ?? ""}:${JSON.stringify(call.rows ?? call.paragraphs ?? call.content ?? "")}`;
    if (seen.has(key)) return;
    seen.add(key);
    calls.push(call);
  };

  // Fenced json / text blocks
  const fenceRe = /```(?:json|javascript|js|txt)?\s*\n?([\s\S]*?)```/gi;
  let fm: RegExpExecArray | null;
  while ((fm = fenceRe.exec(text)) !== null) {
    const body = (fm[1] ?? "").trim();
    if (!body) continue;
    tryParseJsonBlob(body, pushFromObject);
  }

  // Bare object(s) mentioning a known tool name
  if (calls.length === 0) {
    tryParseJsonBlob(text, pushFromObject);
  }

  return calls;
}

function tryParseJsonBlob(
  raw: string,
  onObj: (obj: unknown) => void,
): void {
  const trimmed = raw.trim();
  if (!trimmed.includes("{")) return;

  // Whole string
  try {
    onObj(JSON.parse(trimmed));
    return;
  } catch {
    // continue
  }

  // Extract balanced {...} slices that look like tool calls
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] !== "{") continue;
    const slice = extractBalancedJsonObject(trimmed, i);
    if (!slice) continue;
    try {
      const obj = JSON.parse(slice);
      if (looksLikeToolObject(obj)) onObj(obj);
    } catch {
      // ignore
    }
  }
}

function extractBalancedJsonObject(s: string, start: number): string | null {
  if (s[start] !== "{") return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i]!;
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (ch === "\\") {
        esc = true;
      } else if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** JSON blob with path/query/old_string but no tool name — models often paste these in Markdown. */
function looksLikeToolArgsObject(obj: unknown): boolean {
  if (!obj || typeof obj !== "object" || looksLikeToolObject(obj)) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.path === "string" ||
    typeof o.query === "string" ||
    typeof o.old_string === "string" ||
    typeof o.content === "string" ||
    Array.isArray(o.paragraphs) ||
    Array.isArray(o.rows)
  );
}

function inferToolFromPartialObject(
  obj: Record<string, unknown>,
  userText: string,
  assistantText: string,
): AgentToolName | null {
  const path = typeof obj.path === "string" ? obj.path.trim() : undefined;
  const query = typeof obj.query === "string" ? obj.query.trim() : undefined;
  const ctx = `${userText}\n${assistantText}`;

  if (/list_dir\b/i.test(assistantText) && path !== undefined) return "list_dir";
  if (/read_file\b/i.test(assistantText) && path) return "read_file";
  if (/write_docx\b/i.test(assistantText) && path) return "write_docx";
  if (/write_xlsx\b/i.test(assistantText) && path) return "write_xlsx";
  if (/search_files\b/i.test(assistantText) && query) return "search_files";
  if (/search_replace\b/i.test(assistantText) && path) return "search_replace";
  if (/apply_patch\b/i.test(assistantText) && path) return "apply_patch";
  if (/write_file\b/i.test(assistantText) && path) return "write_file";
  if (/mkdir\b/i.test(assistantText) && path) return "mkdir";

  if (query && /搜索|search/i.test(ctx)) return "search_files";
  if (typeof obj.old_string === "string") return "search_replace";
  if (Array.isArray(obj.paragraphs)) return "write_docx";
  if (Array.isArray(obj.rows)) return "write_xlsx";
  if (typeof obj.content === "string" && path) return "write_file";

  if (path !== undefined) {
    if (
      path === "." ||
      path === "./" ||
      (!/\.\w+$/.test(path) &&
        /列出|目录|文件夹|list\s|list_dir|\bls\b/i.test(ctx))
    ) {
      return "list_dir";
    }
    if (/\.\w+$/.test(path) && /读|读取|read_file|\bread\b/i.test(ctx)) {
      return "read_file";
    }
    if (/\.\w+$/.test(path)) return "read_file";
    return "list_dir";
  }

  return null;
}

function agentCallFromPartialObject(
  obj: Record<string, unknown>,
  userText: string,
  assistantText: string,
): AgentToolCall | null {
  const tool = inferToolFromPartialObject(obj, userText, assistantText);
  if (!tool) return null;

  const call: AgentToolCall = { tool };
  if (typeof obj.path === "string") call.path = normalizeRelPath(obj.path);
  if (typeof obj.query === "string") call.query = obj.query.trim();
  if (typeof obj.title === "string") call.title = obj.title;
  if (typeof obj.content === "string") call.content = obj.content;
  if (typeof obj.old_string === "string") call.old_string = obj.old_string;
  if (typeof obj.new_string === "string") call.new_string = obj.new_string;
  if (typeof obj.replace_all === "boolean") call.replace_all = obj.replace_all;
  if (Array.isArray(obj.paragraphs)) {
    call.paragraphs = obj.paragraphs.map((p) => String(p ?? ""));
  }
  if (Array.isArray(obj.rows)) {
    call.rows = obj.rows as AgentToolCall["rows"];
  }
  if (Array.isArray(obj.edits)) {
    call.edits = obj.edits as TextEdit[];
  }
  if (typeof obj.sheet_name === "string") call.sheet_name = obj.sheet_name;
  return call;
}

/** Parse ```json {"path":"."}``` blobs that omit tool/name (some models). */
export function parseArgsOnlyToolCalls(
  text: string,
  userText: string,
  assistantText: string,
): AgentToolCall[] {
  const calls: AgentToolCall[] = [];
  const seen = new Set<string>();

  const pushObj = (obj: unknown) => {
    if (!obj || typeof obj !== "object" || !looksLikeToolArgsObject(obj)) return;
    const call = agentCallFromPartialObject(
      obj as Record<string, unknown>,
      userText,
      assistantText,
    );
    if (!call) return;
    const key = `${call.tool}:${call.path ?? ""}:${call.query ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    calls.push(call);
  };

  const fenceRe = /```(?:json|javascript|js|txt)?\s*\n?([\s\S]*?)```/gi;
  let fm: RegExpExecArray | null;
  while ((fm = fenceRe.exec(text)) !== null) {
    const body = (fm[1] ?? "").trim();
    if (!body) continue;
    tryParseJsonBlob(body, (obj) => {
      if (looksLikeToolObject(obj)) return;
      pushObj(obj);
    });
  }

  if (calls.length === 0) {
    tryParseJsonBlob(text, (obj) => {
      if (looksLikeToolObject(obj)) return;
      pushObj(obj);
    });
  }

  return calls;
}

function looksLikeToolObject(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  if (typeof o.tool === "string" && TOOL_NAMES.has(o.tool)) return true;
  if (typeof o.name === "string" && TOOL_NAMES.has(o.name)) return true;
  if (
    o.function &&
    typeof o.function === "object" &&
    typeof (o.function as { name?: unknown }).name === "string" &&
    TOOL_NAMES.has(String((o.function as { name: string }).name))
  ) {
    return true;
  }
  return false;
}

function agentToolCallFromUnknown(obj: unknown): AgentToolCall | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;

  let name = "";
  let args: Record<string, unknown> = {};

  if (typeof o.tool === "string" && TOOL_NAMES.has(o.tool)) {
    name = o.tool;
    args = { ...o };
    delete args.tool;
  } else if (typeof o.name === "string" && TOOL_NAMES.has(o.name)) {
    name = o.name;
    const rawArgs = o.arguments ?? o.parameters ?? o.args;
    if (typeof rawArgs === "string") {
      try {
        args = JSON.parse(rawArgs) as Record<string, unknown>;
      } catch {
        return null;
      }
    } else if (rawArgs && typeof rawArgs === "object") {
      args = rawArgs as Record<string, unknown>;
    } else {
      // name + path/rows sibling fields
      args = { ...o };
      delete args.name;
    }
  } else if (
    o.function &&
    typeof o.function === "object" &&
    typeof (o.function as { name?: unknown }).name === "string"
  ) {
    const fn = o.function as { name: string; arguments?: unknown };
    if (!TOOL_NAMES.has(fn.name)) return null;
    name = fn.name;
    if (typeof fn.arguments === "string") {
      try {
        args = JSON.parse(fn.arguments) as Record<string, unknown>;
      } catch {
        return null;
      }
    } else if (fn.arguments && typeof fn.arguments === "object") {
      args = fn.arguments as Record<string, unknown>;
    }
  } else {
    return null;
  }

  // Reuse OpenAI arg shaping
  const fake: ToolCall = {
    id: "json-fallback",
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
  return agentCallFromOpenAI(fake);
}

/** Detect Word/Excel creation intents (dedicated tools, not write_file). */
export function inferOfficeCreateIntent(
  userText: string,
): { tool: "write_docx" | "write_xlsx"; path: string } | null {
  const t = userText.trim();
  if (!t) return null;

  const wantsCreate =
    /创建|生成|写|新建|做|导出|保存|create|generate|write|make|export/i.test(t);

  const xlsxNamed = t.match(
    /[`"'“”]?([\w./\\-]+\.xlsx)[`"'“”]?/i,
  );
  if (xlsxNamed?.[1] && (wantsCreate || /excel|表格|xlsx|spreadsheet/i.test(t))) {
    return { tool: "write_xlsx", path: normalizeRelPath(xlsxNamed[1]) };
  }

  const docxNamed = t.match(
    /[`"'“”]?([\w./\\-]+\.docx)[`"'“”]?/i,
  );
  if (docxNamed?.[1] && (wantsCreate || /word|文档|docx/i.test(t))) {
    return { tool: "write_docx", path: normalizeRelPath(docxNamed[1]) };
  }

  if (wantsCreate && /excel|表格|\.xlsx|spreadsheet|工作簿/i.test(t)) {
    const base =
      t.match(/(?:叫|名为|命名为|name(?:d)?\s*)[`"'“”]?([\w.-]+)[`"'“”]?/i)?.[1] ??
      "workbook";
    const path = /\.xlsx$/i.test(base) ? base : `${base}.xlsx`;
    return { tool: "write_xlsx", path: normalizeRelPath(path) };
  }

  if (wantsCreate && /word|\.docx|文档(?!串)/i.test(t)) {
    const base =
      t.match(/(?:叫|名为|命名为|name(?:d)?\s*)[`"'“”]?([\w.-]+)[`"'“”]?/i)?.[1] ??
      "document";
    const path = /\.docx$/i.test(base) ? base : `${base}.docx`;
    return { tool: "write_docx", path: normalizeRelPath(path) };
  }

  return null;
}

/** Build a write_docx / write_xlsx call when the model skipped tools. */
export function synthesizeOfficeFromIntent(
  intent: { tool: "write_docx" | "write_xlsx"; path: string },
  userText: string,
): AgentToolCall {
  const blank = /空(白)?(的)?|empty|blank/i.test(userText);
  if (intent.tool === "write_docx") {
    return {
      tool: "write_docx",
      path: intent.path,
      paragraphs: blank ? [] : [""],
    };
  }
  return {
    tool: "write_xlsx",
    path: intent.path,
    rows: blank ? [[""]] : [["Column A"], [""]],
  };
}

/**
 * Detect "看看当前目录有什么 / 读一下某文件" explore intents.
 */
export function inferExploreIntent(
  userText: string,
):
  | { kind: "list"; path: string }
  | { kind: "read"; path: string }
  | { kind: "search"; query: string }
  | null {
  const t = userText.trim();
  if (!t) return null;

  const wantsList =
    /列出|罗列|有哪些|有什么文件|目录|文件夹|项目结构|树形|ls\b|list\s+(files|dir|directory)|what('s| is) in|show\s+(me\s+)?(the\s+)?(files|dir|directory|folder|tree)|当前(目录|文件夹|项目)/i.test(
      t,
    ) || /看看.*(目录|文件夹|项目|文件)/i.test(t);

  // Multi-step: 先列出…再读… — list first even if a filename appears later
  if (wantsList && /先.*(列出|list|ls\b|目录|文件夹)/i.test(t)) {
    return { kind: "list", path: "." };
  }

  const readNamed = t.match(
    /(?:读取|打开|查看|看看|读一下|显示|cat|read|open|show)\s*[：:\s]*[`"'“”]?([\w./\\-]+\.\w{1,10})[`"'“”]?/i,
  );
  if (readNamed?.[1]) {
    return { kind: "read", path: normalizeRelPath(readNamed[1]) };
  }

  const tickRead = t.match(
    /(?:读取|打开|查看|读一下|read|open|cat).{0,20}[`"'“”]([\w./\\-]+\.\w{1,10})[`"'“”]/i,
  );
  if (tickRead?.[1]) {
    return { kind: "read", path: normalizeRelPath(tickRead[1]) };
  }

  const searchQ = t.match(
    /(?:搜索|查找|找一下|全文搜索|search(?:\s+for)?)\s*[：:\s]*[`"'“”]?([^`'“”\n]{2,80})[`"'“”]?/i,
  );
  if (searchQ?.[1] && /搜索|查找|search/i.test(t)) {
    return { kind: "search", query: searchQ[1].trim() };
  }

  if (wantsList) {
    const sub = t.match(
      /(?:目录|文件夹|folder|dir(?:ectory)?)\s*[：:\s]*[`"'“”]?([\w./\\-]+)[`"'“”]?/i,
    );
    let path = ".";
    if (sub?.[1] && !/^(?:里|下|中|内|下有|里面)$/i.test(sub[1])) {
      const candidate = sub[1].replace(/\.(xlsx|docx|png|jpg)$/i, "");
      if (candidate && !/\.\w{1,8}$/.test(candidate)) {
        path = normalizeRelPath(candidate) || ".";
      }
    }
    return { kind: "list", path: path || "." };
  }

  return null;
}

export function synthesizeExploreToolCall(
  intent: NonNullable<ReturnType<typeof inferExploreIntent>>,
): AgentToolCall {
  if (intent.kind === "list") {
    return { tool: "list_dir", path: intent.path };
  }
  if (intent.kind === "read") {
    return { tool: "read_file", path: intent.path };
  }
  return { tool: "search_files", query: intent.query };
}

/** Multi-step project tasks like 先列出…再读 package.json…最后改 README */
export function inferMultiStepPlan(userText: string): AgentToolCall[] {
  const t = userText.trim();
  if (!t) return [];
  const steps: AgentToolCall[] = [];

  if (
    /先.*(列出|list|ls\b|目录|文件夹)/i.test(t) ||
    /列出.*再/i.test(t)
  ) {
    steps.push({ tool: "list_dir", path: "." });
  }
  if (/\bpackage\.json\b/i.test(t) && /读|read|查看|read_file/i.test(t)) {
    steps.push({ tool: "read_file", path: "package.json" });
  }
  if (
    /\bREADME(?:\.md)?\b/i.test(t) &&
    /加|写|改|修改|顶部|prepend|append|search_replace/i.test(t)
  ) {
    steps.push({ tool: "read_file", path: "README.md" });
  }

  return steps.length >= 2 ? steps : [];
}

export function multiStepSystemHint(steps: AgentToolCall[]): string {
  const labels = steps.map((s, i) => {
    if (s.tool === "list_dir") return `${i + 1}. list_dir(${s.path ?? "."})`;
    if (s.tool === "read_file") return `${i + 1}. read_file(${s.path})`;
    return `${i + 1}. ${s.tool}`;
  });
  return `用户多步任务（必须逐步调用工具，禁止凭猜测跳过步骤）：\n${labels.join("\n")}\n全部完成后再中文总结。`;
}

/** After planned reads fail, tell the model to create files instead of stopping. */
export function multiStepFollowUpHint(userText: string): string | null {
  const parts: string[] = [];
  if (/\bpackage\.json\b/i.test(userText) && /读|read|查看/i.test(userText)) {
    parts.push(
      "若 read_file package.json 返回错误，则文件不存在——不要假装全文搜索；可 write_file 新建，或明确告知用户当前项目根下无此文件。",
    );
  }
  if (
    /\bREADME(?:\.md)?\b/i.test(userText) &&
    /加|写|改|修改|顶部|说明/i.test(userText)
  ) {
    parts.push(
      "若 README.md 不存在，必须用 write_file 创建并写入（含用户要的项目说明）；若存在则用 search_replace 在文件开头插入一行。禁止只报告失败而不调工具。",
    );
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

export function stripToolCalls(text: string): string {
  let out = text
    .replace(TOOL_CALL_RE, "")
    .replace(TOOL_CONTENT_RE, "");

  // Strip fenced JSON that is clearly a tool call dump
  out = out.replace(/```(?:json|javascript|js|txt)?\s*\n?([\s\S]*?)```/gi, (block, body) => {
    const inner = String(body ?? "").trim();
    try {
      const obj = JSON.parse(inner);
      if (looksLikeToolObject(obj) || looksLikeToolArgsObject(obj)) return "";
    } catch {
      if (/"(?:name|tool)"\s*:\s*"(?:write_xlsx|write_docx|write_file|search_replace|apply_patch|list_dir|read_file|mkdir|search_files)"/.test(inner)) {
        return "";
      }
    }
    return block;
  });

  return out.replace(/\n{3,}/g, "\n\n").trim();
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

function formatHits(hits: SearchHit[]): string {
  if (hits.length === 0) return "(no matches)";
  return hits
    .map((h) => `${h.path}:${h.line}: ${h.text}`)
    .join("\n");
}

/** Ensure blank Word docs work even with an older sidecar still running. */
function normalizeDocxPayload(
  title: string | undefined,
  paragraphs: string[] | undefined,
): { title?: string; paragraphs: string[] } {
  const paras = (paragraphs ?? []).map((p) => String(p ?? ""));
  const t = title?.trim() || undefined;
  const blank =
    !t && (paras.length === 0 || paras.every((p) => !p.trim()));
  if (blank) {
    // Zero-width space survives legacy sidecar non-empty checks.
    return { paragraphs: ["\u200b"] };
  }
  return { title: t, paragraphs: paras };
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
        if (/\.(docx|xlsx)$/i.test(path)) {
          return {
            ok: false,
            resultText: `Error: use ${path.toLowerCase().endsWith(".docx") ? "write_docx" : "write_xlsx"} for Office files, not write_file`,
            activity: {
              kind: "error",
              message: "write_file cannot create Office binaries",
            },
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
      case "search_replace": {
        const path = normalizeRelPath(call.path?.trim() || "", projectRoot);
        if (!path || path === ".") {
          return {
            ok: false,
            resultText: "Error: path is required",
            activity: { kind: "error", message: "search_replace missing path" },
          };
        }
        if (typeof call.old_string !== "string" || call.old_string.length === 0) {
          return {
            ok: false,
            resultText: "Error: old_string is required",
            activity: {
              kind: "error",
              message: "search_replace missing old_string",
            },
          };
        }
        if (typeof call.new_string !== "string") {
          return {
            ok: false,
            resultText: "Error: new_string is required",
            activity: {
              kind: "error",
              message: "search_replace missing new_string",
            },
          };
        }
        const { size, path: writtenPath, replacements } = await searchReplace(
          path,
          {
            old_string: call.old_string,
            new_string: call.new_string,
            replace_all: call.replace_all,
          },
          sidecarUrl,
          signal,
        );
        return {
          ok: true,
          resultText: `Updated ${writtenPath} (${replacements} replacement(s), ${size} bytes)`,
          activity: {
            kind: "write",
            message: `Patched ${writtenPath} ×${replacements}`,
          },
          change: { path: writtenPath, size },
        };
      }
      case "apply_patch": {
        const path = normalizeRelPath(call.path?.trim() || "", projectRoot);
        if (!path || path === ".") {
          return {
            ok: false,
            resultText: "Error: path is required",
            activity: { kind: "error", message: "apply_patch missing path" },
          };
        }
        if (!call.edits || call.edits.length === 0) {
          return {
            ok: false,
            resultText: "Error: edits must be a non-empty array",
            activity: { kind: "error", message: "apply_patch missing edits" },
          };
        }
        const { size, path: writtenPath, edits, replacements } = await applyPatch(
          path,
          call.edits,
          sidecarUrl,
          signal,
        );
        return {
          ok: true,
          resultText: `Patched ${writtenPath} (${edits} edit(s), ${replacements} replacement(s), ${size} bytes)`,
          activity: {
            kind: "write",
            message: `Patched ${writtenPath} (${edits} edits)`,
          },
          change: { path: writtenPath, size },
        };
      }
      case "write_docx": {
        const path = normalizeRelPath(call.path?.trim() || "", projectRoot);
        if (!path || path === ".") {
          return {
            ok: false,
            resultText: "Error: path is required",
            activity: { kind: "error", message: "write_docx missing path" },
          };
        }
        const { title, paragraphs } = normalizeDocxPayload(
          call.title,
          call.paragraphs,
        );
        const { size, path: writtenPath } = await writeDocx(
          path,
          { title, paragraphs },
          sidecarUrl,
          signal,
        );
        return {
          ok: true,
          resultText: `Wrote Word document ${writtenPath} (${size} bytes)`,
          activity: { kind: "write", message: `Wrote ${writtenPath}` },
          change: { path: writtenPath, size },
        };
      }
      case "write_xlsx": {
        const path = normalizeRelPath(call.path?.trim() || "", projectRoot);
        if (!path || path === ".") {
          return {
            ok: false,
            resultText: "Error: path is required",
            activity: { kind: "error", message: "write_xlsx missing path" },
          };
        }
        if (!call.rows || call.rows.length === 0) {
          return {
            ok: false,
            resultText: "Error: rows must be a non-empty 2D array",
            activity: { kind: "error", message: "write_xlsx missing rows" },
          };
        }
        const { size, path: writtenPath, rows } = await writeXlsx(
          path,
          {
            sheet_name: call.sheet_name,
            rows: call.rows,
          },
          sidecarUrl,
          signal,
        );
        return {
          ok: true,
          resultText: `Wrote Excel workbook ${writtenPath} (${rows} rows, ${size} bytes)`,
          activity: { kind: "write", message: `Wrote ${writtenPath}` },
          change: { path: writtenPath, size },
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
    content:
      truncated +
      "\n\n(If the task is not finished, call the next tool. If done, reply with a final summary in Chinese — no more tool calls.)",
  };
}
