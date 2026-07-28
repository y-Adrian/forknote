import type {
  ArchiveSnapshot,
  ApiSettings,
  BranchNode,
  ChatMessage,
  ContextMode,
  ThreadRoot,
} from "../types";
import {
  buildArchiveContextMessages,
  messagesAfterArchive,
} from "./archive";
import { getLocale, withReplyLanguage, type Locale } from "./i18n";
import type { ChatMessage as ApiChatMessage } from "./openai";
import { annotateContentWithVerdicts } from "./points";
import {
  DEFAULT_CONTEXT_WINDOW_TURNS,
  resolveContextWindowTurns,
} from "./settings";

const ANCESTOR_ANSWER_MAX = 280;
const ANCESTOR_QUESTION_MAX = 120;
/** Per-message cap when folding older turns into the sliding-window summary. */
const WINDOW_SUMMARY_MSG_MAX = 220;
const WINDOW_SUMMARY_TOTAL_MAX = 3500;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function findBranchPath(
  nodes: BranchNode[],
  targetId: string,
  path: BranchNode[] = [],
): BranchNode[] | null {
  for (const node of nodes) {
    const next = [...path, node];
    if (node.id === targetId) return next;
    const found = findBranchPath(node.children, targetId, next);
    if (found) return found;
  }
  return null;
}

function formatBranchTurns(node: BranchNode, answerMax = ANCESTOR_ANSWER_MAX): string {
  const lines = [
    `问：${truncate(node.userQuestion, ANCESTOR_QUESTION_MAX)}`,
    `答：${truncate(
      annotateContentWithVerdicts(
        node.assistantMessage,
        node.pointVerdicts,
        node.pointDoubts,
      ),
      answerMax,
    )}`,
  ];
  for (const [i, reply] of (node.replies ?? []).entries()) {
    if (!reply.userQuestion.trim() && !reply.assistantMessage.trim()) continue;
    lines.push(
      `追问 ${i + 1}：${truncate(reply.userQuestion, ANCESTOR_QUESTION_MAX)}`,
      `答：${truncate(
        annotateContentWithVerdicts(
          reply.assistantMessage,
          reply.pointVerdicts,
          reply.pointDoubts,
        ),
        answerMax,
      )}`,
    );
  }
  return lines.join("\n");
}

function formatAncestorChain(ancestors: BranchNode[]): string {
  if (ancestors.length === 0) return "（无上级分支）";

  return ancestors
    .map((node, index) => {
      const n = index + 1;
      return [
        `【上级分支 ${n}】`,
        `选中：「${truncate(node.anchor.quotedText, 80)}」`,
        formatBranchTurns(node),
      ].join("\n");
    })
    .join("\n\n");
}

/** Shared rule so models do not pretend the thread/archive was never sent. */
export const HISTORY_CONTEXT_RULE = `会话上下文（重要）：
- 本请求里附带的历史消息（或归档开发日志）就是本会话的上下文，请当作你已掌握的先前内容。
- 用户询问「之前做了什么 / 先前结论 / 操作记录」时，必须依据这些内容概括作答。
- 禁止声称没有记忆、无法提供先前记录、看不到历史对话，或要求用户重新说明已在上下文中的事。`;

/** Point / step format shared by main chat and Clarify floats. */
export const POINT_ANSWER_FORMAT = `回答格式要求（重要）：
1. 将回答拆分为若干个可独立判断的观点或步骤，每个观点/步骤以「【N】」开头（N 为从 1 开始的编号），且【N】必须位于行首（不要写成 **【N】** 或夹在句中）。
2. 每个分点应自成一体：一个结论、一个步骤或一个判断，便于用户逐点采纳或拒绝。
3. 分点前可以有 1～2 句简短引导；不要在分点之外添加大段结论。
4. 分点数量按内容定，一般 3～8 个；简单问题可以少于 3 个。若用户主要只要一段示例代码，可用 1～2 个分点，或先给代码再简短分点说明。
5. 若用户在上下文中标记了「已拒绝」的分点，不要再基于该点展开；「已采纳✅」的分点视为已确认的事实；「用户存疑」的分点请重点回应括号内的疑问。

示例格式：
下面从三个方面分析这个问题。

【1】第一个观点……

【2】第二个观点……

【3】第三个观点……`;

export const CHAT_SYSTEM = `你是友好、准确的对话助手（无本地项目工具）。使用 Markdown。

${HISTORY_CONTEXT_RULE}

- 当前会话未绑定本地项目：不要调用或假装调用 list_dir / write_file / run_terminal 等工具；不要要求用户先打开项目才能回答普通问题。
- 用户要示例代码时，直接在回答里用 Markdown 代码围栏给出完整可运行片段即可（可附简短说明）；不要只描述「可以写个文件」而不给代码。

${POINT_ANSWER_FORMAT}`;

