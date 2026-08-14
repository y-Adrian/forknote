/**
 * Shared agent turn runner used by askMain and askBranch.
 * Streams into a write-target callback (main ChatMessage or Fork BranchNode).
 */
import {
  agentCallFromOpenAI,
  alignOfficeToolCall,
  buildCodingToolsSystem,
  buildExecutionPhaseSystem,
  buildMinimalCreatePlanHint,
  buildMinimalOfficePlanHint,
  buildNetworkToolsSystem,
  buildNextPlanChunkPrompt,
  buildPlanningPhaseSystem,
  collectToolCalls,
  executeToolCall,
  extractTerminalCommandsFromPlan,
  getNetworkOpenAITools,
  getProjectOpenAITools,
  inferCreateFilePath,
  inferExploreIntent,
  inferMultiStepPlan,
  inferOfficeCreateIntent,
  inferPreferredToolFromPlan,
  isMutatingAgentTool,
  isReadOnlyAgentTool,
  usesInlineToolApproval,
  limitPlanForApproval,
  isChatOnlyDiagramAsk,
  looksLikeAnswerOnlyRequest,
  looksLikeMutationRequest,
  mutationPlanNoToolsAction,
  shouldPreferPlainChatTurn,
  multiStepFollowUpHint,
  multiStepSystemHint,
  parseAgentPlan,
  pathsMatch,
  planMentionsMutatingTools,
  planMentionsOutsideProject,
  planNeedsToolApproval,
  commandLeavesProject,
  resolveShellIntent,
  synthesizeExploreToolCall,
  synthesizeOfficeFromIntent,
  synthesizeShellToolCall,
  synthesizeToolCallsFromApprovedPlan,
  pendingCoversPlanTool,
  nativeToolResultMessage,
  stripToolCalls,
  synthesizeWriteFromReply,
  toolResultMessage,
  shrinkPriorToolResultsInMessages,
  type AgentActivity,
  type AgentFileChange,
  type AgentToolCall,
  type AgentToolName,
} from "./agentTools";
import { buildConversationMessages } from "./contextBuilder";
import { buildAgentMemoryAddendum } from "./contextMemory";
import { resolveConversationContext } from "./conversationContext";
import { t, type Locale } from "./i18n";
import { createId } from "./id";
import {
  isToolsUnsupportedError,
  streamChat,
  type ChatMessage as ApiChatMessage,
  type StreamTiming,
  type ToolCall,
} from "./openai";
import { mergeReasoningChannels } from "./reasoning";
import {
  resolveAgentAllowTerminal,
  resolveAgentAutoDiagnostics,
  resolveAgentMaxRounds,
  resolveAgentRequireApproval,
} from "./settings";
import {
  batchNeedsAutoDiagnostics,
  formatAutoDiagnosticsFeedback,
} from "./agentExecFeedback";
import { toToolResult } from "./agentResult";
import {
  AgentLoopController,
  buildReflectNudge,
  parseStructuredPlanHints,
  upsertWorkingMemoryAddendum,
} from "./agentLoop";
import { buildToolSelectionDecisionEvents } from "./decisionFeedback";
import { reflectWithOptionalLlm } from "./llmReflect";
import { withAgentPhaseModel } from "./agentModelRouting";
import {
  estimateWebTaskComplexity,
  formatNetworkStatusSystem,
  resolveNetworkReachability,
} from "./networkAccess";
import { runDiagnostics } from "./sidecar";
import type { ApiSettings, ChatSession, FeedbackEvent, ThreadRoot } from "../types";

export type AgentContentPatch = {
  content?: string;
  reasoning?: string;
  thinkingSeconds?: number;
};

export type AgentTurnOutcome =
  | "completed"
  | "waiting_plan"
  | "aborted"
  | "need_project";

export type RunAgentTurnOptions = {
  llm: ApiSettings;
  settings: ApiSettings;
  locale: Locale;
  session: ChatSession | undefined;
  userText: string;
  thread: ThreadRoot;
  projectRoot: string | null;
  sidecarUrl: string;
  signal: AbortSignal;
  /** Appended after buildConversationMessages (e.g. clarify selection addendum). */
  extraMessages?: ApiChatMessage[];
  includeFiles?: string[];
  isOwned: () => boolean;
  patchContent: (patch: AgentContentPatch) => void;
  onAgentActivity: (activity: AgentActivity) => void;
  onAgentChange: (change: AgentFileChange & { at: number }) => void;
  /** Persist live-mode repair when archive id is stale. */
  onRepairContextToLive?: () => void;
  /**
   * Plan needs user approval. Caller registers `continueExecution` and shows
   * AgentPlanReview. Runner returns `waiting_plan` without clearing ownership.
   */
  onAwaitPlanApproval: (args: {
    planText: string;
    steps: string[];
    /** Exact run_terminal commands when known (preferred by Terminal card). */
    commands?: string[];
    /** Total steps before chunking (for UI “showing N of M”). */
    totalStepCount?: number;
    continueExecution: () => Promise<void>;
  }) => void;
  /**
   * Decision-bound feedback from tool batches (tool_selection observe signals).
   * Caller persists into session.feedbackLog / User Model.
   */
  onDecisionFeedback?: (events: FeedbackEvent[]) => void;
};

/** Reject when `signal` aborts so tool fetches can be interrupted promptly. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

function thinkingSecondsFromTiming(
  timing: StreamTiming,
  reasoningText: string,
): number | undefined {
  if (!reasoningText.trim()) return undefined;
  const startAt = timing.firstReasoningAt ?? timing.startedAt;
  const endAt = Math.max(
    startAt,
    timing.lastReasoningAt ?? 0,
    timing.firstVisibleContentAt ?? 0,
  );
  return Math.max(1, Math.round((endAt - startAt) / 1000));
}

/** Stream a plain chat reply with tools schema omitted (no plan / write path). */
async function streamPlainChatAnswer(args: {
  llm: ApiSettings;
  apiMessages: ApiChatMessage[];
  signal: AbortSignal;
  isOwned: () => boolean;
  patchContent: (patch: AgentContentPatch) => void;
  locale: Locale;
}): Promise<AgentTurnOutcome> {
  const { llm, apiMessages, signal, isOwned, patchContent, locale } = args;
  let apiReasoning = "";
  const patchAssistantState = (patch: AgentContentPatch) => {
    if (!isOwned() || signal.aborted) return;
    patchContent(patch);
  };

  // Keep content empty until real tokens arrive so the UI shows the typing
  // indicator (and ThinkingBlock when reasoning streams) instead of a stuck
  // "Thinking…" placeholder that looks frozen on simple asks.
  let roundText = "";
  const streamResult = await streamChat(
    llm,
    apiMessages,
    (delta) => {
      roundText += delta;
      const cleaned = stripToolCalls(roundText);
      if (cleaned.length > 0) {
        patchAssistantState({
          content: cleaned,
          ...(apiReasoning.trim() ? { reasoning: apiReasoning } : {}),
        });
      }
    },
    {
      signal,
      temperature: 0.6,
      tools: undefined,
      toolChoice: undefined,
      onReasoningDelta: (piece) => {
        apiReasoning += piece;
        if (apiReasoning.trim()) {
          patchAssistantState({ reasoning: apiReasoning });
        }
      },
    },
  );

  if (signal.aborted || !isOwned()) {
    return "aborted";
  }

  roundText = streamResult.content || roundText;
  if (streamResult.reasoning.length >= apiReasoning.length) {
    apiReasoning = streamResult.reasoning;
  }
  const merged = mergeReasoningChannels(
    apiReasoning,
    stripToolCalls(roundText),
    { expectChineseAnswer: locale === "zh" },
  );
  patchAssistantState({
    content: merged.content,
    ...(merged.reasoning.trim() ? { reasoning: merged.reasoning } : {}),
    ...(merged.reasoning.trim()
      ? {
          thinkingSeconds: thinkingSecondsFromTiming(
            streamResult.timing,
            merged.reasoning,
          ),
        }
      : {}),
  });
  return "completed";
}

