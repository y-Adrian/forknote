import { getLocale, t, type Locale } from "./i18n";
import type { ChatMessage, OpenAITool, ToolCall } from "./openai";
import {
  applyPatch,
  deleteFile,
  ensureProjectBound,
  dependencyGraph,
  findReferences,
  findSymbol,
  semanticSearch,
  gitCommit,
  gitDiff,
  gitStatus,
  globFiles,
  goToDefinition,
  listDir,
  mkdir as sidecarMkdir,
  patchXlsx,
  readDocx,
  readFile,
  readXlsx,
  renameFile,
  runDiagnostics,
  runTerminal,
  searchFiles,
  searchReplace,
  writeDocx,
  writeFile,
  writeXlsx,
  type SearchHit,
} from "./sidecar";
import {
  appendCodingMemoryNote,
  loadContextMemoryPack,
  resolveMemoryDir,
  CODING_MEMORY_FILE,
} from "./contextMemory";
import { isDeniedTerminalCommand } from "./terminalDenyList";
import {
  DEFAULT_AGENT_MAX_ROUNDS,
  MAX_AGENT_MAX_ROUNDS,
  MIN_AGENT_MAX_ROUNDS,
  loadSettings,
} from "./settings";

export {
  DEFAULT_AGENT_MAX_ROUNDS,
  MAX_AGENT_MAX_ROUNDS,
  MIN_AGENT_MAX_ROUNDS,
};

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
  | "read_docx"
  | "read_xlsx"
  | "patch_xlsx"
  | "mkdir"
  | "search_files"
  | "glob_files"
  | "find_symbol"
  | "go_to_definition"
  | "find_references"
  | "dependency_graph"
  | "semantic_search"
  | "coding_memory"
  | "delete_file"
  | "rename_file"
  | "run_diagnostics"
  | "git_status"
  | "git_diff"
  | "git_commit"
  | "run_terminal";

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
  name?: string;
  focus?: string;
  action?: string;
  note?: string;
  title?: string;
  paragraphs?: string[];
  sheet_name?: string;
  rows?: SpreadsheetCell[][];
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
  edits?: TextEdit[];
  command?: string;
  cwd?: string;
  timeoutMs?: number;
  offset?: number;
  limit?: number;
  pattern?: string;
  regex?: boolean;
  glob?: string;
  from?: string;
  to?: string;
  message?: string;
  paths?: string[];
  cells?: Array<{ row: number; col: number; value: SpreadsheetCell }>;
};

export type AgentActivity = {
  id: string;
  kind:
    | "list"
    | "read"
    | "write"
    | "mkdir"
    | "search"
    | "terminal"
    | "error"
    | "info";
  message: string;
  at: number;
};

export type AgentFileChange = {
  path: string;
  size: number;
  at: number;
  diff?: string;
};

const TOOL_NAMES = new Set<string>([
  "list_dir",
  "read_file",
  "write_file",
  "search_replace",
  "apply_patch",
  "write_docx",
  "write_xlsx",
  "read_docx",
  "read_xlsx",
  "patch_xlsx",
  "mkdir",
  "search_files",
  "glob_files",
  "find_symbol",
  "go_to_definition",
  "find_references",
  "dependency_graph",
  "semantic_search",
  "coding_memory",
  "delete_file",
  "rename_file",
  "run_diagnostics",
  "git_status",
  "git_diff",
  "git_commit",
  "run_terminal",
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
        "Read a UTF-8 text file relative to the project root. Large files return the first ~400 lines unless you pass offset (1-based start line) and limit. Use glob_files / search_files to find paths first.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative file path, e.g. src/main.c or soft/hello.c",
          },
          offset: {
            type: "number",
            description: "1-based start line (optional). Use with limit for large files.",
          },
          limit: {
            type: "number",
            description: "Max number of lines to return (optional, default 400 for large files).",
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
      description:
        "Search file contents under the project. Default is a case-insensitive substring. Set regex=true for a JS/ripgrep regular expression. Optional glob limits which files are searched (e.g. **/*.ts).",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Substring or regex to search for" },
          path: {
            type: "string",
            description: 'Subdirectory to search, default "."',
          },
          regex: {
            type: "boolean",
            description: "Treat query as a regular expression",
          },
          glob: {
            type: "string",
            description: "Optional file glob, e.g. **/*.{ts,tsx}",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "glob_files",
      description:
        "Find files by glob pattern relative to the project root (e.g. **/*.ts, src/**/*.c). Prefer this over guessing paths or listing every directory.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob, e.g. **/*.{ts,tsx}" },
          path: {
            type: "string",
            description: 'Subdirectory to search, default "."',
          },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_symbol",
      description:
        "Find TypeScript/JavaScript declarations (function/class/interface/type/enum/variable) by exact symbol name. Prefer over search_files when you know the identifier.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Exact symbol name" },
          path: {
            type: "string",
            description: 'File or subdirectory to scan, default "."',
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "go_to_definition",
      description:
        "Resolve the best declaration site for a TS/JS symbol. Optional path hints the current file first.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Symbol name" },
          path: {
            type: "string",
            description: "Current file or folder hint (optional)",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_references",
      description:
        "List identifier occurrences of a TS/JS symbol across the project (comments/strings ignored).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Symbol name" },
          path: {
            type: "string",
            description: 'File or subdirectory to scan, default "."',
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "dependency_graph",
      description:
        "Build a TS/JS import graph (import/require/reexport). Pass focus=path to see outbound imports and inbound importers for impact analysis.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: 'Subdirectory to scan, default "."',
          },
          focus: {
            type: "string",
            description: "Relative file to center the graph on (inbound + outbound).",
          },
          limit: {
            type: "number",
            description: "Max edges to return (default 400).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "semantic_search",
      description:
        "Ranked code search when you do not know the exact file or symbol (BM25 over TS/JS chunks). Prefer find_symbol when you know the identifier; prefer search_files for exact strings.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural-language or keyword query" },
          path: { type: "string", description: 'Subdirectory to scan, default "."' },
          limit: { type: "number", description: "Max hits (default 8)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "coding_memory",
      description:
        "Read or append project coding memory (CODING.md): conventions, failed patterns, lessons. Prefer append after discovering a durable coding constraint.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: '"read" (default) or "append"',
          },
          note: {
            type: "string",
            description: "Required for append: short durable coding note",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description:
        "Delete a file, or an empty directory, relative to the project root. Non-empty directories are rejected.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to delete" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rename_file",
      description: "Rename or move a file/directory within the project (from → to).",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "Existing relative path" },
          to: { type: "string", description: "Destination relative path" },
        },
        required: ["from", "to"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_docx",
      description: "Extract plain text from an existing Word .docx file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative .docx path" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_xlsx",
      description: "Read an existing Excel .xlsx workbook as sheet rows (capped).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative .xlsx path" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "patch_xlsx",
      description:
        "Patch individual cells in an existing .xlsx (1-based row/col). Prefer this over rewriting the whole workbook.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          sheet_name: { type: "string" },
          cells: {
            type: "array",
            items: {
              type: "object",
              properties: {
                row: { type: "number" },
                col: { type: "number" },
                value: { type: ["string", "number", "boolean", "null"] },
              },
              required: ["row", "col"],
            },
          },
        },
        required: ["path", "cells"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_diagnostics",
      description:
        "Run project typecheck (npx tsc --noEmit) when tsconfig.json exists. Call after a batch of TypeScript edits.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "git_status",
      description: "Show git status --porcelain for the bound project (read-only).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "git_diff",
      description: "Show git diff (unstaged). Optional path limits to one file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Optional relative file path" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "git_commit",
      description:
        "Stage the listed paths and create a git commit. Does not push. Requires an explicit message and file list (no git add -A).",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Commit message" },
          paths: {
            type: "array",
            items: { type: "string" },
            description: "Relative paths to stage",
          },
        },
        required: ["message", "paths"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_terminal",
      description:
        "Run a shell command with starting cwd ALWAYS at the bound project root (via local sidecar) — never the sidecar process cwd. Use when the user asks to run/execute a command or wants shell/terminal/命令行 (e.g. try to run npm test, run ls /debris, ls, pwd, git status). Do NOT substitute list_dir — especially not for absolute paths outside the project. Prefer short non-interactive commands. Commands that cd away or use absolute paths outside the project require user permission. stdout/stderr are truncated if large. Optional cwd is relative to the project root; optional timeoutMs (default 60000, max 300000).",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description:
              'Shell command to run, e.g. "ls", "pwd", "npm test", or "npx tsc --noEmit". Prefer project-relative paths; avoid cd /, cd ~, or /tmp unless the user explicitly asked.',
          },
          cwd: {
            type: "string",
            description:
              'Optional working directory relative to the project root (default "." = project root). Absolute paths outside the project are rejected.',
          },
          timeoutMs: {
            type: "number",
            description:
              "Optional timeout in milliseconds (default 60000, clamped 1000–300000).",
          },
        },
        required: ["command"],
      },
    },
  },
];

/** Filter project tools (e.g. hide run_terminal when disabled in settings). */
export function getProjectOpenAITools(options?: {
  allowTerminal?: boolean;
}): OpenAITool[] {
  const allowTerminal = options?.allowTerminal !== false;
  if (allowTerminal) return PROJECT_OPENAI_TOOLS;
  return PROJECT_OPENAI_TOOLS.filter(
    (t) => t.function.name !== "run_terminal",
  );
}

/**
 * Max numbered steps shown/approved in one plan-review round.
 * Larger plans are chunked: approve → run → plan the next chunk.
 */
export const MAX_PLAN_APPROVAL_STEPS = 3;