/** When a local project is bound, use tools only when the user wants repo work. */
export const PROJECT_CHAT_SYSTEM = `你是本地项目编程助手。请简短说明。

${HISTORY_CONTEXT_RULE}
- 不要用工具去「找回」聊天历史；工具只用于读写本地项目文件。磁盘上的文件不能代替本会话已给出的对话记录。

硬性规则：
0. 先根据实际情景与必要性判断用户【最新一条】意图。示例代码、解释概念、「写一段 / 怎么写 / 举例 / 随便写一段代码」等偏信息性请求：优先在聊天里用 Markdown 代码围栏回答，不要擅自 write_file 或为纯问答发明批准计划，不要编造路径（如 hello.py）或用 run_terminal / echo 代替贴代码。若用户随后明确要保存到项目、改文件、跑命令，或上下文显然需要读仓库，再使用工具。
1. 严格服从用户【最新一条】消息。明确要求改仓库（创建/保存/写入/实现到项目、带路径如 src/…、删除、改一下某文件）或运行/执行命令（含 run / ls / npm / shell）时，使用工具。若要求运行命令，必须调用 run_terminal，command 为该命令本身；禁止改用 list_dir，禁止只口头说「我来运行」而不发 tool_calls。
2. 用户已绑定本地项目。在确有必要查看目录/读文件/改文件/跑命令时，使用函数工具（list_dir / read_file / search_files / write_file / search_replace / apply_patch / write_docx / write_xlsx / mkdir / run_terminal）——不要在未要求改仓库时主动写文件。
3. list_dir 仅用于项目内相对路径的浏览，且用户未用 shell/run/ls 绝对路径等终端措辞时。绝对路径（如 ls /tmp、ls /debris）必须用 run_terminal，并等待项目外权限批准——禁止用 list_dir 列项目根并声称「为空」。
4. 不要猜测项目里有什么文件：先 list_dir（根目录 path="."），再 read_file。若用户明确要求用 shell/终端查看，则用 run_terminal（如 ls），不要改用 list_dir。
5. 只把代码贴在 Markdown 里不会写入磁盘；用户若只要片段，贴代码即可。
6. 路径用相对项目根的相对路径（如 soft/hello.c），不要用绝对路径（shell 命令里的绝对路径除外）。
7. 新建纯文本用 write_file；修改已有文件优先 search_replace / apply_patch；Word 用 write_docx；Excel 用 write_xlsx；跑测试/构建/shell 用 run_terminal。
8. 工具执行完后再用简短总结；可用【N】分点，但不要用分点代替工具调用。
9. 禁止在未调用工具、未收到工具结果前声称文件已创建或已写入磁盘。
10. 复杂任务分多轮：先工具、看结果、再工具；全部完成后再总结，不要第一轮只描述计划就结束。
11. 只服务用户最新一条消息的意图；不要自动继续历史里未完成的旧计划，除非用户明确要求继续。若用户追问「结果呢 / what is the result」，应基于上一轮命令的真实工具输出作答，或重新调用 run_terminal，禁止编造无关操作（如删除 node_modules）。`;

export type ConversationOptions = {
  /** When set, append coding tool instructions for the local project sidecar. */
  projectRoot?: string | null;
  codingToolsSystem?: string | null;
  /** live = full thread (default); archive = compress prior turns into a log */
  contextMode?: ContextMode;
  /** Required when contextMode === "archive" */
  activeArchive?: ArchiveSnapshot | null;
  /** UI / reply language; defaults to stored locale */
  locale?: Locale;
  /** Optional memory block appended to the system prompt */
  memoryAddendum?: string | null;
  /**
   * Live-mode sliding window size (user↔assistant turns). When omitted,
   * uses `settings` or the app default.
   */
  contextWindowTurns?: number;
  /** When false, live mode re-sends the full thread. Default true. */
  contextAutoSummary?: boolean;
  /** Preferred source for window / auto-summary defaults. */
  settings?: ApiSettings | null;
};

/** Count user messages among non-empty thread messages (= turns). */
export function countConversationTurns(messages: ChatMessage[]): number {
  return messages.filter((m) => m.role === "user" && m.content.trim()).length;
}

/**
 * Split completed main-line messages into older (to summarize) and recent
 * (kept full), keeping the last `windowTurns` user turns (+ their answers).
 */
export function splitMessagesByWindow(
  messages: ChatMessage[],
  windowTurns: number,
): { older: ChatMessage[]; recent: ChatMessage[] } {
  const completed = messages.filter((m) => m.content.trim().length > 0);
  if (windowTurns <= 0 || countConversationTurns(completed) <= windowTurns) {
    return { older: [], recent: completed };
  }

  let userTurns = 0;
  let splitAt = completed.length;
  for (let i = completed.length - 1; i >= 0; i--) {
    if (completed[i].role === "user") {
      userTurns += 1;
      if (userTurns >= windowTurns) {
        splitAt = i;
        break;
      }
    }
  }
  return {
    older: completed.slice(0, splitAt),
    recent: completed.slice(splitAt),
  };
}