export async function runAgentTurn(
  options: RunAgentTurnOptions,
): Promise<AgentTurnOutcome> {
  const {
    llm,
    settings,
    locale,
    session,
    userText,
    thread,
    projectRoot,
    sidecarUrl,
    signal,
    extraMessages,
    isOwned,
    patchContent,
    onAgentActivity,
    onAgentChange,
    onRepairContextToLive,
    onAwaitPlanApproval,
    onDecisionFeedback,
  } = options;

  const trimmed = userText.trim();
  /** Mermaid/画图 etc.: answer in chat; do not continue old project memory/tools. */
  const chatOnlyDiagramAsk = isChatOnlyDiagramAsk(trimmed);

  const planLlm = withAgentPhaseModel(llm, "plan");
  const codeLlm = withAgentPhaseModel(llm, "code");
  const summaryLlm = withAgentPhaseModel(llm, "summary");

  const agentMaxRoundsBase = resolveAgentMaxRounds(settings);
  const allowTerminal = resolveAgentAllowTerminal(settings);
  const autoDiagnostics = resolveAgentAutoDiagnostics(settings);
  const networkReach = await resolveNetworkReachability({
    settings,
    sidecarUrl,
    signal,
  });
  const allowNetworkTools = networkReach.toolsAllowed;
  const webTaskComplexity = estimateWebTaskComplexity(trimmed);
  const projectTools = getProjectOpenAITools({
    allowTerminal,
    allowNetwork: allowNetworkTools,
  });
  const networkOnlyTools = getNetworkOpenAITools();
  const resolved = resolveConversationContext(session);
  if (resolved.repairedToLive) {
    onRepairContextToLive?.();
  }

  const priorUserTexts = thread.messages
    .filter((m) => m.role === "user" && m.content.trim())
    .map((m) => m.content.trim())
    .filter((c) => c !== trimmed);

  /**
   * Resolve intents before choosing coding-tools vs plain chat. Casual questions
   * (advice / Q&A) must not enter executeTools with a project tool prompt.
   */
  const createPath = projectRoot ? inferCreateFilePath(trimmed) : null;
  const officeIntent = projectRoot ? inferOfficeCreateIntent(trimmed) : null;
  const multiStepPlan = projectRoot ? inferMultiStepPlan(trimmed) : [];
  const shellIntent =
    projectRoot && allowTerminal && !createPath && !officeIntent
      ? resolveShellIntent(trimmed, {
          projectRoot,
          priorUserTexts,
        })
      : null;
  const exploreIntent =
    projectRoot &&
    !createPath &&
    !officeIntent &&
    !shellIntent &&
    !looksLikeMutationRequest(trimmed)
      ? inferExploreIntent(trimmed)
      : null;

  const preferPlainChat =
    !projectRoot ||
    chatOnlyDiagramAsk ||
    shouldPreferPlainChatTurn(trimmed, {
      createPath,
      officeIntent,
      shellIntent,
      exploreIntent,
      multiStepPlanLength: multiStepPlan.length,
    });

  const codingToolsSystem =
    projectRoot && !preferPlainChat
      ? buildCodingToolsSystem(projectRoot, { allowTerminal })
      : preferPlainChat && allowNetworkTools
        ? buildNetworkToolsSystem(locale === "zh" ? "zh" : "en")
        : null;

  const memoryAddendum = await buildAgentMemoryAddendum({
    settings,
    query: trimmed,
    session,
    projectRoot,
    sidecarUrl,
    signal,
    includeFiles: options.includeFiles,
    omitProjectPack: preferPlainChat,
  });

  if (signal.aborted || !isOwned()) {
    return "aborted";
  }

  const apiMessages: ApiChatMessage[] = buildConversationMessages(thread, {
    projectRoot: preferPlainChat && !allowNetworkTools ? null : projectRoot,
    codingToolsSystem:
      projectRoot && !preferPlainChat
        ? codingToolsSystem
        : allowNetworkTools
          ? buildNetworkToolsSystem(locale === "zh" ? "zh" : "en")
          : codingToolsSystem,
    contextMode: resolved.mode,
    activeArchive: resolved.archive,
    locale,
    memoryAddendum,
    settings,
  });

  if (extraMessages?.length) {
    apiMessages.push(...extraMessages);
  }

  if (memoryAddendum) {
    apiMessages.push({
      role: "system",
      content:
        locale === "zh"
          ? "上方记忆包仅为背景参考。本轮目标必须依据用户【最新一条】消息；除非用户明确要求继续，否则禁止自动续做记忆/历史中的旧构建、验证或未完成计划。"
          : "Memory above is background only. Ground this turn in the user's LATEST message; do not auto-continue old build/verify/unfinished plans from memory or history unless the user explicitly asks to continue.",
    });
  }

  apiMessages.push({
    role: "system",
    content: formatNetworkStatusSystem(
      networkReach,
      locale === "zh" ? "zh" : "en",
    ),
  });

  /**
   * Plain chat: no coding-tools system, no executeTools.
   * Covers Mermaid/draw asks and ordinary Q&A without a clear "do work" signal.
   * Exception: when Network is on and reachable, keep a light tool loop for
   * web_search / web_fetch only.
   */
  if (preferPlainChat && (!allowNetworkTools || chatOnlyDiagramAsk)) {
    apiMessages.push({
      role: "system",
      content:
        locale === "zh"
          ? chatOnlyDiagramAsk
            ? "用户最新消息是聊天内绘图/示意图请求（如「随便画个图」、流程图、架构图等）。必须严格依据该条消息作答：直接用 Markdown 输出图。默认且优先使用 ```mermaid 围栏（客户端可实时渲染）；仅当用户明确要求 PlantUML / puml 时才用 ```plantuml（可在设置中启用服务端/本地渲染，否则仅源码）。可附一句极短说明。禁止调用或提及任何项目工具（list_dir/read_file/write_file/run_terminal 等），禁止探索仓库，禁止延续记忆/历史里的构建、验证、CMake、git 等旧任务，禁止输出与绘图无关的长「总结」。"
            : "用户最新消息是普通问答/建议/概念讨论，并未明确要求你改仓库、跑命令或创建文件。请直接用 Markdown 对准其核心目标凝练作答（先结论/建议，少铺垫）；禁止调用任何项目工具，禁止探索/读取/修改仓库，禁止擅自 write_file 或「落地」文档；不要把记忆里的旧项目任务当作本轮目标，不要写成冗长报告。"
          : chatOnlyDiagramAsk
            ? "The latest user message is a chat diagram request (e.g. draw a diagram, flowchart, architecture). Answer that message only: emit the diagram in Markdown. Default to a ```mermaid fence (client renders live); use ```plantuml only if the user explicitly asked for PlantUML/puml (opt-in server/local render in Settings, otherwise source-only). Optionally add one short sentence. Do not call or mention project tools (list_dir/read_file/write_file/run_terminal, etc.), do not explore the repo, do not continue old build/verify/CMake/git work from memory or history, and do not dump an unrelated summary."
            : "The latest user message is ordinary Q&A / advice / conceptual discussion, not an explicit request to change the repo, run commands, or create files. Answer the core goal directly and concisely in Markdown (lead with the answer; minimal preamble). Do not call project tools, do not explore/read/modify the repo, do not write_file or 'land' documents on disk, do not treat older memory tasks as this turn's goal, and do not write a long report.",
    });
    return streamPlainChatAnswer({
      llm: summaryLlm,
      apiMessages,
      signal,
      isOwned,
      patchContent,
      locale,
    });
  }

  const networkOnlyTurn = preferPlainChat && allowNetworkTools && !chatOnlyDiagramAsk;
  /** Hard stop always = Settings → Project agentMaxRounds (never soft-capped below it). */
  const agentMaxRounds = agentMaxRoundsBase;
  if (networkOnlyTurn) {
    const complexityHint =
      locale === "zh"
        ? webTaskComplexity === "simple"
          ? "任务偏简单：优先直接作答或一次高质量检索；仅当结果不足时再经 Reflect 换查询。工具轮数硬上限以设置为准，勿因简单任务提前硬停。"
          : "任务偏复杂：可多角度检索；每轮 Reflect 判断是否够用，不够再换关键词/抓取权威页，禁止无意义连搜。工具轮数硬上限以设置为准。"
        : webTaskComplexity === "simple"
          ? "Simple task: prefer a direct answer or one solid search; only Reflect→new query if results are insufficient. The settings tool-round value is the hard stop — do not hard-stop early just because the task looks simple."
          : "Multi-angle task: search as needed; after each batch Reflect whether enough, then new query/fetch — no pointless search loops. The settings tool-round value is the hard stop.";
    apiMessages.push({
      role: "system",
      content:
        locale === "zh"
          ? `本轮是普通问答，但用户已开启联网。由你决定是否 web_search / web_fetch（无独立分类器）；禁止调用任何项目/仓库工具。\n${complexityHint}`
          : `Ordinary Q&A with Network on. You decide whether to call web_search / web_fetch (no separate classifier). Do not call project/repo tools.\n${complexityHint}`,
    });
  }

  /**
   * Soft judgment for remaining tool-enabled turns: informational phrasing
   * still prefers Markdown, but tools stay available when work is requested.
   */
  const softInformationalAsk =
    !createPath &&
    !officeIntent &&
    !shellIntent &&
    !exploreIntent &&
    multiStepPlan.length < 2 &&
    (looksLikeAnswerOnlyRequest(trimmed) ||
      !looksLikeMutationRequest(trimmed));
  if (softInformationalAsk) {
    apiMessages.push({
      role: "system",
      content:
        locale === "zh"
          ? "根据实际情景判断：若用户只要示例/解释/概念问答，优先用 Markdown 直接、凝练回答（代码用围栏）；仅当为实现其目标确有必要（明确要求保存/创建到项目、改文件、跑命令，或上下文显然需要读仓库）时再调用工具。不要编造路径（如 hello.py）或擅自 write_file；也不要仅为「写一段代码」起草批准计划。严格依据最新一条用户消息；勿把记忆中的旧任务当作本轮目标，勿发散探索或长篇总结。"
          : "Judge by situation and necessity: if the ask is informational/sample, prefer answering in Markdown concisely (fenced code). Use write/edit/terminal only when needed for the user's goal (explicit save/create/path/run, or context clearly requires project access). Do not invent paths (e.g. hello.py) or write_file unprompted; do not invent an approval plan just for a sample snippet. Ground in the latest user message; do not treat older memory tasks as this turn's goal; do not digress or write a long report.",
    });
  }
  const explorePlaceholder =
    exploreIntent?.kind === "list"
      ? t("agent.status.listing", { path: exploreIntent.path }, locale)
      : exploreIntent?.kind === "read"
        ? t("agent.status.reading", { path: exploreIntent.path }, locale)
        : exploreIntent?.kind === "search"
          ? t("agent.status.searching", { query: exploreIntent.query }, locale)
          : null;
  const shellPlaceholder = shellIntent
    ? t("agent.status.terminal", { command: shellIntent.command }, locale)
    : null;
  const requireApproval =
    Boolean(projectRoot) &&
    !networkOnlyTurn &&
    resolveAgentRequireApproval(settings);
  /** Pure read/list/search, read-only shell, or soft informational — skip plan gate. */
  const shellLeavesProject =
    Boolean(shellIntent) &&
    Boolean(projectRoot) &&
    commandLeavesProject(shellIntent!.command, projectRoot);
  const skipPlanApproval =
    networkOnlyTurn ||
    (Boolean(projectRoot) &&
      !looksLikeMutationRequest(trimmed) &&
      multiStepPlan.length < 2 &&
      !shellLeavesProject &&
      (Boolean(exploreIntent) ||
        Boolean(shellIntent?.readOnly) ||
        softInformationalAsk));
  /**
   * Clear shell intents skip messy free-form planning:
   * - Outside-project (ls /debris) always needs Terminal 权限 card.
   * - Mutating in-project (npm test) with plan gate on → Terminal card with exact command.
   */
  const forceDirectShellApproval =
    Boolean(projectRoot) &&
    Boolean(shellIntent?.command) &&
    Boolean(onAwaitPlanApproval) &&
    (shellLeavesProject || (requireApproval && !shellIntent!.readOnly));

  const addExecutionHints = () => {
    if (createPath) {
      apiMessages.push({
        role: "system",
        content: `用户要求在项目中创建文件。你必须调用函数 write_file：path 必须精确为 "${createPath}"（相对项目根），content 为完整源码。禁止只输出 Markdown 代码块而不调用工具。`,
      });
    } else if (officeIntent) {
      apiMessages.push({
        role: "system",
        content:
          officeIntent.tool === "write_xlsx"
            ? `用户要求创建 Excel。你必须调用函数 write_xlsx：path="${officeIntent.path}"，rows 为二维数组（首行可为表头）。禁止只把 JSON/表格贴在 Markdown 里让用户自己执行。禁止用 write_file。`
            : `用户要求创建 Word。你必须调用函数 write_docx：path="${officeIntent.path}"，paragraphs 为段落数组（空白文档用 [] 或 [""]）。禁止只把 JSON 贴在 Markdown 里；禁止未调用工具就声称已创建。禁止用 write_file。`,
      });
    } else if (shellIntent) {
      apiMessages.push({
        role: "system",
        content: `用户最新消息要求执行 shell/终端命令。你必须调用函数 run_terminal：command 必须为 ${JSON.stringify(shellIntent.command)}。禁止用 list_dir 代替；禁止只描述命令而不调用工具；禁止添加用户未要求的操作（如删除 node_modules）。忽略历史中未完成的旧计划，除非用户明确要求继续。`,
      });
    } else if (exploreIntent) {
      apiMessages.push({
        role: "system",
        content:
          exploreIntent.kind === "list"
            ? `用户要求查看目录。你必须调用函数 list_dir：path 必须为 "${exploreIntent.path}"（相对项目根；根目录用 "."）。禁止凭猜测罗列文件。`
            : exploreIntent.kind === "read"
              ? `用户要求阅读文件。你必须调用函数 read_file：path 必须为 "${exploreIntent.path}"。禁止编造文件内容。`
              : `用户要求搜索代码。你必须调用函数 search_files：query 必须为 "${exploreIntent.query}"。禁止凭记忆假装已搜索。`,
      });
    } else if (multiStepPlan.length >= 2) {
      apiMessages.push({
        role: "system",
        content: multiStepSystemHint(multiStepPlan),
      });
    }
  };

  let visibleContent = "";
  let round = 0;
  let useNativeTools = Boolean(projectRoot) || allowNetworkTools;
  const activeTools = networkOnlyTurn ? networkOnlyTools : projectTools;
  let forcedWrite = Boolean(createPath && projectRoot);
  let forcedExploreTool =
    exploreIntent?.kind === "list"
      ? "list_dir"
      : exploreIntent?.kind === "read"
        ? "read_file"
        : exploreIntent?.kind === "search"
          ? "search_files"
          : null;
  let forcedShellTool = Boolean(shellIntent) ? ("run_terminal" as const) : null;
  /** After Approve & run: prefer the first tool named in the approved plan. */
  let forcedPlanTool: AgentToolName | null = null;
  let officeFallbackUsed = false;
  let exploreFallbackUsed = false;
  let shellFallbackUsed = false;
  let officeToolFailed = false;
  let officeTargetWritten = false;
  let toolBatchesExecuted = 0;
  /** Deterministic list/read prefetch runs once per turn, not every approve. */
  let deterministicPrefetchDone = false;
  /** Model-loop tool batches from the latest executeTools call (excl. prefetch). */
  let lastModelToolBatches = 0;
  /** Successful mutating tool calls from the latest executeTools call. */
  let lastMutatingToolSuccesses = 0;
  let apiReasoning = "";
  /** Explicit PLAN→ACT→OBSERVE→REFLECT controller for this turn. */
  const agentLoop = new AgentLoopController({
    maxStepRetries: 2,
    maxReplans: 3,
  });

  const patchAssistantContent = (content: string) => {
    if (!isOwned() || signal.aborted) return;
    patchContent({ content });
  };

  const patchAssistantState = (patch: AgentContentPatch) => {
    if (!isOwned() || signal.aborted) return;
    patchContent(patch);
  };

  const executeTools = async (opts?: {
    /** Keep nudging until at least one tool batch runs (post-approve). */
    requireToolBatch?: boolean;
    /** User approved outside-project terminal access for this batch. */
    allowOutsideProject?: boolean;
    /** Approved plan text/steps — synthesize concrete tools if the model emits none. */
    fallbackFromPlan?: {
      planText: string;
      steps: string[];
      commands?: string[] | null;
    };
  }): Promise<string> => {
    const requireToolBatch = Boolean(opts?.requireToolBatch);
    const allowOutsideProject = Boolean(opts?.allowOutsideProject);
    /** One plan-synthesis inject per approve/execute phase. */
    let planFallbackUsed = false;
    // Each approve/execute phase gets a fresh round budget.
    round = 0;
    lastModelToolBatches = 0;
    lastMutatingToolSuccesses = 0;
    addExecutionHints();

    if (!deterministicPrefetchDone) {
      const preflightShell =
        projectRoot &&
        allowTerminal &&
        !signal.aborted &&
        shellIntent &&
        shellIntent.readOnly &&
        !commandLeavesProject(shellIntent.command, projectRoot);
      if (preflightShell) {
        const shellCall = synthesizeShellToolCall(shellIntent);
        patchAssistantContent(
          t("agent.status.terminal", { command: shellIntent.command }, locale),
        );
        const pre = await abortable(
          executeToolCall(shellCall, sidecarUrl, signal, projectRoot, locale, {
            allowTerminal,
            allowOutsideProject,
            allowNetwork: allowNetworkTools,
            session,
          }),
          signal,
        );
        if (!signal.aborted) {
          onAgentActivity({
            id: createId(),
            at: Date.now(),
            ...pre.activity,
          });
          toolBatchesExecuted = 1;
          shellFallbackUsed = true;
          forcedShellTool = null;
          apiMessages.push({
            role: "user",
            content: pre.ok
              ? `【工具结果：run_terminal command=${JSON.stringify(shellIntent.command)}】\n${pre.resultText}\n\n（以上为真实终端输出。）\n用户任务：${trimmed}\n请据此用中文凝练回答用户目标；若任务已完成则不要再调工具，不要展开无关步骤。`
              : `【run_terminal 失败】${pre.resultText}\n\n请向用户说明 sidecar/终端权限问题，不要编造命令输出。`,
          });
          if (!pre.ok) {
            patchAssistantContent(
              `Could not run command: ${pre.resultText}`,
            );
          }
        }
      }

      const preflightList =
        projectRoot &&
        !signal.aborted &&
        !shellIntent &&
        (exploreIntent?.kind === "list" ||
          multiStepPlan[0]?.tool === "list_dir");
      if (preflightList) {
        const listCall: AgentToolCall =
          exploreIntent?.kind === "list"
            ? synthesizeExploreToolCall(exploreIntent)
            : { tool: "list_dir", path: multiStepPlan[0]?.path ?? "." };
        patchAssistantContent(t("agent.status.listRoot", undefined, locale));
        const pre = await abortable(
          executeToolCall(listCall, sidecarUrl, signal, projectRoot, locale, {
            allowTerminal,
            allowOutsideProject,
            allowNetwork: allowNetworkTools,
            session,
          }),
          signal,
        );
        if (!signal.aborted) {
          onAgentActivity({
            id: createId(),
            at: Date.now(),
            ...pre.activity,
          });
          toolBatchesExecuted = 1;
          exploreFallbackUsed = true;
          forcedExploreTool = null;
          apiMessages.push({
            role: "user",
            content: pre.ok
              ? `【工具结果：list_dir path="${listCall.path ?? "."}"】\n${pre.resultText}\n\n（以上为真实磁盘 listing，不是猜测。）\n用户任务：${trimmed}\n请据此凝练作答。仅当用户原话仍要求的后续步骤未完成时才继续调工具；不要自行扩展到 package.json、README 或其他未提及的文件/验证。若用户只是要看目录，列完后一两句说明即可，不要再调工具。`
              : `【list_dir 失败】${pre.resultText}\n\n请向用户说明 sidecar/项目绑定问题，不要编造目录内容。`,
          });
          if (!pre.ok) {
            patchAssistantContent(
              `Could not list directory: ${pre.resultText}`,
            );
          }
        }
      }

      if (multiStepPlan.length >= 2 && projectRoot && !signal.aborted) {
        for (const step of multiStepPlan) {
          if (step.tool !== "read_file" || !step.path) continue;
          patchAssistantContent(t("agent.status.reading", { path: step.path }, locale));
          const readExec = await abortable(
            executeToolCall(step, sidecarUrl, signal, projectRoot, locale, {
              allowTerminal,
              allowOutsideProject,
              allowNetwork: allowNetworkTools,
              session,
            }),
            signal,
          );
          if (signal.aborted) break;
          onAgentActivity({
            id: createId(),
            at: Date.now(),
            ...readExec.activity,
          });
          toolBatchesExecuted += 1;
          apiMessages.push({
            role: "user",
            content: `【工具结果：read_file path="${step.path}"】\n${readExec.resultText}`,
          });
        }
        const followUp = multiStepFollowUpHint(trimmed);
        if (followUp) {
          apiMessages.push({ role: "user", content: followUp });
        }
      }
      deterministicPrefetchDone = true;
    }

    // Baseline after deterministic preflight so post-approve nudges require a
    // model-driven tool batch (prefetch alone must not unlock the next chunk).
    const batchesAtStart = toolBatchesExecuted;

    const forcedOfficeTool = officeIntent?.tool ?? null;

    while (round < agentMaxRounds) {
      if (signal.aborted) break;

      // Subsequent rounds see a bounded snapshot of plan/observe/reflect continuity.
      if (round > 0) {
        upsertWorkingMemoryAddendum(
          apiMessages,
          agentLoop,
          locale === "zh" ? "zh" : "en",
        );
      }

      shrinkPriorToolResultsInMessages(apiMessages);

      let roundText = "";
      let streamResult: Awaited<ReturnType<typeof streamChat>>;
      try {
        streamResult = await streamChat(
          codeLlm,
          apiMessages,
          (delta) => {
            roundText += delta;
            const cleaned = stripToolCalls(roundText);
            if (cleaned.length > 0) {
              patchAssistantState({
                content: visibleContent
                  ? `${visibleContent}\n\n${cleaned}`.trim()
                  : cleaned,
                ...(apiReasoning.trim()
                  ? { reasoning: apiReasoning }
                  : {}),
              });
            } else if (!visibleContent && projectRoot) {
              patchAssistantContent(
                createPath
                  ? t("agent.status.creating", { path: createPath }, locale)
                  : officeIntent
                    ? t("agent.status.creating", { path: officeIntent.path }, locale)
                    : shellPlaceholder ||
                      explorePlaceholder ||
                      t("agent.status.tools", undefined, locale),
              );
            }
          },
          {
            signal,
            temperature: projectRoot ? 0.2 : 0.6,
            tools: useNativeTools ? activeTools : undefined,
            toolChoice:
              useNativeTools && forcedWrite && round === 0
                ? { type: "function", function: { name: "write_file" } }
                : useNativeTools && forcedOfficeTool && round === 0
                  ? {
                      type: "function",
                      function: { name: forcedOfficeTool },
                    }
                  : useNativeTools && forcedShellTool && round === 0
                    ? {
                        type: "function",
                        function: { name: "run_terminal" },
                      }
                    : useNativeTools && forcedPlanTool && round === 0
                      ? {
                          type: "function",
                          function: { name: forcedPlanTool },
                        }
                      : useNativeTools && forcedExploreTool && round === 0
                        ? {
                            type: "function",
                            function: { name: forcedExploreTool },
                          }
                        : useNativeTools
                          ? "auto"
                          : undefined,
            onReasoningDelta: (piece) => {
              apiReasoning += piece;
              if (apiReasoning.trim()) {
                patchAssistantState({ reasoning: apiReasoning });
              }
            },
          },
        );
      } catch (e) {
        if (useNativeTools && isToolsUnsupportedError(e)) {
          useNativeTools = false;
          forcedWrite = false;
          continue;
        }
        throw e;
      }

      if (signal.aborted) break;

      roundText = streamResult.content || roundText;
      if (streamResult.reasoning.length >= apiReasoning.length) {
        apiReasoning = streamResult.reasoning;
      }
      {
        const merged = mergeReasoningChannels(
          apiReasoning,
          stripToolCalls(roundText),
          { expectChineseAnswer: locale === "zh" },
        );
        apiReasoning = merged.reasoning;
        roundText = merged.content;
        if (apiReasoning.trim()) {
          patchAssistantState({
            reasoning: apiReasoning,
            ...(roundText
              ? {
                  content: visibleContent
                    ? `${visibleContent}\n\n${roundText}`.trim()
                    : roundText,
                }
              : {}),
            ...(apiReasoning.trim()
              ? {
                  thinkingSeconds: thinkingSecondsFromTiming(
                    streamResult.timing,
                    apiReasoning,
                  ),
                }
              : {}),
          });
        }
      }

      type PendingCall = {
        agent: AgentToolCall;
        native?: ToolCall;
      };
      const pending: PendingCall[] = [];

      if (streamResult.toolCalls.length > 0) {
        for (const tc of streamResult.toolCalls) {
          let agent = agentCallFromOpenAI(tc);
          if (agent) {
            if (
              createPath &&
              agent.tool === "write_file" &&
              (!agent.path || agent.path === "." || agent.path === "file")
            ) {
              agent.path = createPath;
            }
            if (officeIntent && agent.tool === officeIntent.tool) {
              agent = alignOfficeToolCall(agent, officeIntent, trimmed);
            }
            if (
              exploreIntent?.kind === "list" &&
              agent.tool === "list_dir" &&
              (!agent.path || agent.path === "file")
            ) {
              agent.path = exploreIntent.path;
            }
            if (
              exploreIntent?.kind === "read" &&
              agent.tool === "read_file" &&
              (!agent.path || agent.path === "." || agent.path === "file")
            ) {
              agent.path = exploreIntent.path;
            }
            if (
              exploreIntent?.kind === "search" &&
              agent.tool === "search_files" &&
              !agent.query?.trim()
            ) {
              agent.query = exploreIntent.query;
            }
            if (
              shellIntent &&
              agent.tool === "run_terminal" &&
              !agent.command?.trim()
            ) {
              agent.command = shellIntent.command;
            }
            pending.push({ agent, native: tc });
          }
        }
      }

      // Ollama / small models often paste tool JSON in content while also
      // emitting empty or unparseable native tool_calls — always fall back.
      if (pending.length === 0 && (projectRoot || networkOnlyTurn)) {
        for (const raw of collectToolCalls(
          roundText,
          trimmed,
          apiReasoning,
        )) {
          let agent = raw;
          if (networkOnlyTurn) {
            if (agent.tool !== "web_search" && agent.tool !== "web_fetch") {
              continue;
            }
          }
          if (officeIntent && agent.tool === officeIntent.tool) {
            agent = alignOfficeToolCall(agent, officeIntent, trimmed);
          }
          if (
            exploreIntent?.kind === "list" &&
            agent.tool === "list_dir" &&
            (!agent.path || agent.path === "file")
          ) {
            agent.path = exploreIntent.path;
          }
          if (
            exploreIntent?.kind === "read" &&
            agent.tool === "read_file" &&
            (!agent.path || agent.path === "." || agent.path === "file")
          ) {
            agent.path = exploreIntent.path;
          }
          if (
            exploreIntent?.kind === "search" &&
            agent.tool === "search_files" &&
            !agent.query?.trim()
          ) {
            agent.query = exploreIntent.query;
          }
          if (
            shellIntent &&
            agent.tool === "run_terminal" &&
            !agent.command?.trim()
          ) {
            agent.command = shellIntent.command;
          }
          pending.push({ agent });
        }
      }

      if (
        createPath &&
        projectRoot &&
        !pending.some((p) => p.agent.tool === "write_file")
      ) {
        const synthetic = synthesizeWriteFromReply(trimmed, roundText);
        if (synthetic) {
          pending.push({ agent: synthetic });
        }
      }

      if (
        exploreIntent &&
        projectRoot &&
        !exploreFallbackUsed &&
        toolBatchesExecuted === 0 &&
        !pending.some(
          (p) =>
            p.agent.tool ===
            (exploreIntent.kind === "list"
              ? "list_dir"
              : exploreIntent.kind === "read"
                ? "read_file"
                : "search_files"),
        )
      ) {
        pending.push({
          agent: synthesizeExploreToolCall(exploreIntent),
        });
        exploreFallbackUsed = true;
      }

      if (
        shellIntent &&
        projectRoot &&
        allowTerminal &&
        !shellFallbackUsed &&
        toolBatchesExecuted === 0 &&
        !pending.some((p) => p.agent.tool === "run_terminal")
      ) {
        pending.push({
          agent: synthesizeShellToolCall(shellIntent),
        });
        shellFallbackUsed = true;
      }

      if (
        officeIntent &&
        projectRoot &&
        !officeFallbackUsed &&
        !officeToolFailed &&
        !pending.some((p) => p.agent.tool === officeIntent.tool)
      ) {
        pending.push({
          agent: synthesizeOfficeFromIntent(officeIntent, trimmed),
        });
        officeFallbackUsed = true;
      }

      // Post-approve: model may emit no tools, or the wrong ones (e.g. list_dir
      // instead of search_replace). Gap-fill concrete approved steps once.
      if (
        requireToolBatch &&
        projectRoot &&
        !planFallbackUsed &&
        opts?.fallbackFromPlan
      ) {
        const synth = synthesizeToolCallsFromApprovedPlan(opts.fallbackFromPlan);
        for (const agent of synth) {
          if (agent.tool === "run_terminal" && !allowTerminal) continue;
          if (pendingCoversPlanTool(pending, agent)) continue;
          pending.push({ agent });
        }
        planFallbackUsed = true;
      }

      if (networkOnlyTurn) {
        for (let i = pending.length - 1; i >= 0; i--) {
          const tool = pending[i]!.agent.tool;
          if (tool !== "web_search" && tool !== "web_fetch") {
            pending.splice(i, 1);
          }
        }
      }

      const cleanedRound = stripToolCalls(roundText);

      if (pending.length === 0) {
        if (createPath && projectRoot && round === 0) {
          apiMessages.push({
            role: "assistant",
            content: cleanedRound || roundText || "",
          });
          apiMessages.push({
            role: "user",
            content: `请立刻调用 write_file，path="${createPath}"，content=完整源码。不要只贴代码。`,
          });
          visibleContent = cleanedRound;
          patchAssistantContent(
            visibleContent || t("agent.status.creating", { path: createPath }, locale),
          );
          round += 1;
          forcedWrite = useNativeTools;
          continue;
        }
        if (
          officeIntent &&
          projectRoot &&
          round === 0 &&
          toolBatchesExecuted === 0
        ) {
          apiMessages.push({
            role: "assistant",
            content: cleanedRound || roundText || "",
          });
          apiMessages.push({
            role: "user",
            content:
              officeIntent.tool === "write_xlsx"
                ? `不要把工具 JSON 贴给用户。请立刻调用函数 write_xlsx，path="${officeIntent.path}"，rows=完整二维数组。`
                : `不要把工具 JSON 贴给用户。请立刻调用函数 write_docx，path="${officeIntent.path}"，paragraphs 为段落数组（空白文档可用 []）。`,
          });
          visibleContent = cleanedRound;
          patchAssistantContent(
            visibleContent || t("agent.status.creating", { path: officeIntent.path }, locale),
          );
          round += 1;
          continue;
        }
        if (exploreIntent && projectRoot && round === 0) {
          apiMessages.push({
            role: "assistant",
            content: cleanedRound || roundText || "",
          });
          apiMessages.push({
            role: "user",
            content:
              exploreIntent.kind === "list"
                ? `请立刻调用 list_dir，path="${exploreIntent.path}"。不要凭猜测列目录。`
                : exploreIntent.kind === "read"
                  ? `请立刻调用 read_file，path="${exploreIntent.path}"。不要编造文件内容。`
                  : `请立刻调用 search_files，query="${exploreIntent.query}"。不要假装已搜索。`,
          });
          visibleContent = cleanedRound;
          patchAssistantContent(
            visibleContent || explorePlaceholder || t("agent.status.tools", undefined, locale),
          );
          round += 1;
          continue;
        }

        if (shellIntent && projectRoot && allowTerminal && round === 0) {
          apiMessages.push({
            role: "assistant",
            content: cleanedRound || roundText || "",
          });
          apiMessages.push({
            role: "user",
            content: `请立刻调用 run_terminal，command=${JSON.stringify(shellIntent.command)}。不要用 list_dir 代替，不要只描述命令。`,
          });
          visibleContent = cleanedRound;
          patchAssistantContent(
            visibleContent ||
              shellPlaceholder ||
              t("agent.status.tools", undefined, locale),
          );
          round += 1;
          forcedShellTool = "run_terminal";
          continue;
        }

        if (projectRoot && toolBatchesExecuted === batchesAtStart && round < 2) {
          apiMessages.push({
            role: "assistant",
            content: cleanedRound || roundText || "",
          });
          apiMessages.push({
            role: "user",
            content:
              "请立刻调用工具执行（list_dir / glob_files / read_file / write_file / search_replace / write_docx / git_status / run_terminal 等），根据工具返回结果继续完成用户目标；全部完成后用凝练中文收束。不要只描述计划或假装已完成，不要自行添加未要求的步骤。",
          });
          visibleContent = cleanedRound;
          patchAssistantContent(visibleContent || t("agent.status.tools", undefined, locale));
          round += 1;
          continue;
        }

        // Post-approve: keep nudging past the short retry window until a tool
        // batch runs or we hit the round cap (Ollama often needs more pushes).
        if (
          requireToolBatch &&
          projectRoot &&
          toolBatchesExecuted === batchesAtStart &&
          round < agentMaxRounds - 1
        ) {
          apiMessages.push({
            role: "assistant",
            content: cleanedRound || roundText || "",
          });
          apiMessages.push({
            role: "user",
            content:
              locale === "zh"
                ? "批准的计划尚未执行任何工具。请立刻发出 tool_calls（或 <tool_call>）完成已批准步骤；不要只总结、不要进入下一批计划。"
                : "No tools ran for the approved plan yet. Emit tool_calls (or <tool_call>) for the approved steps now; do not only summarize, and do not move on to the next plan chunk.",
          });
          visibleContent = cleanedRound;
          patchAssistantContent(visibleContent || t("agent.status.tools", undefined, locale));
          // Drop forced tool_choice after the first miss so the model can pick
          // any required tool on later rounds.
          if (round >= 1) forcedPlanTool = null;
          round += 1;
          continue;
        }

        if (
          projectRoot &&
          toolBatchesExecuted > 0 &&
          !cleanedRound.trim() &&
          round < agentMaxRounds - 1
        ) {
          apiMessages.push({
            role: "user",
            content:
              "工具已执行。请根据上述工具结果给出凝练最终回复（对准用户原目标，勿长篇总结或展开无关内容），不要再调用工具。",
          });
          round += 1;
          continue;
        }

        visibleContent = cleanedRound || visibleContent;
        patchAssistantContent(visibleContent);
        break;
      }

      if (streamResult.toolCalls.length > 0) {
        apiMessages.push({
          role: "assistant",
          content: cleanedRound || "",
          tool_calls: streamResult.toolCalls,
        });
      } else {
        apiMessages.push({ role: "assistant", content: roundText || "" });
      }

      if (cleanedRound) {
        visibleContent = visibleContent
          ? `${visibleContent}\n\n${cleanedRound}`.trim()
          : cleanedRound;
        patchAssistantContent(visibleContent);
      } else {
        patchAssistantContent(
          visibleContent ||
            (createPath
              ? t("agent.status.creating", { path: createPath }, locale)
              : officeIntent
                ? t("agent.status.creating", { path: officeIntent.path }, locale)
                : shellPlaceholder ||
                  explorePlaceholder ||
                  t("agent.status.tools", undefined, locale)),
        );
      }

      let wroteTarget = false;
      let batchHadTools = pending.length > 0;
      let batchHadSuccess = false;
      /** Successful code-edit outcomes in this batch (for auto-diagnostics). */
      const batchEditOutcomes: Array<{
        tool: PendingCall["agent"]["tool"];
        path?: string;
        ok: boolean;
      }> = [];
      const batchToolResults: Array<{
        tool: string;
        result: ReturnType<typeof toToolResult>;
      }> = [];

      const applyExecuted = (
        item: PendingCall,
        executed: Awaited<ReturnType<typeof executeToolCall>>,
      ) => {
        const toolResult = toToolResult({
          ...executed,
          tool: item.agent.tool,
        });
        batchToolResults.push({ tool: item.agent.tool, result: toolResult });
        if (toolResult.ok) {
          batchHadSuccess = true;
          if (
            isMutatingAgentTool(
              item.agent.tool,
              item.agent.command,
              projectRoot,
              item.agent.action,
            )
          ) {
            lastMutatingToolSuccesses += 1;
          }
        }
        batchEditOutcomes.push({
          tool: item.agent.tool,
          path: item.agent.path,
          ok: toolResult.ok,
        });
        if (
          item.agent.tool === "write_file" &&
          toolResult.ok &&
          (pathsMatch(item.agent.path, createPath, projectRoot) ||
            (!createPath && Boolean(item.agent.path)))
        ) {
          wroteTarget = true;
        }
        if (
          officeIntent &&
          item.agent.tool === officeIntent.tool &&
          toolResult.ok &&
          pathsMatch(item.agent.path, officeIntent.path, projectRoot)
        ) {
          wroteTarget = true;
          officeTargetWritten = true;
        }
        if (
          officeIntent &&
          item.agent.tool === officeIntent.tool &&
          !toolResult.ok
        ) {
          officeToolFailed = true;
        }
        const activity: AgentActivity = {
          id: createId(),
          at: Date.now(),
          ...executed.activity,
        };
        onAgentActivity(activity);
        if (executed.change) {
          onAgentChange({ ...executed.change, at: Date.now() });
        }

        if (item.native) {
          apiMessages.push(
            nativeToolResultMessage(
              item.native.id,
              item.native.function.name,
              toolResult.resultText,
              toolResult.ok,
              toolResult.errorType,
            ),
          );
        } else {
          apiMessages.push(
            toolResultMessage(
              item.agent,
              toolResult.resultText,
              toolResult.ok,
              toolResult.errorType,
            ),
          );
        }
      };

      const runOne = (item: PendingCall) =>
        abortable(
          executeToolCall(item.agent, sidecarUrl, signal, projectRoot, locale, {
            allowTerminal,
            allowOutsideProject,
            allowNetwork: allowNetworkTools,
            session,
          }),
          signal,
        );

      const parallel =
        pending.length > 1 &&
        pending.every((item) =>
          isReadOnlyAgentTool(
            item.agent.tool,
            item.agent.command,
            projectRoot,
            item.agent.action,
          ),
        );

      if (parallel) {
        const executedList = await abortable(
          Promise.all(pending.map((item) => runOne(item))),
          signal,
        );
        for (let i = 0; i < pending.length; i++) {
          if (signal.aborted) break;
          applyExecuted(pending[i]!, executedList[i]!);
        }
      } else {
        for (const item of pending) {
          if (signal.aborted) break;
          const executed = await runOne(item);
          if (signal.aborted) break;
          applyExecuted(item, executed);
        }
      }

      if (
        !signal.aborted &&
        autoDiagnostics &&
        projectRoot &&
        batchNeedsAutoDiagnostics(batchEditOutcomes)
      ) {
        try {
          const diag = await abortable(
            runDiagnostics(sidecarUrl, signal, projectRoot),
            signal,
          );
          const feedback = formatAutoDiagnosticsFeedback({
            ok: diag.ok,
            skipped: diag.skipped,
            output: diag.output,
          });
          apiMessages.push({ role: "user", content: feedback });
          onAgentActivity({
            id: createId(),
            at: Date.now(),
            kind: diag.ok ? "info" : "error",
            message: diag.ok
              ? "auto diagnostics ok"
              : "auto diagnostics failed",
          });
        } catch (e) {
          if (signal.aborted) break;
          const msg = e instanceof Error ? e.message : String(e);
          apiMessages.push({
            role: "user",
            content: `【自动诊断】运行失败：${msg}`,
          });
        }
      }

      // OBSERVE → REFLECT: structured decision (continue / retry / replan / abort)
      if (!signal.aborted && batchToolResults.length > 0) {
        agentLoop.enter("act");
        const observed = agentLoop.recordToolResults(batchToolResults);
        const expected =
          agentLoop.structuredSteps.find((s) => s.expectedOutcome)
            ?.expectedOutcome ?? agentLoop.structuredSteps[0]?.expectedOutcome;
        const { decision, source: reflectSource } = await reflectWithOptionalLlm({
          loop: agentLoop,
          input: {
            observed,
            expectedOutcome: expected,
          },
          llm,
          enableLlm: true,
          signal,
          locale: locale === "zh" ? "zh" : "en",
        });

        // Decision-bound tool_selection logging (observe outcome → feedback log).
        if (onDecisionFeedback) {
          const batchId = `batch_${Date.now().toString(36)}_${round}`;
          const events = buildToolSelectionDecisionEvents({
            targetId: session?.id ?? "turn",
            turnId: session?.id,
            phase: "observe",
            batchId,
            items: batchToolResults,
          });
          onDecisionFeedback(events);
        }

        if (decision !== "continue") {
          apiMessages.push({
            role: "user",
            content: buildReflectNudge({
              decision,
              observed,
              expectedOutcome: expected,
              locale: locale === "zh" ? "zh" : "en",
            }),
          });
          onAgentActivity({
            id: createId(),
            at: Date.now(),
            kind: decision === "abort" ? "error" : "info",
            message: `reflect:${decision}${observed.primaryErrorType ? `/${observed.primaryErrorType}` : ""}${reflectSource === "llm" ? "/llm" : ""}`,
          });
        }
        if (decision === "abort") {
          const failNote =
            locale === "zh"
              ? `\n\n（已熔断：工具连续失败且无法自动恢复${observed.primaryErrorType ? `，错误类型 ${observed.primaryErrorType}` : ""}。请根据上方说明处理或换一种方式重试。）`
              : `\n\n(Circuit open: tool failures could not be auto-recovered${observed.primaryErrorType ? ` [${observed.primaryErrorType}]` : ""}. Follow the notes above or try a different approach.)`;
          visibleContent = (visibleContent || cleanedRound) + failNote;
          patchAssistantContent(visibleContent.trim());
          break;
        }
        if (decision === "replan") {
          agentLoop.enter("plan", "reflect requested replan");
        }
      }

      if (batchHadTools) {
        toolBatchesExecuted += 1;
        lastModelToolBatches += 1;
        forcedPlanTool = null;
      }

      if (signal.aborted) break;

      if (createPath && wroteTarget) {
        apiMessages.push({
          role: "user",
          content: `文件 ${createPath} 已写入。请用一两句中文确认路径与作用，不要再调用工具。`,
        });
        forcedWrite = false;
      } else if (officeIntent && wroteTarget) {
        apiMessages.push({
          role: "user",
          content: `文件 ${officeIntent.path} 已写入磁盘。请用一两句中文确认路径，不要再调用工具，也不要把工具 JSON 贴给用户。`,
        });
      } else if (
        officeIntent &&
        batchHadTools &&
        !wroteTarget &&
        pending.some((p) => p.agent.tool === officeIntent.tool)
      ) {
        // Wrong-path or failed office write — do not let the model claim success
        apiMessages.push({
          role: "user",
          content: `目标文件 ${officeIntent.path} 尚未成功写入磁盘。禁止声称创建成功。请立即调用 ${officeIntent.tool}，path 必须精确为 "${officeIntent.path}"。`,
        });
      } else if (
        projectRoot &&
        toolBatchesExecuted > 0 &&
        batchHadTools &&
        batchHadSuccess &&
        !wroteTarget &&
        !createPath &&
        !officeIntent
      ) {
        apiMessages.push({
          role: "user",
          content:
            "请根据上述工具结果判断：若用户任务已完成，请给出凝练最终回复（对准用户原目标）且不要再调用工具；仅当原请求仍有未完成的必要步骤时才继续调工具。禁止添加用户未要求的验证操作（如多余的 list_dir）或自行扩展到未提及文件。",
        });
      } else if (officeIntent && officeToolFailed && !officeTargetWritten) {
        visibleContent =
          (visibleContent || cleanedRound) +
          `\n\n（创建 ${officeIntent.path} 失败：${officeIntent.tool} 未成功写入。请确认 npm run dev 已启动 sidecar，或重启 dev 后再试。）`;
        patchAssistantContent(visibleContent.trim());
        break;
      }

      round += 1;
      if (round >= agentMaxRounds) {
        if (officeIntent && !officeTargetWritten) {
          const failNote = `\n\n（未能确认 ${officeIntent.path} 已写入磁盘。请重试，或检查 sidecar / 项目绑定。）`;
          visibleContent = (visibleContent || cleanedRound) + failNote;
          patchAssistantContent(visibleContent.trim());
        } else {
          const note =
            "\n\n" +
            t(
              "agent.toolRoundLimit",
              { rounds: String(agentMaxRounds) },
              locale,
            );
          visibleContent = (visibleContent || cleanedRound) + note;
          patchAssistantContent(visibleContent.trim());
        }
      }
    }

    if (
      officeIntent &&
      projectRoot &&
      !officeTargetWritten &&
      toolBatchesExecuted === 0 &&
      !signal.aborted
    ) {
      // Last-resort write so a skipped tool loop cannot end as fake success
      const synth = synthesizeOfficeFromIntent(officeIntent, trimmed);
      patchAssistantContent(t("agent.status.creating", { path: officeIntent.path }, locale));
      const executed = await abortable(
        executeToolCall(synth, sidecarUrl, signal, projectRoot, locale, {
          allowTerminal,
          allowOutsideProject,
          allowNetwork: allowNetworkTools,
          session,
        }),
        signal,
      );
      onAgentActivity({
        id: createId(),
        at: Date.now(),
        ...executed.activity,
      });
      if (executed.change) {
        onAgentChange({ ...executed.change, at: Date.now() });
      }
      toolBatchesExecuted += 1;
      if (executed.ok) {
        officeTargetWritten = true;
        visibleContent =
          (visibleContent ? `${visibleContent}\n\n` : "") +
          `已创建 ${officeIntent.path}。`;
      } else {
        visibleContent =
          (visibleContent ? `${visibleContent}\n\n` : "") +
          `创建 ${officeIntent.path} 失败：${executed.resultText}`;
      }
      patchAssistantContent(visibleContent.trim());
    } else if (
      officeIntent &&
      !officeTargetWritten &&
      toolBatchesExecuted > 0 &&
      visibleContent &&
      !/未能确认|失败：|未成功写入/.test(visibleContent)
    ) {
      visibleContent =
        `${visibleContent}\n\n（未能确认 ${officeIntent.path} 已写入磁盘——请勿当作创建成功。）`.trim();
      patchAssistantContent(visibleContent);
    }

    return visibleContent;
  };

  // Clear shell intents: Terminal 权限 / Approve card with the exact command —
  // outside-project always; mutating cmds when plan approval is on.
  // Avoids free-form planning that talks about running without tool_calls.
  if (forceDirectShellApproval && shellIntent && !signal.aborted) {
    const cmd = shellIntent.command;
    const displayPlan = `run_terminal: ${cmd}`;
    const steps = [displayPlan];
    // Inline shell approval shows the command; keep the bubble short.
    patchAssistantContent(
      locale === "zh" ? "需要批准后才能运行：" : "Needs approval to run:",
    );
    onAwaitPlanApproval({
      planText: displayPlan,
      steps,
      commands: [cmd],
      totalStepCount: 1,
      continueExecution: async () => {
        apiMessages.push({
          role: "system",
          content: buildExecutionPhaseSystem(locale),
        });
        apiMessages.push({
          role: "user",
          content:
            locale === "zh"
              ? shellLeavesProject
                ? `用户已批准在项目外执行终端命令。请立即调用 run_terminal，command=${JSON.stringify(cmd)}。不要用 list_dir 代替。`
                : `用户已批准执行终端命令。请立即调用 run_terminal，command=${JSON.stringify(cmd)}。不要用 list_dir 代替，不要添加未批准的步骤。`
              : shellLeavesProject
                ? `User approved outside-project terminal access. Call run_terminal now with command=${JSON.stringify(cmd)}. Do not use list_dir.`
                : `User approved the terminal command. Call run_terminal now with command=${JSON.stringify(cmd)}. Do not use list_dir or add extra steps.`,
        });
        forcedShellTool = "run_terminal";
        await executeTools({
          requireToolBatch: true,
          allowOutsideProject: shellLeavesProject,
          fallbackFromPlan: {
            planText: displayPlan,
            steps,
            commands: [cmd],
          },
        });
        forcedShellTool = null;
      },
    });
    return "waiting_plan";
  }

  if (requireApproval && !skipPlanApproval && !signal.aborted) {
    apiMessages.push({
      role: "system",
      content: buildPlanningPhaseSystem(locale),
    });
    if (createPath) {
      apiMessages.push({
        role: "system",
        content: buildMinimalCreatePlanHint(createPath, locale),
      });
    } else if (officeIntent) {
      apiMessages.push({
        role: "system",
        content: buildMinimalOfficePlanHint(officeIntent, locale),
      });
    }

    type DraftedPlan = {
      displayPlan: string;
      steps: string[];
      deferredSteps: string[];
      totalSteps: number;
      wasChunked: boolean;
    };

    const draftPlanFromModel = async (): Promise<DraftedPlan | null> => {
      // Leave content empty until plan tokens arrive (typing indicator).
      let planRaw = "";
      await streamChat(
        planLlm,
        apiMessages,
        (delta) => {
          planRaw += delta;
          const cleaned = stripToolCalls(planRaw);
          if (cleaned.length > 0) {
            patchAssistantContent(cleaned);
          }
        },
        { signal, temperature: 0.3 },
      );

      if (signal.aborted) return null;

      const { planText, steps } = parseAgentPlan(planRaw);
      const limited = limitPlanForApproval(
        planText || planRaw.trim(),
        steps,
        locale,
      );
      const displayPlan = limited.planText || planRaw.trim();
      agentLoop.setStructuredPlan(
        parseStructuredPlanHints(displayPlan, limited.steps),
      );
      agentLoop.enter("await_approval", `steps=${limited.steps.length}`);
      patchAssistantContent(displayPlan);
      apiMessages.push({ role: "assistant", content: displayPlan });
      return {
        displayPlan,
        steps: limited.steps,
        deferredSteps: limited.deferredSteps,
        totalSteps: limited.totalSteps,
        wasChunked: limited.wasChunked,
      };
    };

    const approvalExecutePrompt = (approvedPlanText: string): string =>
      locale === "zh"
        ? `用户已批准以下计划（仅本轮步骤）。请立即用工具执行这些步骤：发出原生 tool_calls，或使用 <tool_call>…</tool_call>；禁止只描述、禁止假装已完成、禁止执行未列出的后续步骤。若某步需要写文件，必须调用 write_file / write_docx / write_xlsx 等。\n\n${approvedPlanText}`
        : `User approved the following plan (this round's steps only). Execute those steps now with tools: emit native tool_calls or <tool_call>…</tool_call>. Do not only describe work, do not pretend it is done, and do not run steps that were not listed. If a step needs a file write, you must call write_file / write_docx / write_xlsx etc.\n\n${approvedPlanText}`;

    const presentPlanForApproval = (drafted: DraftedPlan): void => {
      const approvedPlanText = drafted.displayPlan;
      const deferredSteps = drafted.deferredSteps;
      const preferredTool = inferPreferredToolFromPlan(
        drafted.displayPlan,
        drafted.steps,
      );
      const extractedCmds = extractTerminalCommandsFromPlan(
        `${drafted.displayPlan}\n${drafted.steps.join("\n")}`,
      );
      const planCommands =
        extractedCmds.length > 0
          ? extractedCmds
          : shellIntent?.command?.trim()
            ? [shellIntent.command.trim()]
            : undefined;
      const inlinePlan = usesInlineToolApproval(
        drafted.displayPlan,
        drafted.steps,
        planCommands,
      );
      // Inline Allow/Stop: short lead in the bubble; action lives in InlineToolApproval.
      if (inlinePlan) {
        patchAssistantContent(
          locale === "zh" ? "需要批准后才能运行：" : "Needs approval to run:",
        );
      }
      onAwaitPlanApproval({
        planText: drafted.displayPlan,
        steps: drafted.steps,
        commands: planCommands,
        totalStepCount: drafted.totalSteps,
        continueExecution: async () => {
          apiMessages.push({
            role: "system",
            content: buildExecutionPhaseSystem(locale),
          });
          apiMessages.push({
            role: "user",
            content: approvalExecutePrompt(approvedPlanText),
          });
          forcedPlanTool = preferredTool;
          const needsMutation = planMentionsMutatingTools(
            approvedPlanText,
            drafted.steps,
            projectRoot,
          );
          const needsOutside = planMentionsOutsideProject(
            approvedPlanText,
            drafted.steps,
            projectRoot,
          );
          await executeTools({
            requireToolBatch: true,
            allowOutsideProject: needsOutside,
            fallbackFromPlan: {
              planText: approvedPlanText,
              steps: drafted.steps,
              commands: planCommands,
            },
          });
          forcedPlanTool = null;

          // Approve → run → plan next chunk when steps were deferred.
          if (deferredSteps.length === 0 || signal.aborted) return;

          // Do not claim the chunk finished / draft the next plan if the model
          // never ran tools (or never mutated disk when the plan required it).
          // Prefetch list/read alone must not unlock the next chunk — that was
          // the E2E failure mode with Ollama after chunking.
          const chunkIncomplete = needsMutation
            ? lastMutatingToolSuccesses === 0
            : lastModelToolBatches === 0;
          if (chunkIncomplete) {
            const note =
              locale === "zh"
                ? `${visibleContent ? `${visibleContent}\n\n` : ""}（本轮批准的步骤尚未成功调用工具，已暂停后续分批计划。请再次点「允许」，或改用对 function calling 更稳的模型如 DeepSeek。）`
                : `${visibleContent ? `${visibleContent}\n\n` : ""}(No tools ran for this approved chunk, so the next plan round was not started. Click Allow again, or switch to a model with stronger function calling such as DeepSeek.)`;
            visibleContent = note.trim();
            patchAssistantContent(visibleContent);
            // Keep the same chunk available for another Allow.
            presentPlanForApproval(drafted);
            return;
          }

          apiMessages.push({
            role: "user",
            content: buildNextPlanChunkPrompt(deferredSteps, locale),
          });
          const next = await draftPlanFromModel();
          if (!next || signal.aborted) return;
          if (!planNeedsToolApproval(next.displayPlan, next.steps)) return;
          presentPlanForApproval(next);
        },
      });
    };

    const first = await draftPlanFromModel();
    if (!first) {
      return signal.aborted ? "aborted" : "completed";
    }

    // Clear create/office/mutation intents must still run tools — never treat a
    // hallucinated "already done / no tools needed" plan as a finished turn.
    const noToolsAction = mutationPlanNoToolsAction({
      planNeedsTools: planNeedsToolApproval(first.displayPlan, first.steps),
      userText: trimmed,
      createPath,
      hasOfficeIntent: Boolean(officeIntent),
      shellIntent,
    });
    if (noToolsAction === "force_execute") {
      visibleContent = await executeTools({ requireToolBatch: true });
      return signal.aborted ? "aborted" : "completed";
    }
    if (noToolsAction === "replan_or_execute") {
      apiMessages.push({
        role: "user",
        content:
          locale === "zh"
            ? "上份计划声称无需工具，但用户请求需要修改项目或系统。请重新输出可执行计划，必须写明具体工具（如 write_file / search_replace / run_terminal / write_docx / write_xlsx），禁止「无需工具」或假装已完成。"
            : "The previous plan claimed no tools are needed, but the user request requires mutating the project or system. Output an executable plan that names concrete tools (write_file / search_replace / run_terminal / write_docx / write_xlsx). Do not say tools are unnecessary or pretend the work is done.",
      });
      const retry = await draftPlanFromModel();
      if (!retry) {
        return signal.aborted ? "aborted" : "completed";
      }
      if (!planNeedsToolApproval(retry.displayPlan, retry.steps)) {
        visibleContent = await executeTools({ requireToolBatch: true });
        return signal.aborted ? "aborted" : "completed";
      }
      presentPlanForApproval(retry);
      return "waiting_plan";
    }
    if (!planNeedsToolApproval(first.displayPlan, first.steps)) {
      return "completed";
    }

    presentPlanForApproval(first);
    return "waiting_plan";
  }

  visibleContent = await executeTools();
  return signal.aborted ? "aborted" : "completed";
}