/** Planning-only system addendum — no tools until the user approves. */
export function buildPlanningPhaseSystem(locale: Locale): string {
  if (locale === "zh") {
    return `
【计划阶段】用户已连接本地项目。此轮禁止调用任何工具，禁止声称已读写文件。

原则（必须遵守）：
- 严格依据用户【最新一条】原话理解意图；忽略历史中未完成的旧计划/旧文件任务，除非用户明确要求继续。
- 若最新消息是聊天内绘图（Mermaid/PlantUML/「画个图」等）且未要求基于本仓库：直接回答并输出图围栏，写明「无需工具」；禁止把记忆里的构建/验证当成本轮目标。
- 根据情景判断：示例/解释/「写一段代码」类问答优先直接回答（Markdown 围栏）并写明「无需工具」；仅当目标确需改仓库或跑命令时再起草精简计划。不要编造路径（如 hello.py）或用 run_terminal / echo 代替贴代码。
- 意图不清时：只输出简短澄清问题，并可给出编号选项供用户选择；不要写「执行计划」，不要编造文件操作，不要提「批准并执行」。
- 意图明确且需要改磁盘或跑可能改系统的 shell 时：再输出精简计划；只包含必要步骤，禁止自行添加验证步骤（如写完再 list_dir）。
- 用户明确要求 shell/终端/执行命令/run … 时：计划里用 run_terminal（写出确切 command），不要改成 list_dir。
- 每轮计划最多 ${MAX_PLAN_APPROVAL_STEPS} 个编号步骤。若任务更长，只写本轮要做的前 ${MAX_PLAN_APPROVAL_STEPS} 步，并一句说明其余稍后规划；不要一次列出长清单。
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
- Ground everything in the user's LATEST message. Ignore unfinished older plans/file tasks in history unless the user explicitly asks to continue.
- If the latest message is a chat diagram ask (Mermaid/PlantUML/draw a diagram) and not project-grounded: answer with a diagram fence and say no tools are required; do not treat memory build/verify work as this turn's goal.
- Judge by situation: for sample/how-to/explanation asks, prefer answering directly (Markdown fences OK) and say no tools are required; only draft a plan when the goal truly needs repo changes or commands. Do not invent paths (e.g. hello.py) or use run_terminal / echo instead of pasting code.
- If intent is unclear: ask a short clarifying question and/or numbered options only. Do NOT write an execution plan, invent file ops, or mention Approve & run.
- If intent is clear and needs disk changes or potentially mutating shell: output a minimal plan with only necessary steps (no invented verification like list_dir after write).
- If the user explicitly asked for shell/terminal/run …: plan run_terminal with the exact command — do not substitute list_dir.
- At most ${MAX_PLAN_APPROVAL_STEPS} numbered steps per plan. If the task is longer, list only the next ${MAX_PLAN_APPROVAL_STEPS} steps for this approval round and note that the rest will be planned later — do not dump a long checklist.
- If intent is clear but no tools are needed: answer directly and say no tools are required.

When a plan is needed, use:
## Plan
1. First step…

## Expected operations (optional)
- Only required tools; write "none" if no tools`;
}

export type LimitedApprovalPlan = {
  planText: string;
  steps: string[];
  deferredSteps: string[];
  totalSteps: number;
  wasChunked: boolean;
};

/**
 * Cap a parsed plan to {@link MAX_PLAN_APPROVAL_STEPS} for one approval round.
 * Extra steps are deferred for a later plan after this chunk runs.
 */
export function limitPlanForApproval(
  planText: string,
  steps: string[],
  locale: Locale,
  maxSteps: number = MAX_PLAN_APPROVAL_STEPS,
): LimitedApprovalPlan {
  const totalSteps = steps.length;
  if (totalSteps <= maxSteps) {
    return {
      planText,
      steps,
      deferredSteps: [],
      totalSteps,
      wasChunked: false,
    };
  }

  const approved = steps.slice(0, maxSteps);
  const deferredSteps = steps.slice(maxSteps);
  const numbered = approved.map((s, i) => `${i + 1}. ${s}`).join("\n");
  const note =
    locale === "zh"
      ? `（本轮仅前 ${maxSteps} 步，共 ${totalSteps} 步；其余将在本轮执行后再规划。）`
      : `(This round: first ${maxSteps} of ${totalSteps} steps. Remaining work will be planned after these run.)`;

  const hasPlanHeading = /^#{1,3}\s*(计划|Plan)\b/im.test(planText);
  const heading =
    locale === "zh" ? "## 计划" : "## Plan";
  const planTextOut = hasPlanHeading
    ? `${heading}\n${numbered}\n\n${note}`
    : `${numbered}\n\n${note}`;

  return {
    planText: planTextOut,
    steps: approved,
    deferredSteps,
    totalSteps,
    wasChunked: true,
  };
}

/** User message after a chunk finishes — ask for the next ≤N-step plan. */
export function buildNextPlanChunkPrompt(
  deferredSteps: string[],
  locale: Locale,
  maxSteps: number = MAX_PLAN_APPROVAL_STEPS,
): string {
  const list = deferredSteps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  if (locale === "zh") {
    return `上一批已批准步骤已执行完毕。请仅为剩余工作制定下一批执行计划（最多 ${maxSteps} 个编号步骤）；此阶段仍禁止调用工具。若剩余不足 ${maxSteps} 步则全部列出。剩余待办：\n${list}`;
  }
  return `The approved steps finished. Draft only the next execution plan chunk (at most ${maxSteps} numbered steps). Still do not call tools. If fewer than ${maxSteps} remain, list them all. Remaining work:\n${list}`;
}

/**
 * Counteracts the planning-phase “do not call tools” system message after the
 * user clicks Approve & run. Small local models (Ollama) otherwise keep
 * summarizing instead of emitting tool_calls.
 */
export function buildExecutionPhaseSystem(locale: Locale): string {
  if (locale === "zh") {
    return `【执行阶段】计划已获用户批准。规划阶段结束：你现在必须通过函数调用（tool_calls）执行已批准步骤。禁止只描述将要做什么、禁止假装已写入文件、禁止把工具 JSON 当作普通 Markdown 贴给用户（若无法发原生 tool_calls，可用 <tool_call>…</tool_call>）。`;
  }
  return `[Execution phase] The user approved the plan. Planning is over: you MUST execute the approved steps via function/tool calls now. Do not only describe work, do not claim files were written without calling tools, and do not paste tool JSON as ordinary Markdown (if native tool_calls are unavailable, use <tool_call>…</tool_call>).`;
}

const TOOL_MENTION_RE =
  /\b(write_file|list_dir|read_file|search_replace|apply_patch|write_docx|write_xlsx|read_docx|read_xlsx|patch_xlsx|mkdir|search_files|glob_files|find_symbol|go_to_definition|find_references|dependency_graph|semantic_search|coding_memory|delete_file|rename_file|run_diagnostics|git_status|git_diff|git_commit|run_terminal)\b/i;

/** Disk-mutating tools excluding run_terminal (terminal is classified by command). */
const DISK_MUTATING_TOOL_RE =
  /\b(write_file|search_replace|apply_patch|write_docx|write_xlsx|patch_xlsx|mkdir|delete_file|rename_file|git_commit)\b/i;

const MUTATING_TOOLS = new Set<AgentToolName>([
  "write_file",
  "search_replace",
  "apply_patch",
  "write_docx",
  "write_xlsx",
  "patch_xlsx",
  "mkdir",
  "delete_file",
  "rename_file",
  "git_commit",
  "run_terminal",
]);

/**
 * Read-only / inspect-only shell commands that should not require plan approval.
 * Anything else (including unknown) is treated as mutating.
 * Outside-project paths (cd /, ls /tmp, …) are never read-only — they need 权限.
 */
const READ_ONLY_TERMINAL_RE =
  /^(?:ls|dir|pwd|echo|printf|cat|head|tail|wc|which|type|file|stat|du|df|uname|whoami|date|env|printenv|id|hostname|basename|dirname|realpath|readlink|md5sum|sha256sum|git\s+(?:status|log|diff|show|branch|remote|rev-parse|describe|ls-files|blame)|npm\s+(?:(?:ls|list|outdated|view|info|ping|config\s+get)\b)|node\s+-v|npm\s+-v|npx\s+--version|python(?:3)?\s+--version|tsc\s+--version)(?:\s|$)/i;

function normalizePathForCompare(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
}

/** True when `candidate` is absolute and not under `projectRoot` (when known). */
function isAbsoluteOutsideProject(
  candidate: string,
  projectRoot?: string | null,
): boolean {
  const c = candidate.trim();
  if (!c) return false;
  if (
    c === "~" ||
    c.startsWith("~/") ||
    c === "$HOME" ||
    c.startsWith("$HOME/") ||
    c.startsWith("${HOME}")
  ) {
    return true;
  }
  const unixAbs = c.startsWith("/");
  const winAbs = /^[A-Za-z]:[\\/]/.test(c);
  if (!unixAbs && !winAbs) return false;
  // Any absolute path is outside when project root is unknown.
  if (!projectRoot?.trim()) return true;
  const root = normalizePathForCompare(projectRoot);
  const abs = normalizePathForCompare(c);
  return abs !== root && !abs.toLowerCase().startsWith(root.toLowerCase() + "/");
}

/**
 * Heuristic: command references paths outside the bound project
 * (`cd /`, `cd ~`, `ls /tmp`, `ls /debris`, any absolute path not under root).
 */
export function commandLeavesProject(
  command: string,
  projectRoot?: string | null,
): boolean {
  const raw = command.trim();
  if (!raw) return false;

  const cdRe =
    /(?:^|[;&|\n]|(?:&&|\|\|))\s*(?:cd|pushd)\s+(?:(?:--|-[LP]\s+)*)([^\s;|&]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = cdRe.exec(raw)) !== null) {
    const target = m[1].replace(/^['"]|['"]$/g, "");
    if (target === "-" || target === "--") continue;
    if (target === "/" || target === "\\" || isAbsoluteOutsideProject(target, projectRoot)) {
      return true;
    }
  }

  // POSIX absolute (/…), home (~), $HOME, or Windows drive paths — any prefix.
  const absRe =
    /(?:^|[\s"'`=:(])((?:\/[^\s"'`;|&<>]*)|(?:~(?:\/[^\s"'`;|&<>]*)?)|(?:\$\{?HOME\}?(?:\/[^\s"'`;|&<>]*)?)|(?:[A-Za-z]:[\\/][^\s"'`;|&<>]*))/g;
  while ((m = absRe.exec(raw)) !== null) {
    const token = m[1];
    if (
      token === "/" ||
      token === "~" ||
      token.startsWith("~/") ||
      /\$\{?HOME\}?/.test(token) ||
      isAbsoluteOutsideProject(token, projectRoot)
    ) {
      return true;
    }
  }

  return false;
}

/** True when a shell command is obviously inspect-only (ls/pwd/git status/…). */
export function isReadOnlyTerminalCommand(
  command: string,
  projectRoot?: string | null,
): boolean {
  const raw = command.trim();
  if (!raw) return false;
  if (commandLeavesProject(raw, projectRoot)) return false;
  // Redirects / pipes to write, or chaining with mutating ops → not read-only.
  if (/[>]|>>|\btee\b/i.test(raw)) return false;
  if (/\b(?:rm|mv|cp|chmod|chown|mkdir|touch|kill|pkill|dd|mkfs|shutdown|reboot|sudo)\b/i.test(raw)) {
    return false;
  }
  // Split on shell chain operators; every segment must be read-only.
  const parts = raw.split(/(?:&&|\|\||;|\n)/);
  return parts.every((part) => {
    const cmd = part.trim().replace(/^\(+/, "").trim();
    if (!cmd) return true;
    // Allow simple pipes of read-only commands (ls | head).
    const pipeSegs = cmd.split("|").map((s) => s.trim());
    return pipeSegs.every((seg) => {
      const s = seg.replace(/^\(+/, "").trim();
      return Boolean(s) && READ_ONLY_TERMINAL_RE.test(s);
    });
  });
}

/**
 * True when a string looks like a real shell invocation — not Chinese prose,
 * markdown headings, or list markers that plan parsers sometimes leak.
 */
export function looksLikeShellCommand(raw: string): boolean {
  const t = raw.trim();
  if (!t || t.length > 500) return false;
  if (/\n/.test(t)) {
    const lines = t
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return false;
    // Continuations / heredocs are rare in plans; reject messy multi-line blobs.
    if (lines.length > 3) return false;
    return lines.every((l) => looksLikeShellCommand(l));
  }
  if (/^#{1,6}(?:\s|$)/.test(t)) return false;
  if (/^[-*•]+$/.test(t)) return false;
  if (/^[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(t)) return false;
  if (/^[),，。、；：!？?]/.test(t)) return false;
  if (
    /^(?:使用|删除|保留|执行|运行|然后|首先|接下来|预期|操作|计划|none|n\/a)\b/i.test(
      t,
    )
  ) {
    return false;
  }
  if (/^(?:with|using|via|to|for|and|then|tool|function|call)\b/i.test(t)) {
    return false;
  }
  // Strip a leading prompt if present, then require a shell-like token.
  const body = t.replace(/^\$\s+/, "").trim();
  if (!body) return false;
  // ENV=value cmd  |  ./script  |  /abs/path  |  bare command
  if (/^(?:[A-Za-z_][\w]*=\S+\s+)+/.test(body)) return true;
  if (/^(?:\.\/|\/|~\/)/.test(body)) return true;
  if (/^(?:sudo\s+)?(?:[\w.@+-]+\/)*[\w.@+-]+\b/.test(body)) return true;
  return false;
}

function normalizeExtractedCommand(raw: string | undefined): string | null {
  let cmd = raw?.trim().replace(/^[`"'“”]+|[`"'“”]+$/g, "").trim();
  if (!cmd) return null;
  cmd = cmd
    .replace(/^\$\s+/, "")
    .replace(/^command\s*[=:]\s*/i, "")
    .replace(/^[`"'“”]+|[`"'“”]+$/g, "")
    .trim();
  if (!cmd) return null;
  if (!looksLikeShellCommand(cmd)) return null;
  return cmd;
}

/**
 * Pull real shell commands from plan prose / steps.
 * Ignores Chinese sentence fragments, `##` headings, and bare list markers.
 * Prefer {@link resolveTerminalApproveCommands} when explicit tool args exist.
 */
export function extractTerminalCommandsFromPlan(blob: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | undefined) => {
    const cmd = normalizeExtractedCommand(raw);
    if (!cmd) return;
    const key = cmd.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push(cmd);
  };

  // run_terminal: ls -la  /  run_terminal command="npm test"  /  run_terminal(ls)
  // Use [ \t] (not \s) so we never jump across newlines onto prose.
  const labeled =
    /run_terminal[ \t]*(?:[:：][ \t]*|\([ \t]*|[ \t]+command\s*[=:][ \t]*)[`"'“”]?([^`"'“”\n\)]+?)[`"'“”]?[ \t]*(?=\)|\n|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = labeled.exec(blob)) !== null) push(m[1]);

  // Numbered / bulleted steps: "1. run_terminal: ls -la" (colon preferred)
  const stepRe =
    /(?:^|\n)[ \t]*(?:\d+[.)]|[-*•])[ \t]+run_terminal[ \t]*[:：][ \t]*(.+)$/gim;
  while ((m = stepRe.exec(blob)) !== null) push(m[1]);

  // Same-line backticks only (no cross-line fence gobbling)
  const tickRe = /run_terminal[^\n`]{0,80}`([^`\n]+)`/gi;
  while ((m = tickRe.exec(blob)) !== null) push(m[1]);

  // Explicit shell prompt lines: "$ rm -rf node_modules"
  const promptRe = /(?:^|\n)[ \t]*\$[ \t]+([^\n]+)/g;
  while ((m = promptRe.exec(blob)) !== null) push(m[1]);

  // Fenced bash/sh blocks only — bare ``` is often write_file content, not shell.
  const fenceRe = /```(?:bash|sh|zsh|shell)\b[ \t]*\n([\s\S]*?)```/gi;
  while ((m = fenceRe.exec(blob)) !== null) {
    for (const line of m[1]!.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      push(trimmed);
    }
  }

  return found;
}

/**
 * Commands to show on the Terminal approve card.
 * Explicit tool-call / inferred commands win over messy plan prose.
 */
export function resolveTerminalApproveCommands(options: {
  planText: string;
  steps: string[];
  explicitCommands?: string[] | null;
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string | undefined) => {
    const cmd = normalizeExtractedCommand(raw);
    if (!cmd) return;
    const key = cmd.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cmd);
  };

  for (const c of options.explicitCommands ?? []) push(c);
  if (out.length > 0) return out;

  const blob = `${options.planText}\n${options.steps.join("\n")}`;
  for (const c of extractTerminalCommandsFromPlan(blob)) push(c);
  return out;
}

/**
 * Optional one-line intent for the Terminal card (normal text, not a `$` block).
 * Returns null when the plan is only commands / headings / noise.
 */
export function extractTerminalPlanSummary(
  planText: string,
  steps: string[],
): string | null {
  const candidates = [
    ...steps,
    ...planText.split(/\n/).map((l) =>
      l
        .replace(/^#{1,6}\s*/, "")
        .replace(/^\s*(?:\d+[.)]|[-*•])\s+/, "")
        .trim(),
    ),
  ];
  for (const raw of candidates) {
    let s = raw.trim();
    if (!s) continue;
    if (/^#{1,6}\s*/.test(s)) continue;
    if (/^[-*•]+$/.test(s)) continue;
    if (/^[),，。、；：]/.test(s)) continue;
    if (/^(?:预期操作|Expected operations|Plan|计划)\b/i.test(s)) continue;
    if (/^(?:使用|none|n\/a)$/i.test(s)) continue;
    if (/\brun_terminal\b/i.test(s)) {
      s = s
        .replace(/\brun_terminal\b/gi, "")
        .replace(/[:：]\s*/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    if (!s || s.length < 4 || s.length > 120) continue;
    if (looksLikeShellCommand(s)) continue;
    // Prefer a short Chinese/English intent sentence
    if (
      /[\u4e00-\u9fff]{2,}/.test(s) ||
      /^(?:delete|remove|run|install|build|test|clean|list)\b/i.test(s)
    ) {
      return s;
    }
  }
  return null;
}

/**
 * True when the pending plan is mainly shell (`run_terminal`), not a multi-file
 * write plan — routes UI to inline Allow/Stop instead of the generic
 * AgentPlanReview essay.
 *
 * `explicitCommands` (inferred / tool-arg shell cmds) count even when the model
 * drafted messy prose without the literal `run_terminal` token — otherwise the
 * bottom plan card stays up and the inline shell block never appears.
 */
export function isPrimarilyTerminalPlan(
  planText: string,
  steps: string[],
  explicitCommands?: string[] | null,
): boolean {
  const blob = `${planText}\n${steps.join("\n")}`;
  // File / office mutations → not "terminal-only" (still inline via
  // {@link usesInlineToolApproval}).
  if (DISK_MUTATING_TOOL_RE.test(blob)) return false;

  const hasExplicit = (explicitCommands ?? []).some((c) =>
    Boolean(normalizeExtractedCommand(c)),
  );
  const hasRunTerminal = /\brun_terminal\b/i.test(blob);
  if (!hasRunTerminal && !hasExplicit) return false;

  const mentioned = [
    ...blob.matchAll(
      /\b(write_file|list_dir|read_file|search_replace|apply_patch|write_docx|write_xlsx|read_docx|read_xlsx|patch_xlsx|mkdir|search_files|glob_files|find_symbol|go_to_definition|find_references|dependency_graph|semantic_search|coding_memory|delete_file|rename_file|run_diagnostics|git_status|git_diff|git_commit|run_terminal)\b/gi,
    ),
  ].map((m) => m[1]!.toLowerCase());
  const nonTerminal = mentioned.filter(
    (n) =>
      n !== "run_terminal" &&
      n !== "list_dir" &&
      n !== "read_file" &&
      n !== "search_files" &&
      n !== "glob_files" &&
      n !== "find_symbol" &&
      n !== "go_to_definition" &&
      n !== "find_references" &&
      n !== "dependency_graph" &&
      n !== "semantic_search" &&
      n !== "read_docx" &&
      n !== "read_xlsx" &&
      n !== "run_diagnostics" &&
      n !== "git_status" &&
      n !== "git_diff",
  );
  return nonTerminal.length === 0;
}

export type InlineApprovalKind =
  | "terminal"
  | "write"
  | "edit"
  | "office"
  | "mkdir"
  | "plan";

export interface InlineApprovalSummary {
  kind: InlineApprovalKind;
  /** Compact toolbar label (shell / write / plan). */
  lang: string;
  /** Primary action detail shown in the monospace block. */
  detail: string;
}

function extractMutationPathFromPlanBlob(
  blob: string,
): { tool: string; path: string } | null {
  const labeled = blob.match(
    /\b(write_file|search_replace|apply_patch|write_docx|write_xlsx|patch_xlsx|mkdir|delete_file|rename_file|git_commit)\b[^\n]{0,160}?path\s*=\s*["'`]([^"'`]+)["'`]/i,
  );
  if (labeled?.[1] && labeled[2]) {
    return { tool: labeled[1].toLowerCase(), path: labeled[2].trim() };
  }
  const near = blob.match(
    /\b(write_file|search_replace|apply_patch|write_docx|write_xlsx|patch_xlsx|mkdir|delete_file|rename_file|git_commit)\b[^\n]{0,100}?[`"'“”]?([\w./\\-]+\.\w{1,10}|[\w./\\-]+\/)[`"'“”]?/i,
  );
  if (near?.[1] && near[2]) {
    return { tool: near[1].toLowerCase(), path: near[2].trim() };
  }
  return null;
}

/**
 * Cursor-like inline Allow/Stop for tool approvals (terminal + write/mutating).
 * Only when a pending plan actually needs approval — informational turns that
 * never open the plan gate show no Allow/Stop UI.
 */
export function usesInlineToolApproval(
  planText: string,
  steps: string[],
  explicitCommands?: string[] | null,
): boolean {
  if (isPrimarilyTerminalPlan(planText, steps, explicitCommands)) return true;
  const blob = `${planText}\n${steps.join("\n")}`;
  if (DISK_MUTATING_TOOL_RE.test(blob)) return true;
  if (
    (explicitCommands ?? []).some((c) => Boolean(normalizeExtractedCommand(c)))
  ) {
    return true;
  }
  if (TOOL_MENTION_RE.test(blob)) return true;
  return steps.some((s) => TOOL_MENTION_RE.test(s));
}

/** Compact primary-action summary for the inline Allow/Stop row. */
export function summarizeInlineApprovalAction(options: {
  planText: string;
  steps: string[];
  explicitCommands?: string[] | null;
}): InlineApprovalSummary {
  const { planText, steps, explicitCommands } = options;
  if (isPrimarilyTerminalPlan(planText, steps, explicitCommands)) {
    const cmds = resolveTerminalApproveCommands({
      planText,
      steps,
      explicitCommands,
    });
    return {
      kind: "terminal",
      lang: "shell",
      detail: cmds.length > 0 ? cmds.join("\n") : "",
    };
  }

  const blob = `${planText}\n${steps.join("\n")}`;
  const mutation = extractMutationPathFromPlanBlob(blob);
  if (mutation) {
    const tool = mutation.tool;
    if (tool === "write_file") {
      return { kind: "write", lang: "write", detail: mutation.path };
    }
    if (tool === "search_replace" || tool === "apply_patch") {
      return { kind: "edit", lang: "edit", detail: mutation.path };
    }
    if (tool === "write_docx" || tool === "write_xlsx") {
      return { kind: "office", lang: tool, detail: mutation.path };
    }
    if (tool === "mkdir") {
      return { kind: "mkdir", lang: "mkdir", detail: mutation.path };
    }
  }

  const compact =
    steps.length > 0
      ? steps
          .slice(0, 3)
          .map((s) => s.replace(/^\s*(?:\d+[.)]|[-*•])\s+/, "").trim())
          .filter(Boolean)
          .join("\n")
      : planText.trim().slice(0, 240);
  return { kind: "plan", lang: "plan", detail: compact };
}

/** First tool name mentioned in an approved plan, for tool_choice hints. */
export function inferPreferredToolFromPlan(
  planText: string,
  steps: string[],
): AgentToolName | null {
  const blob = `${planText}\n${steps.join("\n")}`;
  const m = blob.match(TOOL_MENTION_RE);
  if (!m?.[1]) return null;
  const name = m[1].toLowerCase();
  return TOOL_NAMES.has(name) ? (name as AgentToolName) : null;
}

/** True when the approved plan expects disk mutations (not only read/list). */
export function planMentionsMutatingTools(
  planText: string,
  steps: string[],
  projectRoot?: string | null,
): boolean {
  const blob = `${planText}\n${steps.join("\n")}`;
  if (DISK_MUTATING_TOOL_RE.test(blob)) return true;
  if (!/\brun_terminal\b/i.test(blob)) return false;
  const cmds = extractTerminalCommandsFromPlan(blob);
  if (cmds.length === 0) return true; // unknown terminal → treat as mutating
  return cmds.some((c) => !isReadOnlyTerminalCommand(c, projectRoot));
}

/** True when plan terminal commands target paths outside the project. */
export function planMentionsOutsideProject(
  planText: string,
  steps: string[],
  projectRoot?: string | null,
): boolean {
  const blob = `${planText}\n${steps.join("\n")}`;
  const cmds = extractTerminalCommandsFromPlan(blob);
  if (cmds.length === 0) {
    return commandLeavesProject(blob, projectRoot);
  }
  return cmds.some((c) => commandLeavesProject(c, projectRoot));
}

/**
 * True when a tool call mutates the project / machine.
 * For `run_terminal`, pass the command — read-only cmds (ls/pwd/…) are not mutating.
 * Outside-project commands always count as mutating (need 权限 approval).
 */
export function isMutatingAgentTool(
  tool: AgentToolName,
  command?: string | null,
  projectRoot?: string | null,
  action?: string | null,
): boolean {
  if (tool === "coding_memory") {
    return codingMemoryMutates(action ?? undefined);
  }
  if (tool === "run_terminal") {
    if (command != null && command.trim()) {
      return !isReadOnlyTerminalCommand(command, projectRoot);
    }
    return true;
  }
  return MUTATING_TOOLS.has(tool);
}

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

  // Explicit create/write of Office files must go through tools even if the
  // model omits the tool name in the plan prose.
  if (
    /创建|写入|生成|导出|保存|create|write|generate|export|make/i.test(text) &&
    /\.(xlsx|docx)\b|excel|spreadsheet|workbook|word\b|表格|工作簿/i.test(text)
  ) {
    return true;
  }

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
      /创建|写入|修改|删除|列出|阅读|搜索|运行|执行|命令|终端|create|write|edit|delete|list|read|search|run|exec|shell|terminal|npm|test/i.test(
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
    tool === "patch_xlsx" ||
    tool === "mkdir" ||
    tool === "delete_file" ||
    tool === "rename_file" ||
    tool === "git_commit" ||
    tool === "run_terminal"
  );
}

function codingMemoryMutates(action?: string): boolean {
  return (action ?? "read").trim().toLowerCase() === "append";
}

/** True when a tool cannot change the disk (safe to run in parallel). */
export function isReadOnlyAgentTool(
  tool: AgentToolName,
  command?: string,
  projectRoot?: string | null,
  action?: string,
): boolean {
  if (tool === "coding_memory") {
    return !codingMemoryMutates(action);
  }
  if (tool === "run_terminal") {
    return isReadOnlyTerminalCommand(command ?? "", projectRoot);
  }
  return !isWriteTool(tool);
}

export function batchNeedsWriteApproval(
  calls: AgentToolCall[],
  projectRoot?: string | null,
): boolean {
  return calls.some((c) => {
    if (c.tool === "coding_memory") {
      return codingMemoryMutates(c.action);
    }
    return c.tool !== "run_terminal"
      ? isWriteTool(c.tool)
      : !isReadOnlyTerminalCommand(c.command ?? "", projectRoot);
  });
}

/** System prompt appendix when a local project is bound. */
export function buildCodingToolsSystem(
  projectRoot: string,
  options?: { allowTerminal?: boolean },
): string {
  const allowTerminal = options?.allowTerminal !== false;
  const toolNames = allowTerminal
    ? "list_dir、read_file、glob_files、search_files、find_symbol、go_to_definition、find_references、dependency_graph、semantic_search、coding_memory、mkdir、write_file、search_replace、apply_patch、delete_file、rename_file、write_docx、write_xlsx、read_docx、read_xlsx、patch_xlsx、run_diagnostics、git_status、git_diff、git_commit、run_terminal"
    : "list_dir、read_file、glob_files、search_files、find_symbol、go_to_definition、find_references、dependency_graph、semantic_search、coding_memory、mkdir、write_file、search_replace、apply_patch、delete_file、rename_file、write_docx、write_xlsx、read_docx、read_xlsx、patch_xlsx、run_diagnostics、git_status、git_diff、git_commit";
  const terminalBlock = allowTerminal
    ? `
终端：
- 用户要求 run / 执行 / 运行 / shell / 终端命令（含 try to run npm test、run ls /path）→ 必须用 run_terminal，command 为用户指定的命令；禁止改用 list_dir，禁止只描述不调用
- 默认起始 cwd = 已绑定项目根（${projectRoot}），不是 sidecar 进程目录
- 用于 ls / pwd / npm test / 构建 / git status 等；stdout/stderr 过大时会截断
- 工具结果会标明 projectRoot 与 cwdAbsolute —— 据此总结，不要编造目录
- 绝对路径（ls /tmp、ls /debris、cd ~）属项目外：须等用户批准权限后再执行；禁止用 list_dir 列项目根冒充结果
- 用户追问结果时：依据上一轮 run_terminal 输出回答，或重新调用同一命令；禁止发明无关破坏性操作
`
    : "";
  return `

你已连接到本地项目：${projectRoot}

你有原生函数工具：${toolNames}。

查看项目（必须用工具，不要凭空猜目录内容）：
- 按名找文件 → glob_files（如 pattern="**/*.ts"）
- 按符号名导航 → find_symbol / go_to_definition / find_references（TS/JS）
- 依赖/影响面 → dependency_graph（可传 focus=文件路径）
- 不知道文件名时按题意找代码 → semantic_search
- 读写编码约定/失败教训 → coding_memory（action=read|append）
- 列出目录 → list_dir（项目根用 path="."）——仅当用户要看项目内目录且未要求 shell/run/绝对路径 ls 时
- 用户要「执行 shell / 终端 / run 命令」或带绝对路径的 ls → run_terminal，不要用 list_dir 顶替
- 全文搜索 → search_files（子串；正则设 regex=true；可用 glob 限文件）
- 阅读文件 → read_file（大文件用 offset+limit）
- 已有 Word → read_docx；已有 Excel → read_xlsx
- git 状态/差异 → git_status / git_diff

写入：
- 新建纯文本 → write_file（结果含 diff）
- 修改已有文本 → 优先 search_replace / apply_patch
- 删除/重命名 → delete_file / rename_file
- Word 新建 → write_docx；Excel 新建 → write_xlsx；改已有单元格 → patch_xlsx
- TypeScript/JavaScript 改完后系统可能自动跑诊断并把错误喂回；仍可主动 run_diagnostics
- 提交 → git_commit（必须 message + paths，禁止 add -A / push）
${terminalBlock}
只把内容写在 Markdown 里不会写入磁盘。
路径一律用相对项目根的相对路径，不要用 /Users/... 这类绝对路径（run_terminal 的 command 内除外）。
write_file 的 content 必须是完整文件内容；search_replace 的 old_string 必须与文件中原文完全一致。

多轮工作流（一次用户消息内可循环多轮）：
1. 依据用户【最新一条】明确意图决定是否需要工具；只要示例/「写一段代码」/解释 → 直接 Markdown 回答，不要 write_file；意图不清则先回答/澄清，不要擅自改文件或列目录；不要继续执行历史里未完成的旧任务，除非用户明确要求
2. 仅当用户明确要求改仓库或跑命令时 → 只调用完成该意图所必需的工具（不要先写长计划代替执行；若要跑命令则立刻 tool_calls run_terminal）
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

/** Extra planning hint for Word/Excel creation intents. */
export function buildMinimalOfficePlanHint(
  intent: { tool: "write_docx" | "write_xlsx"; path: string },
  locale: Locale,
): string {
  if (locale === "zh") {
    return intent.tool === "write_xlsx"
      ? `用户明确要求创建 Excel "${intent.path}"。计划中只需 write_xlsx（path="${intent.path}"，rows 为二维数组）；禁止用 write_file；不要添加 list_dir 等验证步骤；禁止在计划阶段声称文件已写入磁盘。`
      : `用户明确要求创建 Word "${intent.path}"。计划中只需 write_docx（path="${intent.path}"，paragraphs 为段落数组）；禁止用 write_file；不要添加 list_dir 等验证步骤；禁止在计划阶段声称文件已写入磁盘。`;
  }
  return intent.tool === "write_xlsx"
    ? `The user clearly asked to create Excel "${intent.path}". The plan should only need write_xlsx (path="${intent.path}", rows as a 2D array); do not use write_file; do not add list_dir verification; do not claim the file is already on disk.`
    : `The user clearly asked to create Word "${intent.path}". The plan should only need write_docx (path="${intent.path}", paragraphs array); do not use write_file; do not add list_dir verification; do not claim the file is already on disk.`;
}

/** Compare project-relative paths (case-insensitive on the final segment). */
export function pathsMatch(
  a: string | undefined | null,
  b: string | undefined | null,
  projectRoot?: string | null,
): boolean {
  if (!a || !b) return false;
  const na = normalizeRelPath(a, projectRoot).replace(/\\/g, "/").toLowerCase();
  const nb = normalizeRelPath(b, projectRoot).replace(/\\/g, "/").toLowerCase();
  return na === nb && na !== "." && na !== "";
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
    // Best-effort rows recovery when args JSON is truncated/malformed
    const rowsKey = /"rows"\s*:\s*/.exec(tc.function.arguments);
    if (rowsKey && rowsKey.index !== undefined) {
      const from = rowsKey.index + rowsKey[0].length;
      const slice = extractBalancedJsonArray(tc.function.arguments, from);
      if (slice) {
        try {
          const parsed = JSON.parse(slice) as unknown;
          if (Array.isArray(parsed)) args.rows = parsed;
        } catch {
          // ignore
        }
      }
    }
    const paragraphsKey = /"paragraphs"\s*:\s*/.exec(tc.function.arguments);
    if (paragraphsKey && paragraphsKey.index !== undefined) {
      const from = paragraphsKey.index + paragraphsKey[0].length;
      const slice = extractBalancedJsonArray(tc.function.arguments, from);
      if (slice) {
        try {
          const parsed = JSON.parse(slice) as unknown;
          if (Array.isArray(parsed)) args.paragraphs = parsed;
        } catch {
          // ignore
        }
      }
    }
  }

  return {
    tool: name as AgentToolName,
    path:
      typeof args.path === "string" ? normalizeRelPath(args.path) : undefined,
    content: typeof args.content === "string" ? args.content : undefined,
    query: typeof args.query === "string" ? args.query : undefined,
    name: typeof args.name === "string" ? args.name : undefined,
    focus: typeof args.focus === "string" ? args.focus : undefined,
    action: typeof args.action === "string" ? args.action : undefined,
    note: typeof args.note === "string" ? args.note : undefined,
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
    command: typeof args.command === "string" ? args.command : undefined,
    cwd:
      typeof args.cwd === "string" ? normalizeRelPath(args.cwd) : undefined,
    timeoutMs:
      typeof args.timeoutMs === "number" && Number.isFinite(args.timeoutMs)
        ? args.timeoutMs
        : undefined,
    offset:
      typeof args.offset === "number" && Number.isFinite(args.offset)
        ? args.offset
        : undefined,
    limit:
      typeof args.limit === "number" && Number.isFinite(args.limit)
        ? args.limit
        : undefined,
    pattern: typeof args.pattern === "string" ? args.pattern : undefined,
    regex: typeof args.regex === "boolean" ? args.regex : undefined,
    glob: typeof args.glob === "string" ? args.glob : undefined,
    from:
      typeof args.from === "string" ? normalizeRelPath(args.from) : undefined,
    to: typeof args.to === "string" ? normalizeRelPath(args.to) : undefined,
    message: typeof args.message === "string" ? args.message : undefined,
    paths: Array.isArray(args.paths)
      ? args.paths.map((p) => normalizeRelPath(String(p ?? "")))
      : undefined,
    cells: Array.isArray(args.cells)
      ? args.cells
          .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
          .map((c) => ({
            row: Number(c.row ?? c.r),
            col: Number(c.col ?? c.c),
            value: (c.value ?? null) as SpreadsheetCell,
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
      command: typeof obj.command === "string" ? obj.command : undefined,
      cwd: typeof obj.cwd === "string" ? obj.cwd : undefined,
      timeoutMs:
        typeof obj.timeoutMs === "number" && Number.isFinite(obj.timeoutMs)
          ? obj.timeoutMs
          : undefined,
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
  // DSML may appear in content and/or reasoning (DeepSeek thinking models).
  const dsmlPool = assistantCtx;
  const dsml = parseDsmlToolCalls(dsmlPool);
  if (dsml.length > 0) return dsml;
  const explicit = parseToolCalls(text);
  if (explicit.length > 0) return explicit;
  const jsonStyle = parseJsonStyleToolCalls(text);
  if (jsonStyle.length > 0) return jsonStyle;
  const argsOnly = parseArgsOnlyToolCalls(text, userText, assistantCtx);
  if (argsOnly.length > 0) return argsOnly;
  return extractWriteIntentsFromMarkdown(text);
}

/**
 * DeepSeek V3.2/V4 DSML tool markup that some APIs emit in assistant *content*
 * instead of native OpenAI `tool_calls`.
 *
 * @example
 * ```
 * <｜DSML｜tool_calls>
 * <｜DSML｜invoke name="search_replace">
 * <｜DSML｜parameter name="path" string="true">math.js</｜DSML｜parameter>
 * <｜DSML｜parameter name="old_string" string="true">a + b</｜DSML｜parameter>
 * <｜DSML｜parameter name="new_string" string="true">a * b</｜DSML｜parameter>
 * </｜DSML｜invoke>
 * </｜DSML｜tool_calls>
 * ```
 */
// DeepSeek usually emits a single fullwidth `｜` (U+FF5C). Some streams /
// gateways double it (`｜｜DSML｜｜…`); also accept ASCII `|` / `||`.
const DSML_SEP = String.raw`(?:｜{1,4}|\|{1,4})`;
const DSML_TAG = String.raw`<\/?${DSML_SEP}DSML${DSML_SEP}`;

function stripDsmlMarkup(text: string): string {
  if (!text || !/DSML/i.test(text)) return text;
  let out = text;
  // Complete or truncated wrapper blocks (tool_calls / function_calls).
  out = out.replace(
    new RegExp(
      `${DSML_TAG}(?:tool_calls|function_calls)>\\s*[\\s\\S]*?(?:${DSML_TAG}(?:tool_calls|function_calls)>|$)`,
      "gi",
    ),
    "",
  );
  // Orphan invoke / parameter fragments if wrapper strip missed them.
  out = out.replace(
    new RegExp(
      `${DSML_TAG}invoke\\b[\\s\\S]*?(?:${DSML_TAG}invoke>|$)`,
      "gi",
    ),
    "",
  );
  out = out.replace(
    new RegExp(
      `${DSML_TAG}parameter\\b[\\s\\S]*?(?:${DSML_TAG}parameter>|$)`,
      "gi",
    ),
    "",
  );
  out = out.replace(new RegExp(`${DSML_TAG}[^>]*>`, "gi"), "");
  return out;
}

function parseDsmlParameterValue(
  raw: string,
  isString: boolean,
): unknown {
  if (isString) return raw;
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return raw;
  }
}

function agentCallFromDsmlInvoke(
  name: string,
  args: Record<string, unknown>,
): AgentToolCall | null {
  if (!TOOL_NAMES.has(name)) return null;
  // Nested `{ arguments: {...} }` sometimes appears; unwrap.
  let shaped = args;
  const nested = args.arguments ?? args.parameters ?? args.args;
  if (
    nested &&
    typeof nested === "object" &&
    !Array.isArray(nested) &&
    Object.keys(args).every((k) =>
      ["arguments", "parameters", "args"].includes(k),
    )
  ) {
    shaped = nested as Record<string, unknown>;
  }
  const fake: ToolCall = {
    id: "dsml-fallback",
    type: "function",
    function: { name, arguments: JSON.stringify(shaped) },
  };
  return agentCallFromOpenAI(fake);
}

/** Parse DeepSeek DSML tool_calls / function_calls blocks into AgentToolCalls. */
export function parseDsmlToolCalls(text: string): AgentToolCall[] {
  if (!text || !/DSML/i.test(text)) return [];

  const calls: AgentToolCall[] = [];
  const seen = new Set<string>();

  const push = (call: AgentToolCall | null) => {
    if (!call) return;
    const key = `${call.tool}:${call.path ?? ""}:${call.query ?? ""}:${call.command ?? ""}:${call.old_string ?? ""}:${call.new_string ?? ""}:${typeof call.content === "string" ? call.content.slice(0, 80) : ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    calls.push(call);
  };

  const invokeRe = new RegExp(
    `${DSML_TAG}invoke\\s+name="([^"]+)"\\s*>([\\s\\S]*?)(?:${DSML_TAG}invoke>|$)`,
    "gi",
  );
  let im: RegExpExecArray | null;
  while ((im = invokeRe.exec(text)) !== null) {
    const name = (im[1] ?? "").trim();
    const body = im[2] ?? "";
    if (!name || !TOOL_NAMES.has(name)) continue;

    const args: Record<string, unknown> = {};
    const paramRe = new RegExp(
      `${DSML_TAG}parameter\\s+name="([^"]+)"(?:\\s+string="(true|false)")?\\s*>([\\s\\S]*?)${DSML_TAG}parameter>`,
      "gi",
    );
    let pm: RegExpExecArray | null;
    let foundParam = false;
    while ((pm = paramRe.exec(body)) !== null) {
      foundParam = true;
      const pName = (pm[1] ?? "").trim();
      if (!pName) continue;
      const isString = (pm[2] ?? "true").toLowerCase() !== "false";
      args[pName] = parseDsmlParameterValue(pm[3] ?? "", isString);
    }

    if (!foundParam) {
      // Some emitters put a JSON object directly inside invoke.
      const jsonBody = body
        .replace(new RegExp(`${DSML_TAG}[^>]*>`, "gi"), "")
        .trim();
      if (jsonBody.startsWith("{")) {
        try {
          const obj = JSON.parse(jsonBody) as unknown;
          if (obj && typeof obj === "object" && !Array.isArray(obj)) {
            Object.assign(args, obj as Record<string, unknown>);
          }
        } catch {
          // ignore
        }
      }
    }

    push(agentCallFromDsmlInvoke(name, args));
  }

  return calls;
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

/** Extract a balanced JSON array starting at/after `start` (first `[`). */
function extractBalancedJsonArray(s: string, start: number): string | null {
  let i = start;
  while (i < s.length && /\s/.test(s[i]!)) i += 1;
  if (s[i] !== "[") return null;
  const arrayStart = i;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (; i < s.length; i++) {
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
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return s.slice(arrayStart, i + 1);
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
    typeof o.command === "string" ||
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
  const command =
    typeof obj.command === "string" ? obj.command.trim() : undefined;
  const ctx = `${userText}\n${assistantText}`;

  if (/run_terminal\b/i.test(assistantText) && command) return "run_terminal";
  if (/glob_files\b/i.test(assistantText) && (query || typeof obj.pattern === "string"))
    return "glob_files";
  if (
    /find_symbol\b/i.test(assistantText) &&
    (typeof obj.name === "string" || query)
  )
    return "find_symbol";
  if (
    /go_to_definition\b/i.test(assistantText) &&
    (typeof obj.name === "string" || query)
  )
    return "go_to_definition";
  if (
    /find_references\b/i.test(assistantText) &&
    (typeof obj.name === "string" || query)
  )
    return "find_references";
  if (/dependency_graph\b/i.test(assistantText)) return "dependency_graph";
  if (/semantic_search\b/i.test(assistantText) && query) return "semantic_search";
  if (/coding_memory\b/i.test(assistantText)) return "coding_memory";
  if (/delete_file\b/i.test(assistantText) && path) return "delete_file";
  if (/rename_file\b/i.test(assistantText) && path) return "rename_file";
  if (/read_docx\b/i.test(assistantText) && path) return "read_docx";
  if (/read_xlsx\b/i.test(assistantText) && path) return "read_xlsx";
  if (/patch_xlsx\b/i.test(assistantText) && path) return "patch_xlsx";
  if (/git_status\b/i.test(assistantText)) return "git_status";
  if (/git_diff\b/i.test(assistantText)) return "git_diff";
  if (/git_commit\b/i.test(assistantText)) return "git_commit";
  if (/run_diagnostics\b/i.test(assistantText)) return "run_diagnostics";
  if (/list_dir\b/i.test(assistantText) && path !== undefined) return "list_dir";
  if (/read_file\b/i.test(assistantText) && path) return "read_file";
  if (/write_docx\b/i.test(assistantText) && path) return "write_docx";
  if (/write_xlsx\b/i.test(assistantText) && path) return "write_xlsx";
  if (/search_files\b/i.test(assistantText) && query) return "search_files";
  if (/search_replace\b/i.test(assistantText) && path) return "search_replace";
  if (/apply_patch\b/i.test(assistantText) && path) return "apply_patch";
  if (/write_file\b/i.test(assistantText) && path) return "write_file";
  if (/mkdir\b/i.test(assistantText) && path) return "mkdir";

  if (command) return "run_terminal";
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
  if (
    typeof obj.name === "string" &&
    (tool === "find_symbol" ||
      tool === "go_to_definition" ||
      tool === "find_references")
  ) {
    call.name = obj.name.trim();
  }
  if (typeof obj.focus === "string") call.focus = obj.focus.trim();
  if (typeof obj.action === "string") call.action = obj.action.trim();
  if (typeof obj.note === "string") call.note = obj.note;
  if (typeof obj.title === "string") call.title = obj.title;
  if (typeof obj.content === "string") call.content = obj.content;
  if (typeof obj.old_string === "string") call.old_string = obj.old_string;
  if (typeof obj.new_string === "string") call.new_string = obj.new_string;
  if (typeof obj.replace_all === "boolean") call.replace_all = obj.replace_all;
  if (typeof obj.command === "string") call.command = obj.command;
  if (typeof obj.cwd === "string") call.cwd = normalizeRelPath(obj.cwd);
  if (typeof obj.timeoutMs === "number" && Number.isFinite(obj.timeoutMs)) {
    call.timeoutMs = obj.timeoutMs;
  }
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
  if (typeof obj.pattern === "string") call.pattern = obj.pattern;
  if (typeof obj.regex === "boolean") call.regex = obj.regex;
  if (typeof obj.glob === "string") call.glob = obj.glob;
  if (typeof obj.from === "string") call.from = normalizeRelPath(obj.from);
  if (typeof obj.to === "string") call.to = normalizeRelPath(obj.to);
  if (typeof obj.message === "string") call.message = obj.message;
  if (typeof obj.offset === "number") call.offset = obj.offset;
  if (typeof obj.limit === "number") call.limit = obj.limit;
  if (Array.isArray(obj.paths)) {
    call.paths = obj.paths.map((p) => normalizeRelPath(String(p ?? "")));
  }
  if (Array.isArray(obj.cells)) {
    call.cells = obj.cells as AgentToolCall["cells"];
  }
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
    const key = `${call.tool}:${call.path ?? ""}:${call.query ?? ""}:${call.command ?? ""}`;
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

/**
 * Soft signal: phrasing that usually wants a chat sample (Markdown fence),
 * not a forced write_file. Does **not** hard-block tools in runAgentTurn —
 * only softens create/shell/mutation heuristics. Explicit create/save/path
 * phrasing wins via {@link hasExplicitRepoActionSignal}.
 */
export function isAnswerOnlySampleCodeRequest(userText: string): boolean {
  const t = userText.trim();
  if (!t) return false;
  if (hasExplicitRepoActionSignal(t)) return false;
  // Named file + create/write-into-project verb → not a chat snippet
  if (
    /\b[\w./\\-]+\.\w{1,10}\b/.test(t) &&
    /(?:创建|新建|生成|保存到|保存为|写入|写进|写到|在项目|create\s+(?:a\s+)?file|save\s+(?:it\s+)?to|write\s+(?:it\s+)?to)/i.test(
      t,
    )
  ) {
    return false;
  }
  return /随便(?:给我|帮我)?写|写一段(?:代码)?|写段(?:代码)?|写点(?:代码)?|写个(?:示例|例子|demo)|给我一段|给一段|一段(?:代码|python|js|ts|tsx|javascript|typescript|go|rust|java)|示例代码|代码示例|sample\s+code|code\s+snippet|show\s+me\s+(?:some\s+|a\s+)?(?:sample\s+)?code|write\s+(?:me\s+)?(?:some\s+|a\s+)?(?:piece\s+of\s+|bit\s+of\s+)?code|write\s+(?:me\s+)?(?:some\s+|a\s+)?(?:python|javascript|typescript|js|ts|go|rust|java)\b/i.test(
    t,
  );
}

/**
 * Soft signal: user wants a diagram drawn in chat (Mermaid/PlantUML/「画图」),
 * not repo exploration. Overridden by {@link hasExplicitRepoActionSignal}.
 * Project-grounded phrasing (「本项目架构图」) is excluded so tools can still run.
 */
export function looksLikeChatDiagramRequest(userText: string): boolean {
  const t = userText.trim();
  if (!t) return false;
  if (hasExplicitRepoActionSignal(t)) return false;
  if (looksLikeProjectGroundedAsk(t)) return false;
  return /mermaid|plantuml|\bpuml\b|流程图|时序图|序列图|类图|状态图|甘特图|思维导图|架构图|画(?:一)?(?:个|张)?(?:mermaid|plantuml)?(?:图|diagram)?|随便画|画一下|画个图|画张图|画图|diagram|flowchart|sequence\s*diagram|class\s*diagram|draw\s+(?:me\s+)?(?:a\s+)?(?:diagram|graph|chart|flowchart)|(?:generate|make|create)\s+(?:me\s+)?(?:a\s+)?(?:mermaid|plantuml|diagram|flowchart)/i.test(
    t,
  );
}

/** Asks that need the bound project (keep tools / memory available). */
export function looksLikeProjectGroundedAsk(userText: string): boolean {
  const t = userText.trim();
  if (!t) return false;
  return /(?:本|此|该|当前)?项目(?:的|里|中)?|仓库|代码库|codebase|this\s+(?:repo|project|codebase)|our\s+(?:code|project|repo|codebase)|基于(?:现有)?(?:代码|项目|仓库)|根据(?:现有)?(?:代码|项目|仓库)|from\s+(?:the\s+)?(?:repo|codebase|project)/i.test(
    t,
  );
}

/**
 * Hard chat-only artifact: answer in Markdown (e.g. ```mermaid); runAgentTurn
 * should disable native tools and omit project memory pack for this turn.
 */
export function isChatOnlyDiagramAsk(userText: string): boolean {
  return looksLikeChatDiagramRequest(userText);
}

/**
 * Soft signal: sample-code / conceptual Q&A / chat diagrams — prefer chat
 * (Markdown fence); do not treat as create/write-to-disk heuristics. Overridden
 * by {@link hasExplicitRepoActionSignal}. Chat-diagram asks additionally use a
 * hard zero-tools gate via {@link isChatOnlyDiagramAsk}.
 */
export function looksLikeAnswerOnlyRequest(userText: string): boolean {
  const t = userText.trim();
  if (!t) return false;
  if (hasExplicitRepoActionSignal(t)) return false;
  if (isAnswerOnlySampleCodeRequest(t)) return true;
  if (looksLikeChatDiagramRequest(t)) return true;
  return /写一段|写段(?:代码)?|写个(?:示例|例子|demo)|写点(?:代码)?|随便(?:给我)?写|给我一段|给一段|一段(?:代码|python|js|ts|tsx|javascript|typescript|go|rust|java)|示例(?:代码)?|代码示例|举例|怎么(?:写|实现)|如何(?:写|实现)|什么是|解释一下|sample\s+code|an?\s+example|code\s+snippet|show\s+me\s+(?:some\s+)?code|write\s+(?:me\s+)?(?:some\s+|a\s+)?(?:piece\s+of\s+|bit\s+of\s+)?code|\bhow\s+(?:do\s+i|to)\b|\bwhat\s+is\b|\bexplain\b/i.test(
    t,
  );
}

/**
 * Clear signals the user wants disk/shell/project changes (not a chat sample).
 */
export function hasExplicitRepoActionSignal(userText: string): boolean {
  const t = userText.trim();
  if (!t) return false;
  if (
    /创建文件|写入|写进|写到|保存到|保存为|放到|在项目(?:里|中)|实现到|改一下|改下|修改|删除|覆盖|新建|mkdir|write_file|search_replace|apply_patch|write_docx|write_xlsx|delete_file|rename_file|patch_xlsx|git_commit|\brm\b|\bmv\b|\bcp\b|npm\s+i(?:nstall)?\b|pnpm\s+i(?:nstall)?\b|yarn\s+add\b|create\s+(?:a\s+)?(?:new\s+)?file|save\s+(?:it\s+)?to|write\s+(?:it\s+)?to|implement\s+in\b|edit\s+(?:the\s+)?file|delete\s+(?:the\s+)?file|remove\s+(?:the\s+)?file/i.test(
      t,
    )
  ) {
    return true;
  }
  // Named file with create/write-into-project phrasing: 创建 hello.py / 写一个 foo.ts
  if (
    /(?:创建|新建|生成|写(?:一个|个)?|新增|添加|建立|保存)\s*(?:一个|个)?(?:文件|源文件|代码文件)?\s*[：:\s]*[`"'“”]?[\w./\\-]+\.\w{1,10}/i.test(
      t,
    ) ||
    /(?:create|generate|write|add|make)\s+(?:a\s+)?(?:new\s+)?(?:file\s+)?[`"'“”]?[\w./\\-]+\.\w{1,10}/i.test(
      t,
    )
  ) {
    return true;
  }
  // Explicit project-relative path (src/foo.ts) usually means repo work
  if (/(?:^|[\s`'“”])(?:src|lib|app|pages|components|scripts|tests?|docs?)\/[\w./\\-]+\.\w{1,10}\b/i.test(t)) {
    return true;
  }
  return false;
}

/** Detect Word/Excel creation intents (dedicated tools, not write_file). */
export function inferOfficeCreateIntent(
  userText: string,
): { tool: "write_docx" | "write_xlsx"; path: string } | null {
  const t = userText.trim();
  if (!t) return null;
  if (isAnswerOnlySampleCodeRequest(t) || looksLikeAnswerOnlyRequest(t)) {
    return null;
  }

  const wantsCreate =
    /创建|生成|新建|做|导出|保存|写入|写进|写到|create|generate|make|export|write\s+to/i.test(
      t,
    );

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
 * Force office writes onto the inferred path and fill missing payload so a
 * truncated/wrong-path tool call cannot be reported as "main.xlsx created"
 * when only workbook.xlsx (or nothing) was written.
 */
export function alignOfficeToolCall(
  call: AgentToolCall,
  intent: { tool: "write_docx" | "write_xlsx"; path: string },
  userText: string,
): AgentToolCall {
  if (call.tool !== intent.tool) return call;
  const synth = synthesizeOfficeFromIntent(intent, userText);
  const next: AgentToolCall = { ...call, path: intent.path };
  if (intent.tool === "write_xlsx") {
    if (!next.rows || next.rows.length === 0) {
      next.rows = synth.rows;
    }
  } else if (!next.paragraphs) {
    next.paragraphs = synth.paragraphs;
  }
  return next;
}

/**
 * Detect "看看当前目录有什么 / 读一下某文件" explore intents.
 * Never steals explicit shell / absolute-path listing — those belong to run_terminal.
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
  if (isAnswerOnlySampleCodeRequest(t)) return null;

  // Shell / terminal wording or absolute-path ls → not list_dir of project root.
  if (
    /(?:(?:please|pls|try\s+to|can\s+you|could\s+you)\s+)?(?:run|execute|exec)\b/i.test(
      t,
    ) ||
    /(?:在终端|用终端|用 shell|via shell|in (?:the )?terminal|run_terminal)/i.test(
      t,
    ) ||
    /(?:执行|运行|跑)\s*(?:一下)?\s*(?:shell|bash|zsh|sh|终端|命令行)?\s*命令/i.test(
      t,
    ) ||
    /\bls\s+(?:\/|~|[A-Za-z]:)/i.test(t) ||
    /^(?:ls|pwd)(?:\s|$)/i.test(t)
  ) {
    return null;
  }

  const wantsList =
    /列出|罗列|有哪些|有什么文件|目录|文件夹|项目结构|树形|list\s+(files|dir|directory)|what('s| is) in|show\s+(me\s+)?(the\s+)?(files|dir|directory|folder|tree)|当前(目录|文件夹|项目)/i.test(
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

  // Do not let bare English "search" eat tool names like search_replace /
  // search_files (that produced mangled queries like "_replace 修改 math.js…").
  const searchQ = t.match(
    /(?:搜索|查找|找一下|全文搜索|(?<![\w])search(?:\s+for)?(?![\w_]))\s*[：:\s]*[`"'“”]?([^`'“”\n]{2,80})[`"'“”]?/i,
  );
  if (searchQ?.[1] && /搜索|查找|(?<![\w])search(?![\w_])/i.test(t)) {
    const query = searchQ[1].trim();
    if (!/^(?:_?(?:replace|files)\b)/i.test(query)) {
      return { kind: "search", query };
    }
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

/** True when the message also asks for writes / installs / destructive ops. */
export function looksLikeMutationRequest(userText: string): boolean {
  if (
    isAnswerOnlySampleCodeRequest(userText) ||
    looksLikeAnswerOnlyRequest(userText)
  ) {
    return false;
  }
  if (hasExplicitRepoActionSignal(userText)) return true;
  return /安装|卸载|移动|重命名|mkdir|write_file|search_replace|apply_patch|write_docx|write_xlsx|delete_file|rename_file|patch_xlsx|git_commit|\brm\b|\bmv\b|\bcp\b|npm\s+i(?:nstall)?\b|pnpm\s+i(?:nstall)?\b|yarn\s+add\b|delete|remove|install/i.test(
    userText,
  );
}

export type ShellIntent = {
  command: string;
  readOnly: boolean;
};

/** Strip leading polite / run verbs so we can parse the actual command. */
function stripRunPrefix(text: string): string {
  return text
    .trim()
    .replace(
      /^(?:(?:please|pls|try\s+to|can\s+you|could\s+you|would\s+you)\s+)*(?:run|execute|exec)\s+/i,
      "",
    )
    .replace(/^(?:请)?(?:试着|尝试)?(?:执行|运行|跑)(?:一下)?\s*/i, "")
    .trim();
}

/**
 * Whole-message (or post-run-prefix) commands we can deterministically map to
 * run_terminal — including absolute paths like `ls /debris`.
 */
const BARE_SHELL_COMMAND_RE =
  /^(?:ls(?:\s+[-\w./\\~]+)*|pwd|echo\s+.+|cat\s+\S+|head(?:\s+\S+)*|tail(?:\s+\S+)*|which\s+\S+|git\s+status|git\s+log(?:\s+.*)?|git\s+diff(?:\s+.*)?|npm\s+test|npm\s+run\s+\S+(?:\s+.*)?|npm\s+(?:ci|install|i|build|start|lint|outdated|ls|list)(?:\s+.*)?|yarn\s+\S+(?:\s+.*)?|pnpm\s+\S+(?:\s+.*)?|npx\s+\S+(?:\s+.*)?|node\s+-v|npm\s+-v|python(?:3)?\s+--version)$/i;

function shellIntentFromCommand(
  command: string,
  projectRoot?: string | null,
): ShellIntent {
  const cmd = command.trim();
  return {
    command: cmd,
    readOnly: isReadOnlyTerminalCommand(cmd, projectRoot),
  };
}

/**
 * Detect explicit shell/terminal requests. Prefer run_terminal over list_dir
 * when the user asked to run a command (even if they also say "list files").
 *
 * Captures: `try to run npm test`, `run ls /debris`, `ls /tmp`, quoted cmds.
 */
export function inferShellIntent(
  userText: string,
  projectRoot?: string | null,
): ShellIntent | null {
  const t = userText.trim();
  if (!t) return null;

  const runVerb =
    /(?:(?:please|pls|try\s+to|can\s+you|could\s+you|would\s+you)\s+)*(?:run|execute|exec)\b/i.test(
      t,
    ) ||
    // CJK verbs have no \b word-boundary; require a following token/space/quote.
    /(?:请)?(?:试着|尝试)?(?:执行|运行|跑)(?:一下)?(?:\s|[：:`"'“”])/i.test(t);

  const wantsShell =
    runVerb ||
    /(?:执行|运行|跑)\s*(?:一下)?\s*(?:shell|bash|zsh|sh|终端|命令行)?\s*命令/i.test(
      t,
    ) ||
    /(?:shell|bash|zsh|终端|命令行)\s*命令/i.test(t) ||
    /\brun_terminal\b/i.test(t) ||
    /(?:在终端|用终端|用 shell|via shell|in (?:the )?terminal|run (?:a )?shell)/i.test(
      t,
    );

  // Explicit quoted / fenced command (with or without run verb)
  const quoted =
    t.match(
      /(?:执行|运行|跑(?:一下)?|run|execute|exec)\s*[：:\s]*[`"'“”]([^`'“”\n]+)[`"'“”]/i,
    ) ||
    t.match(/[`"'“”]((?:ls|pwd|npm|git|echo|cat|head|tail)\b[^`'“”\n]*)[`"'“”]/i) ||
    t.match(/```(?:bash|sh|zsh|shell)?\s*\n?([^\n`]+)```/i);
  if (quoted?.[1]?.trim()) {
    return shellIntentFromCommand(quoted[1].trim(), projectRoot);
  }

  // Bare common commands as the whole message (incl. absolute paths)
  if (BARE_SHELL_COMMAND_RE.test(t)) {
    return shellIntentFromCommand(t, projectRoot);
  }

  // "run npm test" / "try to run ls /debris" / "执行 npm test"
  if (runVerb) {
    const rest = stripRunPrefix(t);
    if (rest && BARE_SHELL_COMMAND_RE.test(rest)) {
      return shellIntentFromCommand(rest, projectRoot);
    }
    // Free-form remainder only when it looks like a real shell invocation —
    // reject leftover Chinese prose from「执行shell命令，查看…」.
    if (
      rest &&
      rest.length <= 300 &&
      looksLikeShellCommand(rest) &&
      !/[\u4e00-\u9fff]/.test(rest)
    ) {
      return shellIntentFromCommand(rest, projectRoot);
    }
  }

  if (!wantsShell) {
    // Absolute-path listing without "run": `ls /debris`, `ls /tmp`
    const absLs = t.match(/^(ls(?:\s+-\w+)*)\s+(\/[^\s;|&]+|~(?:\/\S*)?)$/i);
    if (absLs) {
      return shellIntentFromCommand(`${absLs[1]} ${absLs[2]}`, projectRoot);
    }
    return null;
  }

  // "执行shell命令，查看当前目录下有什么" → ls
  // But prefer an explicit ls path if present: "run ls /debris" already handled above
  const lsWithPath = t.match(/\bls((?:\s+-\w+)*)\s+(\/[^\s;|&]+|~(?:\/\S*)?)/i);
  if (lsWithPath) {
    return shellIntentFromCommand(
      `ls${lsWithPath[1]} ${lsWithPath[2]}`,
      projectRoot,
    );
  }
  if (
    /(?:当前目录|目录下|文件夹|有什么|有哪些|列出|list|files?|folder)/i.test(t) ||
    /\bls\b/i.test(t)
  ) {
    return shellIntentFromCommand("ls -la", projectRoot);
  }
  if (/\bpwd\b|当前路径|工作目录/i.test(t)) {
    return shellIntentFromCommand("pwd", projectRoot);
  }
  if (/git\s*status|仓库状态/i.test(t)) {
    return shellIntentFromCommand("git status", projectRoot);
  }
  if (/npm\s+test|跑测试|运行测试/i.test(t)) {
    return shellIntentFromCommand("npm test", projectRoot);
  }

  // Generic "run a shell command" without a specific command — safe inspect default
  if (wantsShell) {
    return shellIntentFromCommand("ls -la", projectRoot);
  }

  return null;
}

/** Follow-ups that ask for the outcome of a prior shell/tool run. */
export function isShellResultFollowUp(userText: string): boolean {
  const t = userText.trim();
  if (!t || t.length > 120) return false;
  return (
    /^(?:what(?:'s|\s+is|\s+was)?\s+the\s+(?:result|output|outcome)|how\s+did\s+it\s+go|did\s+it\s+(?:work|run|finish)|any\s+(?:result|output)|结果(?:呢|是什么|如何|怎么样)?|输出(?:呢|是什么)?|跑完了吗|怎么样了|成功了吗|怎样了)\??$/i.test(
      t,
    ) || /^(?:so\s+)?(?:what|whats|what's)\s+happened\??$/i.test(t)
  );
}

/**
 * Resolve shell intent for this turn. If the user asks "what is the result?"
 * after a prior shell request that may not have completed, reuse that command
 * instead of inventing unrelated follow-ups (e.g. delete node_modules).
 */
export function resolveShellIntent(
  userText: string,
  options?: {
    projectRoot?: string | null;
    /** Prior user messages, oldest → newest (excluding the current turn). */
    priorUserTexts?: string[];
  },
): ShellIntent | null {
  if (isAnswerOnlySampleCodeRequest(userText)) return null;
  const projectRoot = options?.projectRoot;
  const direct = inferShellIntent(userText, projectRoot);
  if (direct) return direct;
  if (!isShellResultFollowUp(userText)) return null;
  const priors = options?.priorUserTexts ?? [];
  for (let i = priors.length - 1; i >= 0; i--) {
    const prev = inferShellIntent(priors[i], projectRoot);
    if (prev) return prev;
  }
  return null;
}

export function synthesizeShellToolCall(intent: ShellIntent): AgentToolCall {
  return { tool: "run_terminal", command: intent.command };
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

/**
 * Parse a single approved-plan step into a concrete tool call when args are
 * explicit enough. Skips vague "Edit foo.js" lines that lack old/new strings.
 */
export function parseApprovedPlanStep(step: string): AgentToolCall | null {
  const s = step.trim().replace(/^\s*(?:\d+[.)]|[-*•])\s+/, "");
  if (!s) return null;

  let m = s.match(
    /run_terminal\b[\s\S]*?\bcommand\s*[=:]\s*[`'“”"']?([^`'“”"'\n)]+)/i,
  );
  if (!m?.[1]) {
    m = s.match(
      /run_terminal\s*(?:\(|[:：])\s*[`'“”"']?([^`'“”"'\n)]+)/i,
    );
  }
  if (m?.[1]) {
    const command = normalizeExtractedCommand(m[1]);
    return command ? { tool: "run_terminal", command } : null;
  }

  m = s.match(
    /read_file\b[\s\S]*?\bpath\s*[=:]\s*[`'“”"']?([^`'“”"'\n),]+)/i,
  );
  if (!m?.[1]) {
    m = s.match(
      /read_file\s*(?:\(|[:：])\s*[`'“”"']?([^`'“”"'\n),]+)/i,
    );
  }
  if (m?.[1]) {
    return { tool: "read_file", path: normalizeRelPath(m[1].trim()) };
  }

  m = s.match(
    /list_dir\b[\s\S]*?\bpath\s*[=:]\s*[`'“”"']?([^`'“”"'\n),]+)/i,
  );
  if (!m?.[1]) {
    m = s.match(
      /list_dir\s*(?:\(|[:：])\s*[`'“”"']?([^`'“”"'\n),]+)/i,
    );
  }
  if (m?.[1]) {
    const path = normalizeRelPath(m[1].trim()) || ".";
    return { tool: "list_dir", path };
  }

  m = s.match(
    /search_files\b[\s\S]*?\bquery\s*[=:]\s*[`'“”"']?([^`'“”"'\n),]+)/i,
  );
  if (!m?.[1]) {
    m = s.match(
      /search_files\s*(?:\(|[:：])\s*[`'“”"']?([^`'“”"'\n),]+)/i,
    );
  }
  if (m?.[1]) {
    return { tool: "search_files", query: m[1].trim() };
  }

  m = s.match(
    /mkdir\b[\s\S]*?\bpath\s*[=:]\s*[`'“”"']?([^`'“”"'\n),]+)/i,
  );
  if (!m?.[1]) {
    m = s.match(/mkdir\s*(?:\(|[:：])\s*[`'“”"']?([^`'“”"'\n),]+)/i);
  }
  if (m?.[1]) {
    return { tool: "mkdir", path: normalizeRelPath(m[1].trim()) };
  }

  if (/\bsearch_replace\b/i.test(s)) {
    const path =
      s.match(/path\s*[=:]\s*[`'“”"']?([^`'“”"'\s,)]+)/i)?.[1]?.trim() ?? null;
    const old_string =
      s.match(/old_string\s*[=:]\s*[`'“”"']([^`'“”"']*)[`'“”"']/i)?.[1] ??
      s.match(/old_string\s*[=:]\s*`([^`]*)`/i)?.[1] ??
      null;
    const new_string =
      s.match(/new_string\s*[=:]\s*[`'“”"']([^`'“”"']*)[`'“”"']/i)?.[1] ??
      s.match(/new_string\s*[=:]\s*`([^`]*)`/i)?.[1] ??
      null;
    if (path && old_string != null && new_string != null) {
      return {
        tool: "search_replace",
        path: normalizeRelPath(path),
        old_string,
        new_string,
      };
    }
  }

  if (/\bwrite_file\b/i.test(s)) {
    const path =
      s.match(/path\s*[=:]\s*[`'“”"']?([^`'“”"'\s,)]+)/i)?.[1]?.trim() ??
      s.match(
        /write_file\s*(?:\(|[:：])\s*[`'“”"']?([^`'“”"'\n),]+)/i,
      )?.[1]?.trim() ??
      null;
    if (!path) return null;
    const content =
      s.match(/content\s*[=:]\s*"((?:\\.|[^"\\])*)"/i)?.[1] ??
      s.match(/content\s*[=:]\s*'((?:\\.|[^'\\])*)'/i)?.[1] ??
      s.match(/content\s*[=:]\s*`([^`]*)`/i)?.[1] ??
      null;
    if (content != null) {
      return {
        tool: "write_file",
        path: normalizeRelPath(path),
        content: unescapeJsonString(content),
      };
    }
    // Path-only — content may live in a nearby fence; filled in synthesize.
    return { tool: "write_file", path: normalizeRelPath(path) };
  }

  return null;
}

/** Pull write_file body from a fenced block near the path in plan prose. */
export function extractWriteContentFromPlanBlob(
  planBlob: string,
  path: string,
): string | null {
  const rel = normalizeRelPath(path);
  const base = rel.split("/").filter(Boolean).pop() || rel;
  const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const near = new RegExp(
    `(?:write_file[\\s\\S]{0,240})?(?:path\\s*[=:]\\s*)?[\`"']?${esc(rel)}[\`"']?[\\s\\S]{0,160}?\\\`\\\`\\\`(?:[\\w.+-]*)\\n([\\s\\S]*?)\\\`\\\`\\\``,
    "i",
  );
  let m = planBlob.match(near);
  if (m?.[1] != null) return m[1].replace(/\n$/, "");
  if (base !== rel) {
    const nearBase = new RegExp(
      `(?:write_file[\\s\\S]{0,240})?[\`"']?${esc(base)}[\`"']?[\\s\\S]{0,160}?\\\`\\\`\\\`(?:[\\w.+-]*)\\n([\\s\\S]*?)\\\`\\\`\\\``,
      "i",
    );
    m = planBlob.match(nearBase);
    if (m?.[1] != null) return m[1].replace(/\n$/, "");
  }
  const inline = planBlob.match(
    new RegExp(
      `write_file[\\s\\S]{0,200}?${esc(rel)}[\\s\\S]{0,80}?content\\s*[=:]\\s*"((?:\\\\.|[^"\\\\])*)"`,
      "i",
    ),
  );
  if (inline?.[1] != null) return unescapeJsonString(inline[1]);
  return null;
}

/**
 * Whether a pending model tool already covers an approved-plan tool target
 * (same tool + path/command/query). Used to gap-fill wrong explore calls.
 */
export function pendingCoversPlanTool(
  pending: ReadonlyArray<{ agent: AgentToolCall }>,
  planCall: AgentToolCall,
): boolean {
  return pending.some((p) => {
    if (p.agent.tool !== planCall.tool) return false;
    if (planCall.tool === "run_terminal") {
      return (
        (p.agent.command ?? "").trim() === (planCall.command ?? "").trim()
      );
    }
    if (planCall.tool === "search_files") {
      return (p.agent.query ?? "").trim() === (planCall.query ?? "").trim();
    }
    if (planCall.path) {
      return (
        normalizeRelPath(p.agent.path ?? "") ===
        normalizeRelPath(planCall.path)
      );
    }
    return true;
  });
}

/**
 * After Allow, if the model dumps prose instead of tool_calls, run the
 * approved steps we can parse. Conservative: only concrete args.
 */
export function synthesizeToolCallsFromApprovedPlan(options: {
  planText: string;
  steps: string[];
  commands?: string[] | null;
}): AgentToolCall[] {
  const calls: AgentToolCall[] = [];
  const seen = new Set<string>();
  const push = (call: AgentToolCall | null) => {
    if (!call) return;
    const key = `${call.tool}:${call.path ?? ""}:${call.command ?? ""}:${call.query ?? ""}:${call.old_string ?? ""}:${call.new_string ?? ""}:${call.content ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    calls.push(call);
  };

  for (const step of options.steps) {
    push(parseApprovedPlanStep(step));
  }

  // Plan prose may encode tools even when steps are short labels.
  for (const line of options.planText.split("\n")) {
    push(parseApprovedPlanStep(line));
  }

  const blob = `${options.planText}\n${options.steps.join("\n")}`;
  for (const call of calls) {
    if (
      call.tool === "write_file" &&
      call.path &&
      typeof call.content !== "string"
    ) {
      const content = extractWriteContentFromPlanBlob(blob, call.path);
      if (content != null) call.content = content;
    }
  }

  const cmds = resolveTerminalApproveCommands({
    planText: options.planText,
    steps: options.steps,
    explicitCommands: options.commands,
  });
  for (const command of cmds) {
    push({ tool: "run_terminal", command });
  }

  // Skip write_file without a body — cannot invent file contents.
  return calls.filter(
    (c) => c.tool !== "write_file" || typeof c.content === "string",
  );
}

/** Multi-step project tasks like 先列出…再读 package.json…最后改 README */
export function inferMultiStepPlan(userText: string): AgentToolCall[] {
  const t = userText.trim();
  if (!t) return [];
  if (isAnswerOnlySampleCodeRequest(t)) return [];
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
  let out = stripDsmlMarkup(text)
    .replace(TOOL_CALL_RE, "")
    .replace(TOOL_CONTENT_RE, "");

  // Plural / alternate wrappers DeepSeek sometimes dumps into visible content.
  out = out.replace(
    /<tool_calls>\s*[\s\S]*?(?:<\/tool_calls>|$)/gi,
    "",
  );
  // Truncated single tool_call (no closing tag) — common mid-stream / failed FC.
  out = out.replace(/<tool_call>\s*[\s\S]*$/gi, "");
  // XML-style invoke / parameter leftovers (with or without DSML separators).
  out = out.replace(/<\/?invoke\b[^>]*>/gi, "");
  out = out.replace(/<\/?parameter\b[^>]*>/gi, "");
  out = out.replace(
    /<invoke\b[^>]*>[\s\S]*?(?:<\/invoke>|$)/gi,
    "",
  );

  // Strip fenced JSON that is clearly a tool call dump
  out = out.replace(/```(?:json|javascript|js|txt)?\s*\n?([\s\S]*?)```/gi, (block, body) => {
    const inner = String(body ?? "").trim();
    try {
      const obj = JSON.parse(inner);
      if (looksLikeToolObject(obj) || looksLikeToolArgsObject(obj)) return "";
    } catch {
      if (/"(?:name|tool)"\s*:\s*"(?:write_xlsx|write_docx|write_file|search_replace|apply_patch|list_dir|read_file|mkdir|search_files|glob_files|find_symbol|go_to_definition|find_references|dependency_graph|semantic_search|coding_memory|delete_file|rename_file|read_docx|read_xlsx|patch_xlsx|run_diagnostics|git_status|git_diff|git_commit|run_terminal)"/.test(inner)) {
        return "";
      }
    }
    return block;
  });

  // Bare JSON tool object on its own line(s) pasted as prose (no fences).
  out = out
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t.startsWith("{") || !t.endsWith("}")) return true;
      try {
        const obj = JSON.parse(t) as unknown;
        if (looksLikeToolObject(obj) || looksLikeToolArgsObject(obj)) return false;
      } catch {
        /* keep */
      }
      return true;
    })
    .join("\n");

  return out.replace(/\n{3,}/g, "\n\n").trim();
}

const CREATE_FILE_EXT =
  String.raw`cpp|cc|cxx|c|h|hpp|hxx|py|ts|tsx|js|jsx|mjs|cjs|go|rs|java|kt|swift|md|txt|json|toml|ya?ml|css|scss|html|sh|bash|cmake|txt|sql|rs|vue|svelte`;

/**
 * Detect "帮我生成一个文件 foo.cpp" style intents.
 * Returns a project-relative path (often just the filename at repo root).
 * Sample-code asks ("写一段代码") are not create intents — see
 * {@link looksLikeAnswerOnlyRequest}.
 */
export function inferCreateFilePath(userText: string): string | null {
  const t = userText.trim();
  if (!t) return null;
  if (isAnswerOnlySampleCodeRequest(t) || looksLikeAnswerOnlyRequest(t)) {
    return null;
  }

  // Bare `写` is too broad (matches 写一段代码); require create/save-to-disk
  // verbs, or 写一个 <file.ext> / 文件 + create verb.
  const createVerb =
    /(?:生成|创建|新建|新增|添加|建立|输出|保存|写入|写进|写到|帮我生成|帮我创建|create|generate|add|make)\s*/i.test(
      t,
    ) ||
    /写(?:一个|个)(?:文件|源文件|代码文件)?\s*[：:\s]*[`"'“”]?[\w./\\-]+\./i.test(
      t,
    ) ||
    (/(?:文件|源文件|代码文件)/.test(t) &&
      /(?:生成|创建|新建|保存|写入)/i.test(t)) ||
    /(?:write|create|generate|add|make)\s+(?:a\s+)?(?:new\s+)?file\b/i.test(t) ||
    /(?:write|save)\s+(?:it\s+)?to\b/i.test(t);

  const tick = t.match(
    new RegExp(String.raw`\`([\w./\\-]+\.(?:${CREATE_FILE_EXT}))\``, "i"),
  );
  if (tick?.[1] && createVerb) return normalizeRelPath(tick[1]);

  const quoted = t.match(
    new RegExp(
      String.raw`["'“”‘’]([\w./\\-]+\.(?:${CREATE_FILE_EXT}))["'“”‘’]`,
      "i",
    ),
  );
  if (quoted?.[1] && createVerb) return normalizeRelPath(quoted[1]);

  const named = t.match(
    new RegExp(
      String.raw`(?:生成|创建|新建|写(?:一个|个)?|新增|添加|建立|输出|保存|写入|写进|写到)(?:一个|个)?(?:文件|源文件|代码文件)?\s*[：:\s]*([\w./\\-]+\.(?:${CREATE_FILE_EXT}))`,
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

function withDiffFooter(text: string, diff?: string): string {
  const d = diff?.trim();
  if (!d) return text;
  return `${text}\n\n--- diff ---\n${d}`;
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
  locale: Locale = getLocale(),
  options?: { allowTerminal?: boolean; allowOutsideProject?: boolean },
): Promise<{
  ok: boolean;
  resultText: string;
  activity: Omit<AgentActivity, "id" | "at">;
  change?: Omit<AgentFileChange, "at">;
}> {
  const allowTerminal = options?.allowTerminal !== false;
  const allowOutsideProject = Boolean(options?.allowOutsideProject);
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
          activity: { kind: "list", message: t("agent.activity.listed", { path }, locale) },
        };
      }
      case "read_file": {
        const path = normalizeRelPath(call.path?.trim() || "", projectRoot);
        if (!path || path === ".") {
          return {
            ok: false,
            resultText: "Error: path is required",
            activity: { kind: "error", message: t("agent.activity.readMissingPath", undefined, locale) },
          };
        }
        const { content, size, truncated, totalLines, startLine, endLine } =
          await readFile(path, sidecarUrl, signal, {
            offset: call.offset,
            limit: call.limit,
          });
        let resultText = content;
        if (truncated) {
          resultText += `\n\n…(truncated; totalLines=${totalLines ?? "?"}; showing ${startLine ?? 1}–${endLine ?? "?"}. Pass offset+limit to read more.)`;
        }
        return {
          ok: true,
          resultText,
          activity: {
            kind: "read",
            message: t("agent.activity.reading", { path, size }, locale),
          },
        };
      }
      case "mkdir": {
        const path = normalizeRelPath(call.path?.trim() || "", projectRoot);
        if (!path || path === ".") {
          return {
            ok: false,
            resultText: "Error: path is required",
            activity: { kind: "error", message: t("agent.activity.mkdirMissingPath", undefined, locale) },
          };
        }
        await sidecarMkdir(path, sidecarUrl, signal);
        return {
          ok: true,
          resultText: `Created directory ${path}`,
          activity: { kind: "mkdir", message: t("agent.activity.mkdir", { path }, locale) },
        };
      }
      case "write_file": {
        const path = normalizeRelPath(call.path?.trim() || "", projectRoot);
        if (!path || path === ".") {
          return {
            ok: false,
            resultText: "Error: path is required",
            activity: { kind: "error", message: t("agent.activity.writeMissingPath", undefined, locale) },
          };
        }
        if (typeof call.content !== "string") {
          return {
            ok: false,
            resultText: "Error: content is required",
            activity: { kind: "error", message: t("agent.activity.writeMissingContent", undefined, locale) },
          };
        }
        if (/\.(docx|xlsx)$/i.test(path)) {
          return {
            ok: false,
            resultText: `Error: use ${path.toLowerCase().endsWith(".docx") ? "write_docx" : "write_xlsx"} for Office files, not write_file`,
            activity: {
              kind: "error",
              message: t("agent.activity.writeOfficeBinary", undefined, locale),
            },
          };
        }
        const { size, diff } = await writeFile(
          path,
          call.content,
          sidecarUrl,
          signal,
        );
        return {
          ok: true,
          resultText: withDiffFooter(`Wrote ${path} (${size} bytes)`, diff),
          activity: { kind: "write", message: t("agent.activity.wrote", { path }, locale) },
          change: { path, size, diff },
        };
      }
      case "search_replace": {
        const path = normalizeRelPath(call.path?.trim() || "", projectRoot);
        if (!path || path === ".") {
          return {
            ok: false,
            resultText: "Error: path is required",
            activity: { kind: "error", message: t("agent.activity.replaceMissingPath", undefined, locale) },
          };
        }
        if (typeof call.old_string !== "string" || call.old_string.length === 0) {
          return {
            ok: false,
            resultText: "Error: old_string is required",
            activity: {
              kind: "error",
              message: t("agent.activity.replaceMissingOld", undefined, locale),
            },
          };
        }
        if (typeof call.new_string !== "string") {
          return {
            ok: false,
            resultText: "Error: new_string is required",
            activity: {
              kind: "error",
              message: t("agent.activity.replaceMissingNew", undefined, locale),
            },
          };
        }
        const { size, path: writtenPath, replacements, diff } = await searchReplace(
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
          resultText: withDiffFooter(
            `Updated ${writtenPath} (${replacements} replacement(s), ${size} bytes)`,
            diff,
          ),
          activity: {
            kind: "write",
            message: t("agent.activity.patched", { path: writtenPath, n: replacements }, locale),
          },
          change: { path: writtenPath, size, diff },
        };
      }
      case "apply_patch": {
        const path = normalizeRelPath(call.path?.trim() || "", projectRoot);
        if (!path || path === ".") {
          return {
            ok: false,
            resultText: "Error: path is required",
            activity: { kind: "error", message: t("agent.activity.patchMissingPath", undefined, locale) },
          };
        }
        if (!call.edits || call.edits.length === 0) {
          return {
            ok: false,
            resultText: "Error: edits must be a non-empty array",
            activity: { kind: "error", message: t("agent.activity.patchMissingEdits", undefined, locale) },
          };
        }
        const { size, path: writtenPath, edits, replacements, diff } =
          await applyPatch(path, call.edits, sidecarUrl, signal);
        return {
          ok: true,
          resultText: withDiffFooter(
            `Patched ${writtenPath} (${edits} edit(s), ${replacements} replacement(s), ${size} bytes)`,
            diff,
          ),
          activity: {
            kind: "write",
            message: t("agent.activity.patchedEdits", { path: writtenPath, edits }, locale),
          },
          change: { path: writtenPath, size, diff },
        };
      }
      case "write_docx": {
        const path = normalizeRelPath(call.path?.trim() || "", projectRoot);
        if (!path || path === ".") {
          return {
            ok: false,
            resultText: "Error: path is required",
            activity: { kind: "error", message: t("agent.activity.docxMissingPath", undefined, locale) },
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
          activity: { kind: "write", message: t("agent.activity.wrote", { path: writtenPath }, locale) },
          change: { path: writtenPath, size },
        };
      }
      case "write_xlsx": {
        const path = normalizeRelPath(call.path?.trim() || "", projectRoot);
        if (!path || path === ".") {
          return {
            ok: false,
            resultText: "Error: path is required",
            activity: { kind: "error", message: t("agent.activity.xlsxMissingPath", undefined, locale) },
          };
        }
        if (!call.rows || call.rows.length === 0) {
          return {
            ok: false,
            resultText: "Error: rows must be a non-empty 2D array",
            activity: { kind: "error", message: t("agent.activity.xlsxMissingRows", undefined, locale) },
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
          activity: { kind: "write", message: t("agent.activity.wrote", { path: writtenPath }, locale) },
          change: { path: writtenPath, size },
        };
      }
      case "search_files": {
        const query = call.query?.trim();
        if (!query) {
          return {
            ok: false,
            resultText: "Error: query is required",
            activity: { kind: "error", message: t("agent.activity.searchMissingQuery", undefined, locale) },
          };
        }
        const { hits, truncated } = await searchFiles(
          query,
          normalizeRelPath(call.path?.trim() || ".", projectRoot),
          sidecarUrl,
          signal,
          { regex: call.regex, glob: call.glob },
        );
        return {
          ok: true,
          resultText:
            formatHits(hits) + (truncated ? "\n…(truncated)" : ""),
          activity: {
            kind: "search",
            message: t("agent.activity.search", { query, n: hits.length }, locale),
          },
        };
      }
      case "glob_files": {
        const pattern = (call.pattern ?? call.query ?? "").trim();
        if (!pattern) {
          return {
            ok: false,
            resultText: "Error: pattern is required",
            activity: {
              kind: "error",
              message: t("agent.activity.globMissingPattern", undefined, locale),
            },
          };
        }
        const { matches, truncated } = await globFiles(
          pattern,
          normalizeRelPath(call.path?.trim() || ".", projectRoot),
          sidecarUrl,
          signal,
        );
        return {
          ok: true,
          resultText:
            (matches.join("\n") || "(no matches)") +
            (truncated ? "\n…(truncated)" : ""),
          activity: {
            kind: "search",
            message: t(
              "agent.activity.glob",
              { pattern, n: matches.length },
              locale,
            ),
          },
        };
      }
      case "find_symbol": {
        const name = (call.name ?? call.query ?? "").trim();
        if (!name) {
          return {
            ok: false,
            resultText: "Error: name is required",
            activity: {
              kind: "error",
              message: t("agent.activity.symbolMissingName", undefined, locale),
            },
          };
        }
        const { symbols, truncated, count } = await findSymbol(
          name,
          normalizeRelPath(call.path?.trim() || ".", projectRoot),
          sidecarUrl,
          signal,
        );
        const lines = symbols.map(
          (s) =>
            `${s.path}:${s.line} ${s.kind}${s.exported ? " export" : ""} ${s.name} — ${s.snippet}`,
        );
        return {
          ok: true,
          resultText:
            (lines.join("\n") || `(no symbols named ${name})`) +
            (truncated ? "\n…(truncated)" : ""),
          activity: {
            kind: "search",
            message: t(
              "agent.activity.findSymbol",
              { name, n: count },
              locale,
            ),
          },
        };
      }
      case "go_to_definition": {
        const name = (call.name ?? call.query ?? "").trim();
        if (!name) {
          return {
            ok: false,
            resultText: "Error: name is required",
            activity: {
              kind: "error",
              message: t("agent.activity.symbolMissingName", undefined, locale),
            },
          };
        }
        const hint = call.path?.trim()
          ? normalizeRelPath(call.path.trim(), projectRoot)
          : undefined;
        const { definition, candidates, found } = await goToDefinition(
          name,
          hint,
          sidecarUrl,
          signal,
        );
        if (!found || !definition) {
          return {
            ok: true,
            resultText: `No definition found for ${name}`,
            activity: {
              kind: "search",
              message: t(
                "agent.activity.goToDefinition",
                { name, n: 0 },
                locale,
              ),
            },
          };
        }
        const alt = candidates
          .slice(0, 8)
          .map(
            (s) =>
              `${s.path}:${s.line} ${s.kind}${s.exported ? " export" : ""} — ${s.snippet}`,
          )
          .join("\n");
        return {
          ok: true,
          resultText: `Definition: ${definition.path}:${definition.line} (${definition.kind})\n${definition.snippet}\n\nCandidates:\n${alt}`,
          activity: {
            kind: "search",
            message: t(
              "agent.activity.goToDefinition",
              { name, n: candidates.length },
              locale,
            ),
          },
        };
      }
      case "find_references": {
        const name = (call.name ?? call.query ?? "").trim();
        if (!name) {
          return {
            ok: false,
            resultText: "Error: name is required",
            activity: {
              kind: "error",
              message: t("agent.activity.symbolMissingName", undefined, locale),
            },
          };
        }
        const { references, truncated, count } = await findReferences(
          name,
          normalizeRelPath(call.path?.trim() || ".", projectRoot),
          sidecarUrl,
          signal,
        );
        const lines = references.map(
          (r) => `${r.path}:${r.line} — ${r.snippet}`,
        );
        return {
          ok: true,
          resultText:
            (lines.join("\n") || `(no references to ${name})`) +
            (truncated ? "\n…(truncated)" : ""),
          activity: {
            kind: "search",
            message: t(
              "agent.activity.findReferences",
              { name, n: count },
              locale,
            ),
          },
        };
      }
      case "dependency_graph": {
        const focus = (call.focus ?? call.query ?? "").trim() || undefined;
        const graph = await dependencyGraph(
          {
            path: normalizeRelPath(call.path?.trim() || ".", projectRoot),
            focus,
            limit: call.limit,
          },
          sidecarUrl,
          signal,
        );
        let resultText: string;
        if (graph.focus) {
          const f = graph.focus;
          const out = f.imports
            .map(
              (e) =>
                `→ ${e.resolved ?? e.to}${e.external ? " (external)" : ""} [${e.kind}@${e.line}]`,
            )
            .join("\n");
          const inn = f.importers
            .map(
              (e) =>
                `← ${e.from} imports ${e.to} [${e.kind}@${e.line}]`,
            )
            .join("\n");
          resultText = `Focus ${f.path}\nImports (${f.importCount}):\n${out || "(none)"}\n\nImporters (${f.importerCount}):\n${inn || "(none)"}`;
        } else {
          const lines = graph.edges.slice(0, 120).map((e) => {
            const target = e.external
              ? `${e.to} (external)`
              : e.resolved ?? e.to;
            return `${e.from} → ${target} [${e.kind}@${e.line}]`;
          });
          resultText =
            `files=${graph.files} edges=${graph.edgeCount}\n` +
            (lines.join("\n") || "(no edges)") +
            (graph.truncated ? "\n…(truncated)" : "");
        }
        return {
          ok: true,
          resultText,
          activity: {
            kind: "search",
            message: t(
              "agent.activity.dependencyGraph",
              { n: graph.edgeCount },
              locale,
            ),
          },
        };
      }
      case "semantic_search": {
        const query = (call.query ?? call.name ?? "").trim();
        if (!query) {
          return {
            ok: false,
            resultText: "Error: query is required",
            activity: {
              kind: "error",
              message: t("agent.activity.searchMissingQuery", undefined, locale),
            },
          };
        }
        const { hits, truncated, chunkCount } = await semanticSearch(
          query,
          {
            path: normalizeRelPath(call.path?.trim() || ".", projectRoot),
            limit: call.limit,
          },
          sidecarUrl,
          signal,
        );
        const lines = hits.map(
          (h) =>
            `${h.path}:${h.startLine}-${h.endLine} [${h.score}] ${h.title}\n${h.preview}`,
        );
        return {
          ok: true,
          resultText:
            `chunks=${chunkCount}\n` +
            (lines.join("\n\n") || "(no hits)") +
            (truncated ? "\n…(truncated)" : ""),
          activity: {
            kind: "search",
            message: t(
              "agent.activity.semanticSearch",
              { query, n: hits.length },
              locale,
            ),
          },
        };
      }
      case "coding_memory": {
        const action = (call.action ?? "read").trim().toLowerCase() || "read";
        const settings = loadSettings();
        if (action === "append") {
          const note = (call.note ?? call.content ?? call.query ?? "").trim();
          if (!note) {
            return {
              ok: false,
              resultText: "Error: note is required for coding_memory append",
              activity: {
                kind: "error",
                message: t("agent.activity.codingMemoryMissingNote", undefined, locale),
              },
            };
          }
          const { path, coding } = await appendCodingMemoryNote({
            note,
            settings,
            projectRoot,
            sidecarUrl,
            signal,
          });
          return {
            ok: true,
            resultText: `Appended to ${path}\n\n${coding}`,
            activity: {
              kind: "write",
              message: t("agent.activity.codingMemoryAppend", undefined, locale),
            },
            change: { path, size: coding.length },
          };
        }
        const pack = await loadContextMemoryPack({
          settings,
          projectRoot,
          sidecarUrl,
          signal,
        });
        const body = pack?.coding?.trim() || "(empty CODING.md)";
        const dir = resolveMemoryDir(settings);
        return {
          ok: true,
          resultText: `${dir}/${CODING_MEMORY_FILE}\n\n${body}`,
          activity: {
            kind: "read",
            message: t("agent.activity.codingMemoryRead", undefined, locale),
          },
        };
      }
      case "delete_file": {
        const path = normalizeRelPath(call.path?.trim() || "", projectRoot);
        if (!path || path === ".") {
          return {
            ok: false,
            resultText: "Error: path is required",
            activity: {
              kind: "error",
              message: t("agent.activity.deleteMissingPath", undefined, locale),
            },
          };
        }
        const { kind, size } = await deleteFile(path, sidecarUrl, signal);
        return {
          ok: true,
          resultText: `Deleted ${path} (${kind})`,
          activity: {
            kind: "write",
            message: t("agent.activity.deleted", { path }, locale),
          },
          change: { path, size: size ?? 0 },
        };
      }
      case "rename_file": {
        const from = normalizeRelPath(
          (call.from ?? call.path)?.trim() || "",
          projectRoot,
        );
        const to = normalizeRelPath(call.to?.trim() || "", projectRoot);
        if (!from || from === "." || !to || to === ".") {
          return {
            ok: false,
            resultText: "Error: from and to are required",
            activity: {
              kind: "error",
              message: t("agent.activity.renameMissingArgs", undefined, locale),
            },
          };
        }
        const { from: src, to: dest } = await renameFile(
          from,
          to,
          sidecarUrl,
          signal,
        );
        return {
          ok: true,
          resultText: `Renamed ${src} → ${dest}`,
          activity: {
            kind: "write",
            message: t("agent.activity.renamed", { from: src, to: dest }, locale),
          },
          change: { path: dest, size: 0 },
        };
      }
      case "read_docx": {
        const path = normalizeRelPath(call.path?.trim() || "", projectRoot);
        if (!path || path === ".") {
          return {
            ok: false,
            resultText: "Error: path is required",
            activity: {
              kind: "error",
              message: t("agent.activity.readDocxMissingPath", undefined, locale),
            },
          };
        }
        const { text, truncated } = await readDocx(path, sidecarUrl, signal);
        return {
          ok: true,
          resultText: truncated ? `${text}\n\n…(truncated)` : text || "(empty)",
          activity: {
            kind: "read",
            message: t("agent.activity.readDocx", { path }, locale),
          },
        };
      }
      case "read_xlsx": {
        const path = normalizeRelPath(call.path?.trim() || "", projectRoot);
        if (!path || path === ".") {
          return {
            ok: false,
            resultText: "Error: path is required",
            activity: {
              kind: "error",
              message: t("agent.activity.readXlsxMissingPath", undefined, locale),
            },
          };
        }
        const { sheets } = await readXlsx(path, sidecarUrl, signal);
        const lines = sheets.flatMap((sheet) => [
          `# ${sheet.name}`,
          ...sheet.rows.map(
            (row) => `r${row.row}: ${row.cells.join("\t")}`,
          ),
        ]);
        return {
          ok: true,
          resultText: lines.join("\n") || "(empty workbook)",
          activity: {
            kind: "read",
            message: t("agent.activity.readXlsx", { path }, locale),
          },
        };
      }
      case "patch_xlsx": {
        const path = normalizeRelPath(call.path?.trim() || "", projectRoot);
        if (!path || path === ".") {
          return {
            ok: false,
            resultText: "Error: path is required",
            activity: {
              kind: "error",
              message: t("agent.activity.patchXlsxMissingPath", undefined, locale),
            },
          };
        }
        if (!call.cells || call.cells.length === 0) {
          return {
            ok: false,
            resultText: "Error: cells must be a non-empty array",
            activity: {
              kind: "error",
              message: t("agent.activity.patchXlsxMissingCells", undefined, locale),
            },
          };
        }
        const { path: writtenPath, patched, size, sheet_name } = await patchXlsx(
          path,
          { sheet_name: call.sheet_name, cells: call.cells },
          sidecarUrl,
          signal,
        );
        return {
          ok: true,
          resultText: `Patched ${patched} cell(s) in ${writtenPath} sheet=${sheet_name} (${size} bytes)`,
          activity: {
            kind: "write",
            message: t(
              "agent.activity.patchedXlsx",
              { path: writtenPath, n: patched },
              locale,
            ),
          },
          change: { path: writtenPath, size },
        };
      }
      case "run_diagnostics": {
        const { ok, skipped, output } = await runDiagnostics(sidecarUrl, signal);
        return {
          ok,
          resultText: skipped
            ? output
            : `${ok ? "Diagnostics clean" : "Diagnostics reported issues"}\n${output}`,
          activity: {
            kind: ok ? "info" : "error",
            message: t(
              skipped
                ? "agent.activity.diagnosticsSkipped"
                : ok
                  ? "agent.activity.diagnosticsOk"
                  : "agent.activity.diagnosticsFailed",
              undefined,
              locale,
            ),
          },
        };
      }
      case "git_status": {
        const { ok, output, exitCode } = await gitStatus(sidecarUrl, signal);
        return {
          ok,
          resultText: output || "(clean)",
          activity: {
            kind: "info",
            message: t("agent.activity.gitStatus", { code: exitCode }, locale),
          },
        };
      }
      case "git_diff": {
        const rel = call.path?.trim()
          ? normalizeRelPath(call.path, projectRoot)
          : undefined;
        const { ok, output, exitCode } = await gitDiff(
          rel,
          sidecarUrl,
          signal,
        );
        return {
          ok,
          resultText: output || "(no diff)",
          activity: {
            kind: "info",
            message: t("agent.activity.gitDiff", { code: exitCode }, locale),
          },
        };
      }
      case "git_commit": {
        const message = call.message?.trim();
        const paths = (call.paths ?? [])
          .map((p) => normalizeRelPath(String(p ?? "").trim(), projectRoot))
          .filter((p) => p && p !== ".");
        if (!message) {
          return {
            ok: false,
            resultText: "Error: commit message is required",
            activity: {
              kind: "error",
              message: t("agent.activity.gitCommitMissingMessage", undefined, locale),
            },
          };
        }
        if (paths.length === 0) {
          return {
            ok: false,
            resultText: "Error: paths is required (no git add -A)",
            activity: {
              kind: "error",
              message: t("agent.activity.gitCommitMissingPaths", undefined, locale),
            },
          };
        }
        const { ok, output, exitCode } = await gitCommit(
          message,
          paths,
          sidecarUrl,
          signal,
        );
        return {
          ok,
          resultText: output || (ok ? "Committed" : "git commit failed"),
          activity: {
            kind: ok ? "write" : "error",
            message: t(
              "agent.activity.gitCommit",
              { code: exitCode, n: paths.length },
              locale,
            ),
          },
          change: ok ? { path: paths.join(", "), size: 0 } : undefined,
        };
      }
      case "run_terminal": {
        if (!allowTerminal) {
          return {
            ok: false,
            resultText:
              "Error: run_terminal is disabled in Settings → Project",
            activity: {
              kind: "error",
              message: t("agent.activity.terminalDisabled", undefined, locale),
            },
          };
        }
        const command = call.command?.trim();
        if (!command) {
          return {
            ok: false,
            resultText: "Error: command is required",
            activity: {
              kind: "error",
              message: t(
                "agent.activity.terminalMissingCommand",
                undefined,
                locale,
              ),
            },
          };
        }
        const denied = isDeniedTerminalCommand(command);
        if (denied.denied) {
          return {
            ok: false,
            resultText: `Error: ${denied.reason || "Command blocked as dangerous by terminal deny-list"}`,
            activity: {
              kind: "error",
              message: t("agent.activity.terminalDenied", undefined, locale),
            },
          };
        }
        const boundRoot = projectRoot?.trim() || null;
        if (!boundRoot) {
          return {
            ok: false,
            resultText: "Error: no project bound — open a project first",
            activity: {
              kind: "error",
              message: t("agent.activity.terminalNoProject", undefined, locale),
            },
          };
        }
        // Re-bind sidecar if another session left a stale root (wrong ls listings).
        let ensuredRoot = boundRoot;
        try {
          ensuredRoot = await ensureProjectBound(boundRoot, sidecarUrl, signal);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            ok: false,
            resultText: `Error: could not bind sidecar to project: ${msg}`,
            activity: { kind: "error", message: msg },
          };
        }
        if (commandLeavesProject(command, ensuredRoot) && !allowOutsideProject) {
          return {
            ok: false,
            resultText:
              "Error: command targets paths outside the bound project. User must approve outside-project terminal access (权限) before this can run.",
            activity: {
              kind: "error",
              message: t(
                "agent.activity.terminalOutsideDenied",
                undefined,
                locale,
              ),
            },
          };
        }
        // Always start under the project root (or a relative subdir) — never process.cwd().
        const cwdRaw = call.cwd?.trim() || ".";
        if (
          isAbsoluteOutsideProject(cwdRaw, ensuredRoot) &&
          !allowOutsideProject
        ) {
          return {
            ok: false,
            resultText:
              "Error: cwd is outside the bound project. Approve outside-project terminal access first.",
            activity: {
              kind: "error",
              message: t(
                "agent.activity.terminalOutsideDenied",
                undefined,
                locale,
              ),
            },
          };
        }
        const cwd = normalizeRelPath(cwdRaw, ensuredRoot);
        const result = await runTerminal(
          {
            command,
            cwd,
            timeoutMs: call.timeoutMs,
            expectedRoot: ensuredRoot,
            allowOutsideProject,
          },
          sidecarUrl,
          signal,
        );
        const preview =
          command.length > 80 ? `${command.slice(0, 77)}…` : command;
        const absCwd = result.cwdAbsolute || ensuredRoot;
        const absRoot = result.projectRoot || ensuredRoot;
        const parts = [
          `projectRoot=${JSON.stringify(absRoot)}`,
          `cwdAbsolute=${JSON.stringify(absCwd)}`,
          `cwd=${JSON.stringify(result.cwd)}`,
          `exitCode=${result.exitCode}`,
          result.timedOut ? "timedOut=true" : null,
          result.truncated ? "truncated=true" : null,
          "",
          "--- stdout ---",
          result.stdout || "(empty)",
          "",
          "--- stderr ---",
          result.stderr || "(empty)",
        ].filter((line) => line !== null);
        return {
          ok: result.exitCode === 0 && !result.timedOut,
          resultText: parts.join("\n"),
          activity: {
            kind: "terminal",
            message: t(
              "agent.activity.ranCommand",
              { command: preview, code: result.exitCode },
              locale,
            ),
          },
        };
      }
      default:
        return {
          ok: false,
          resultText: `Unknown tool: ${(call as AgentToolCall).tool}`,
          activity: { kind: "error", message: t("agent.activity.unknownTool", undefined, locale) },
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
    const msg = e instanceof Error ? e.message : t("agent.activity.toolFailed", undefined, locale);
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
  ok = !/^Error:/i.test(resultText),
): ChatMessage {
  const label =
    call.tool === "search_files"
      ? `search_files query=${JSON.stringify(call.query ?? "")}`
      : call.tool === "glob_files"
        ? `glob_files pattern=${JSON.stringify(call.pattern ?? call.query ?? "")}`
        : call.tool === "find_symbol" ||
            call.tool === "go_to_definition" ||
            call.tool === "find_references"
          ? `${call.tool} name=${JSON.stringify(call.name ?? call.query ?? "")}`
        : call.tool === "dependency_graph"
          ? `dependency_graph focus=${JSON.stringify(call.focus ?? call.query ?? call.path ?? ".")}`
        : call.tool === "semantic_search"
          ? `semantic_search query=${JSON.stringify(call.query ?? "")}`
        : call.tool === "coding_memory"
          ? `coding_memory action=${JSON.stringify(call.action ?? "read")}`
        : call.tool === "run_terminal"
          ? `run_terminal command=${JSON.stringify(call.command ?? "")}`
          : call.tool === "git_commit"
            ? `git_commit message=${JSON.stringify(call.message ?? "")}`
            : call.tool === "rename_file"
              ? `rename_file from=${JSON.stringify(call.from ?? call.path ?? "")} to=${JSON.stringify(call.to ?? "")}`
              : `${call.tool} path=${JSON.stringify(call.path ?? ".")}`;
  const truncated = truncateToolResultText(resultText, TOOL_RESULT_MAX_CHARS);
  const status = ok ? "成功" : "失败";
  const followUp = ok
    ? "若任务未完成请继续调用工具；若已完成请给出最终中文总结（不要再输出 tool_call）。禁止声称未成功写入的文件已创建。"
    : "工具失败，文件可能未写入磁盘。禁止向用户声称创建成功；可修正参数后重试，或如实说明失败原因。";
  return {
    role: "user",
    content: `【工具结果（${status}）：${label}】\n${truncated}\n\n${followUp}`,
  };
}

export function nativeToolResultMessage(
  toolCallId: string,
  name: string,
  resultText: string,
  ok = !/^Error:/i.test(resultText),
): ChatMessage {
  const truncated = truncateToolResultText(resultText, TOOL_RESULT_MAX_CHARS);
  const statusLine = ok
    ? "[tool status: ok]"
    : "[tool status: FAILED — do not claim the file was created]";
  const followUp = ok
    ? "\n\n(If the task is not finished, call the next tool. If done, reply with a final summary in Chinese — no more tool calls. Only claim a file exists if this result confirms a successful write.)"
    : "\n\n(Tool failed. Do NOT tell the user the file was created. Fix args and retry, or explain the failure.)";
  return {
    role: "tool",
    tool_call_id: toolCallId,
    name,
    content: `${statusLine}\n${truncated}${followUp}`,
  };
}

/** Cap for a single tool result when first appended to apiMessages. */
export const TOOL_RESULT_MAX_CHARS = 12_000;
/** Cap for older tool results before re-sending in later rounds. */
export const OLDER_TOOL_RESULT_MAX_CHARS = 4_000;
/** Keep this many most-recent tool results at the fresh cap. */
const RECENT_TOOL_RESULTS_FULL = 2;

export function truncateToolResultText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…(truncated)`;
}

function isToolResultMessage(msg: ChatMessage): boolean {
  if (msg.role === "tool") return true;
  if (msg.role !== "user" || typeof msg.content !== "string") return false;
  return (
    msg.content.startsWith("【工具结果") ||
    msg.content.startsWith("[tool status:")
  );
}

/**
 * Shrink older tool-result payloads in-place so long agent loops do not
 * re-send full dumps every round. Keeps the last few results fuller.
 */
export function shrinkPriorToolResultsInMessages(
  messages: ChatMessage[],
  options?: {
    recentKeepFull?: number;
    olderMax?: number;
  },
): void {
  const recentKeep = options?.recentKeepFull ?? RECENT_TOOL_RESULTS_FULL;
  const olderMax = options?.olderMax ?? OLDER_TOOL_RESULT_MAX_CHARS;
  const toolIndexes: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (isToolResultMessage(messages[i])) toolIndexes.push(i);
  }
  if (toolIndexes.length <= recentKeep) return;

  const shrinkUntil = toolIndexes.length - recentKeep;
  for (let k = 0; k < shrinkUntil; k++) {
    const idx = toolIndexes[k];
    const msg = messages[idx];
    if (typeof msg.content !== "string") continue;
    const next = truncateToolResultText(msg.content, olderMax);
    if (next !== msg.content) {
      messages[idx] = { ...msg, content: next };
    }
  }
}