/** Deterministic compact summary of older live turns (no extra LLM call). */
export function buildOlderTurnsSummary(
  older: ChatMessage[],
  locale: Locale = getLocale(),
): string {
  if (older.length === 0) return "";

  const lines: string[] = [];
  let turn = 0;
  for (const msg of older) {
    if (msg.role === "user") {
      turn += 1;
      lines.push(
        locale === "zh"
          ? `· 用户 ${turn}：${truncate(msg.content, WINDOW_SUMMARY_MSG_MAX)}`
          : `· User ${turn}: ${truncate(msg.content, WINDOW_SUMMARY_MSG_MAX)}`,
      );
      continue;
    }
    const annotated = annotateContentWithVerdicts(
      msg.content,
      msg.pointVerdicts,
      msg.pointDoubts,
    );
    lines.push(
      locale === "zh"
        ? `  助手：${truncate(annotated, WINDOW_SUMMARY_MSG_MAX)}`
        : `  Assistant: ${truncate(annotated, WINDOW_SUMMARY_MSG_MAX)}`,
    );
  }

  let body = lines.join("\n");
  if (body.length > WINDOW_SUMMARY_TOTAL_MAX) {
    body = `${body.slice(0, WINDOW_SUMMARY_TOTAL_MAX)}…`;
  }

  if (locale === "zh") {
    return [
      "【较早对话摘要 · 滑动窗口】",
      "以下为窗口外历史的压缩摘要（非全文）；与最近轮原文冲突时以最近轮为准。",
      "",
      body,
    ].join("\n");
  }
  return [
    "[Earlier conversation summary · sliding window]",
    "Compact summary of turns outside the recent window (not the full text). Prefer recent messages when they conflict.",
    "",
    body,
  ].join("\n");
}

function mapThreadMessageToApi(m: ChatMessage): ApiChatMessage {
  return {
    role: m.role as "user" | "assistant",
    content:
      m.role === "assistant"
        ? annotateContentWithVerdicts(
            m.content,
            m.pointVerdicts,
            m.pointDoubts,
          )
        : m.content,
  };
}

/** Same base system string that `buildConversationMessages` uses (incl. coding tools). */
export function conversationBaseSystem(
  options?: ConversationOptions,
): string {
  const bound = Boolean(options?.projectRoot && options.codingToolsSystem);
  const base = bound
    ? PROJECT_CHAT_SYSTEM + (options?.codingToolsSystem ?? "")
    : CHAT_SYSTEM;
  let system = withReplyLanguage(base, options?.locale ?? getLocale());
  const memory = options?.memoryAddendum?.trim();
  if (memory) {
    system = `${system.trimEnd()}\n\n${memory}`;
  }
  return system;
}

export function buildConversationMessages(
  thread: ThreadRoot,
  options?: ConversationOptions,
): ApiChatMessage[] {
  const system = conversationBaseSystem(options);
  const locale = options?.locale ?? getLocale();

  // Archive only when a concrete snapshot is supplied (same rule as resolveConversationContext)
  if (options?.contextMode === "archive" && options.activeArchive) {
    const later = messagesAfterArchive(thread, options.activeArchive);
    return buildArchiveContextMessages(
      options.activeArchive,
      later,
      system,
      locale,
    );
  }

  const completed = thread.messages.filter((m) => m.content.trim().length > 0);
  const autoSummary = options?.contextAutoSummary !== false;
  const windowTurns =
    options?.contextWindowTurns ??
    (options?.settings
      ? resolveContextWindowTurns(options.settings)
      : DEFAULT_CONTEXT_WINDOW_TURNS);

  if (autoSummary) {
    const { older, recent } = splitMessagesByWindow(completed, windowTurns);
    if (older.length > 0) {
      const summary = buildOlderTurnsSummary(older, locale);
      return [
        { role: "system", content: system },
        { role: "user", content: summary },
        {
          role: "assistant",
          content:
            locale === "zh"
              ? "已记下较早对话摘要；后续以最近轮原文为准。"
              : "Noted the earlier summary; I will prefer the recent messages below.",
        },
        ...recent.map(mapThreadMessageToApi),
      ];
    }
  }

  return [
    { role: "system", content: system },
    ...completed.map(mapThreadMessageToApi),
  ];
}

/** 追问挂载点：主对话助手消息 id，或某条分支 id */
export function resolveBranchAttachContext(
  thread: ThreadRoot,
  attachParentId: string,
): { assistantContent: string; ancestors: BranchNode[] } | null {
  for (const msg of thread.messages) {
    if (msg.role !== "assistant") continue;
    const annotated = annotateContentWithVerdicts(
      msg.content,
      msg.pointVerdicts,
      msg.pointDoubts,
    );
    if (msg.id === attachParentId) {
      return { assistantContent: annotated, ancestors: [] };
    }
    const path = findBranchPath(msg.children, attachParentId);
    if (path) {
      return { assistantContent: annotated, ancestors: path };
    }
  }
  return null;
}

/**
 * Selection-scoped Fork addendum appended after main conversation messages.
 * Clarify may use the same tools and depth as main when the user asks for
 * project work — no artificial “2–5 sentences / no tools” cap.
 */
export function buildClarifyAddendumMessages(
  thread: ThreadRoot,
  attachParentId: string,
  anchorQuoted: string,
  userQuestion: string,
  locale: Locale = getLocale(),
): ApiChatMessage[] {
  const ctx = resolveBranchAttachContext(thread, attachParentId);
  if (!ctx) {
    throw new Error("Could not resolve fork context");
  }

  const { assistantContent: parentContent, ancestors } = ctx;

  const system = withReplyLanguage(
    `你是「选中澄清」助手（Forknote）。用户对主回答中的选中片段提出了澄清问题；回答写入 Clarify 分支，不是新开主线话题。

说明：
- 优先解释选中片段与当前子问题；可引用上级澄清结论，勿整段复述主回答。
- 若用户要求查看/修改本地项目，可使用与主对话相同的工具与深度（list_dir、read_file、write_file、run_terminal 等），勿因「澄清」而拒绝工具或缩短任务。
- 纯概念澄清时保持简洁；项目任务则按任务需要完成（含计划批准后的多轮工具调用）。
- 上下文里「已拒绝」的点勿再展开；「已采纳✅」视为已确认；「用户存疑」请重点回应括号内疑问。

${POINT_ANSWER_FORMAT}`,
    locale,
  );

  const user = `【任务类型】选中澄清（Fork 分支）

【主回答（仅供定位）】
${truncate(parentContent, 900)}

【上级澄清摘要】
${formatAncestorChain(ancestors)}

【当前选中原文】
「${anchorQuoted}」

【当前子问题】
${userQuestion}

请作答。若需项目工具，请直接调用。`;

  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
}

/**
 * Same-window Fork follow-up: keep selection scope, include prior turns on this branch.
 */
export function buildClarifyContinueAddendumMessages(
  thread: ThreadRoot,
  branchId: string,
  userQuestion: string,
  locale: Locale = getLocale(),
): ApiChatMessage[] {
  const rootMsg = thread.messages.find(
    (m) =>
      m.role === "assistant" &&
      findBranchPath(m.children, branchId) != null,
  );
  if (!rootMsg) {
    throw new Error("Could not resolve fork context");
  }
  const path = findBranchPath(rootMsg.children, branchId);
  if (!path || path.length === 0) {
    throw new Error("Could not resolve fork context");
  }
  const branch = path[path.length - 1];
  const ancestors = path.slice(0, -1);
  const parentContent = rootMsg.content;

  // Exclude the in-flight empty last reply (already appended for streaming)
  const replies = branch.replies ?? [];
  const settledReplies =
    replies.length > 0 && !replies[replies.length - 1].assistantMessage.trim()
      ? replies.slice(0, -1)
      : replies;
  const historyBranch: BranchNode = {
    ...branch,
    replies: settledReplies,
  };

  const system = withReplyLanguage(
    `你是「选中澄清」助手（Forknote）。用户在同一 Clarify 浮层内追问，继续写在当前分支，不要当作新开嵌套澄清。

说明：
- 优先承接本 Clarify 已有问答；仍围绕选中片段，勿整段复述主回答。
- 若用户要求查看/修改本地项目，可使用与主对话相同的工具与深度。
- 纯概念澄清时保持简洁；项目任务则按任务需要完成。

${POINT_ANSWER_FORMAT}`,
    locale,
  );

  const user = `【任务类型】选中澄清续聊（同一 Fork 窗口）

【主回答（仅供定位）】
${truncate(parentContent, 900)}

【上级澄清摘要】
${formatAncestorChain(ancestors)}

【当前选中原文】
「${branch.anchor.quotedText}」

【本 Fork 已澄清】
${formatBranchTurns(historyBranch, 500)}

【当前追问】
${userQuestion}

请作答。若需项目工具，请直接调用。`;

  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
}

/** @deprecated Prefer buildClarifyAddendumMessages + buildConversationMessages */
export function buildBranchQuestionMessages(
  thread: ThreadRoot,
  attachParentId: string,
  anchorQuoted: string,
  userQuestion: string,
  locale: Locale = getLocale(),
) {
  return buildClarifyAddendumMessages(
    thread,
    attachParentId,
    anchorQuoted,
    userQuestion,
    locale,
  );
}
