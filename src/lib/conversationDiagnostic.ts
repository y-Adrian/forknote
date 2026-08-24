import type {
  AgentActivity,
  AgentFileChange,
} from "./agentTools";
import {
  isChatOnlyDiagramAsk,
  looksLikeProjectContextAdviceRequest,
  looksLikeProjectUnderstandingSummaryRequest,
  shouldPreferPlainChatTurn,
} from "./agentTools";
import type {
  ApiSettings,
  ArchiveSnapshot,
  ChatMessage,
  ChatSession,
  NodeId,
  ThreadRoot,
} from "../types";

const SNIP = 1600;
const SMALL_SNIP = 420;
const NEARBY_RADIUS = 2;
const BUILD_ERROR_RE =
  /sysroot|cmake|toolchain|configure|编译|交叉编译|链接|报错|error|failed/i;
const PROJECT_SUMMARY_RE =
  /了解到的信息|现在.*了解|项目.*信息|项目.*现状|项目目标|当前现状|模块|架构|总结/i;
const PROJECT_ADVICE_RE =
  /针对.*项目.*建议|项目.*建议|优化建议|下一步|后续.*(?:推进|演进)|项目.*(?:方向|路线|规划|优先级|用途|应用场景|使用场景|落地场景|适用场景)|项目.*(?:可以|能).*用(?:于|来)|项目.*适合(?:做什么|用(?:于|来)|哪些场景)|(?:延伸|拓展|扩展)(?:方向|空间|路线|建议|思路)|project.*(?:advice|next steps?|roadmap|suggest|recommend|use\s*cases?)/i;
const CONVERSATION_DEBUG_RE =
  /对话.*逻辑|逻辑.*不对|诊断|上下文|记忆|串线|错位|回答.*问题/i;

function truncate(text: string | null | undefined, max = SNIP): string {
  const t = (text ?? "").trim();
  if (!t) return "(empty)";
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n...(truncated ${t.length - max} chars)`;
}

function bool(value: unknown): string {
  return value ? "yes" : "no";
}

function messageLabel(msg: ChatMessage): string {
  return `${msg.role} ${msg.id}`;
}

function activeArchiveFor(
  session: ChatSession | null | undefined,
): ArchiveSnapshot | null {
  const archives = session?.archives ?? [];
  const activeId = session?.activeArchiveId ?? null;
  return archives.find((a) => a.id === activeId) ?? archives.at(-1) ?? null;
}

function previousUserMessage(
  messages: ChatMessage[],
  targetIndex: number,
): ChatMessage | null {
  for (let i = targetIndex - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return messages[i]!;
  }
  return null;
}

function safeUrlHost(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (!value) return "(empty)";
  if (value.startsWith("/")) return value;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "(invalid/hidden)";
  }
}

function settingBool(value: boolean | undefined, fallback = true): string {
  return value ?? fallback ? "on" : "off";
}

function nearbyMessageIndex(messages: ChatMessage[], targetIndex: number): string {
  if (targetIndex < 0) return "- target message not found in thread";
  const start = Math.max(0, targetIndex - NEARBY_RADIUS);
  const end = Math.min(messages.length, targetIndex + NEARBY_RADIUS + 1);
  return messages
    .slice(start, end)
    .map((m, offset) => {
      const i = start + offset;
      const marker = i === targetIndex ? " <-- target" : "";
      const text = truncate(m.content, 180).replace(/\n+/g, " / ");
      return `- [${i}] ${messageLabel(m)} chars=${m.content.length}${marker}: ${text}`;
    })
    .join("\n");
}

function renderModeFor(options: {
  targetIsTail: boolean;
  sourceMode: boolean;
  loadingMain: boolean;
}): string {
  if (options.sourceMode) return "source/raw-markdown";
  if (options.loadingMain && options.targetIsTail) return "stream-preview";
  return "full-preview";
}

function classifyUserIntent(content: string | null | undefined): string {
  const text = content ?? "";
  if (!text.trim()) return "unknown";
  if (CONVERSATION_DEBUG_RE.test(text)) return "conversation-diagnostic";
  if (PROJECT_SUMMARY_RE.test(text)) return "project-understanding-summary";
  if (looksLikeProjectContextAdviceRequest(text) || PROJECT_ADVICE_RE.test(text)) {
    return "project-context-advice";
  }
  if (BUILD_ERROR_RE.test(text)) return "build-error-troubleshooting";
  return "general-question";
}

function classifyAssistantIntent(content: string | null | undefined): string {
  const text = content ?? "";
  if (!text.trim()) return "unknown";
  if (BUILD_ERROR_RE.test(text)) return "build-error-troubleshooting";
  if (CONVERSATION_DEBUG_RE.test(text)) return "conversation-diagnostic";
  if (PROJECT_SUMMARY_RE.test(text)) return "project-understanding-summary";
  if (PROJECT_ADVICE_RE.test(text)) return "project-context-advice";
  return "general-answer";
}

function intentAlignment(userIntent: string, assistantIntent: string): string {
  if (userIntent === "unknown" || assistantIntent === "unknown") return "unknown";
  if (userIntent === assistantIntent) return "match";
  if (userIntent === "general-question" || assistantIntent === "general-answer") {
    return "unclear";
  }
  return "mismatch";
}

function automaticAnalysis(options: {
  prevUser: ChatMessage | null;
  target: ChatMessage | null;
  recentActivity: AgentActivity[];
  recentChanges: AgentFileChange[];
}): string[] {
  const previousUserIntent = classifyUserIntent(options.prevUser?.content);
  const assistantActualIntent = classifyAssistantIntent(options.target?.content);
  const alignment = intentAlignment(previousUserIntent, assistantActualIntent);
  const userText = options.prevUser?.content ?? "";
  const assistantText = options.target?.content ?? "";
  const assistantMentionsBuildIssue = BUILD_ERROR_RE.test(assistantText);
  const userAskedBuildIssue = BUILD_ERROR_RE.test(userText);
  const answerMentionsUnseenBuildIssue =
    assistantMentionsBuildIssue && !userAskedBuildIssue;
  const usedRecentTools = options.recentActivity.length > 0;
  const recentFileChanges = options.recentChanges.length > 0;
  const groundingRisk =
    alignment === "mismatch" || (answerMentionsUnseenBuildIssue && !usedRecentTools)
      ? "high"
      : usedRecentTools || recentFileChanges
        ? "medium"
        : "low";
  const suspectedIssue =
    alignment === "mismatch"
      ? "answer drift / stale context injection"
      : answerMentionsUnseenBuildIssue
        ? "possible stale technical context"
        : "none obvious";

  return [
    "## Automatic Analysis (heuristic)",
    `- previousUserIntent: ${previousUserIntent}`,
    `- assistantActualIntent: ${assistantActualIntent}`,
    `- alignment: ${alignment}`,
    `- suspectedIssue: ${suspectedIssue}`,
    `- groundingRisk: ${groundingRisk}`,
    `- usedRecentTools: ${bool(usedRecentTools)}`,
    `- recentFileChanges: ${bool(recentFileChanges)}`,
    `- answerMentionsUnseenBuildIssue: ${bool(answerMentionsUnseenBuildIssue)}`,
  ];
}

function inferredAgentRoute(options: {
  previousUserText: string;
  projectRoot: string | null;
  settings?: ApiSettings | null;
}): string[] {
  const text = options.previousUserText;
  const projectUnderstandingSummary =
    looksLikeProjectUnderstandingSummaryRequest(text);
  const projectContextAdvice = looksLikeProjectContextAdviceRequest(text);
  const chatOnlyDiagram = isChatOnlyDiagramAsk(text);
  const forcePlainNoTools =
    projectUnderstandingSummary || projectContextAdvice || chatOnlyDiagram;
  const preferPlainChat =
    !options.projectRoot ||
    forcePlainNoTools ||
    shouldPreferPlainChatTurn(text, {});
  const networkEnabled = options.settings?.agentAllowNetwork === true;
  const terminalEnabled = options.settings?.agentAllowTerminal !== false;
  const networkOnlyTurn =
    preferPlainChat && networkEnabled && !forcePlainNoTools;
  const turnMode = forcePlainNoTools
    ? "plain-chat/no-tools"
    : networkOnlyTurn
      ? "plain-chat/network-tools"
      : preferPlainChat
        ? "plain-chat/no-tools"
        : "project-agent/tools";
  const availableTools = forcePlainNoTools
    ? "(none)"
    : networkOnlyTurn
      ? "web_search, web_fetch"
      : options.projectRoot
        ? terminalEnabled
          ? "project tools + run_terminal"
          : "project tools (run_terminal disabled)"
        : "(none)";

  return [
    "## Agent Route (inferred)",
    `- turnMode: ${turnMode}`,
    `- preferPlainChat: ${bool(preferPlainChat)}`,
    `- forcePlainNoTools: ${bool(forcePlainNoTools)}`,
    `- projectUnderstandingSummary: ${bool(projectUnderstandingSummary)}`,
    `- projectContextAdvice: ${bool(projectContextAdvice)}`,
    `- chatOnlyDiagram: ${bool(chatOnlyDiagram)}`,
    `- networkOnlyTurn: ${bool(networkOnlyTurn)}`,
    `- availableTools: ${availableTools}`,
  ];
}

export function buildTurnDiagnosticPacket(options: {
  session: ChatSession | null | undefined;
  thread: ThreadRoot | null | undefined;
  targetMessageId: NodeId;
  projectRoot: string | null;
  sidecarUrl: string;
  sourceMode: boolean;
  loadingMain: boolean;
  loadingArchive: boolean;
  loadingCompress: boolean;
  loadingBranchId: NodeId | null;
  pendingFileIncludes: string[];
  agentActivity: AgentActivity[];
  agentChanges: AgentFileChange[];
  settings?: ApiSettings | null;
  generatedAt?: number;
}): string {
  const {
    session,
    thread,
    targetMessageId,
    projectRoot,
    sidecarUrl,
    sourceMode,
    loadingMain,
    loadingArchive,
    loadingCompress,
    loadingBranchId,
    pendingFileIncludes,
    agentActivity,
    agentChanges,
    settings,
  } = options;
  const messages = thread?.messages ?? [];
  const targetIndex = messages.findIndex((m) => m.id === targetMessageId);
  const target = targetIndex >= 0 ? messages[targetIndex]! : null;
  const prevUser = targetIndex >= 0 ? previousUserMessage(messages, targetIndex) : null;
  const archive = activeArchiveFor(session);
  const memory = session?.contextMemory ?? null;
  const recentActivity = agentActivity.slice(-12);
  const recentChanges = agentChanges.slice(-8);
  const recentFeedback = (session?.feedbackLog ?? []).slice(-12);
  const generated = new Date(options.generatedAt ?? Date.now()).toISOString();
  const targetIsTail = targetIndex === messages.length - 1;
  const renderMode = renderModeFor({ targetIsTail, sourceMode, loadingMain });
  const sessionApi = session?.api;
  const effectiveModel = sessionApi?.model?.trim() || settings?.model?.trim() || "(empty)";
  const analysis = automaticAnalysis({
    prevUser,
    target,
    recentActivity,
    recentChanges,
  });
  const route = inferredAgentRoute({
    previousUserText: prevUser?.content ?? "",
    projectRoot,
    settings,
  });

  return [
    "# ForkNote Turn Diagnostic",
    "",
    "Paste this whole packet when asking someone to debug a conversation/logical issue.",
    "It is generated from local UI state; API keys and full API settings are intentionally omitted.",
    "",
    "## User Report",
    "- Problem observed: (fill in what looked wrong)",
    "- Expected behavior: (fill in what should have happened)",
    "- Actual behavior: (fill in what happened instead)",
    "- Suspected area: (prompt / memory / archive / tools / rendering / UI state / unsure)",
    "",
    ...analysis,
    "",
    ...route,
    "",
    "## Target",
    `- generatedAt: ${generated}`,
    `- session: ${session?.id ?? "(none)"} · ${session?.title ?? "(untitled)"}`,
    `- targetMessage: ${target ? messageLabel(target) : targetMessageId}`,
    `- previousUser: ${prevUser ? messageLabel(prevUser) : "(none)"}`,
    `- sourceMode: ${bool(sourceMode)}`,
    `- renderMode: ${renderMode}`,
    `- targetIsTail: ${bool(targetIsTail)}`,
    "",
    "## Runtime State",
    `- contextMode: ${session?.contextMode ?? "live"}`,
    `- threadView: ${session?.threadView ?? "(default)"}`,
    `- activeArchiveId: ${session?.activeArchiveId ?? "(none)"}`,
    `- loadingMain: ${bool(loadingMain)}`,
    `- loadingArchive: ${bool(loadingArchive)}`,
    `- loadingCompress: ${bool(loadingCompress)}`,
    `- loadingBranchId: ${loadingBranchId ?? "(none)"}`,
    `- sidecarUrl: ${sidecarUrl || "(empty)"}`,
    `- projectBound: ${bool(projectRoot)}`,
    `- projectRoot: ${projectRoot ?? "(none)"}`,
    `- pendingFileIncludes: ${pendingFileIncludes.length ? pendingFileIncludes.join(", ") : "(none)"}`,
    "",
    "## Effective Settings (sanitized)",
    `- model: ${effectiveModel}`,
    `- baseUrlHost: ${safeUrlHost(sessionApi?.baseUrl || settings?.baseUrl)}`,
    `- sessionApiOverride: ${sessionApi ? "yes" : "no"}`,
    `- useProxy: ${sessionApi?.useProxy ?? settings?.useProxy ?? "(default)"}`,
    `- memoryLayerPreferences: ${settingBool(settings?.memoryLayerPreferences)}`,
    `- memoryLayerProject: ${settingBool(settings?.memoryLayerProject ?? settings?.contextMemoryEnabled)}`,
    `- memoryLayerSession: ${settingBool(settings?.memoryLayerSession)}`,
    `- compressAfterArchive: ${settingBool(settings?.compressAfterArchive, false)}`,
    `- contextAutoSummary: ${settingBool(settings?.contextAutoSummary)}`,
    `- contextWindowTurns: ${settings?.contextWindowTurns ?? "(default)"}`,
    `- agentRequireApproval: ${settingBool(settings?.agentRequireApproval)}`,
    `- agentAllowTerminal: ${settingBool(settings?.agentAllowTerminal)}`,
    `- agentAllowNetwork: ${settingBool(settings?.agentAllowNetwork, false)}`,
    `- agentAutoDiagnostics: ${settingBool(settings?.agentAutoDiagnostics)}`,
    "",
    "## Memory / Archive",
    `- shareMemory: ${session?.shareMemory === false ? "no" : "yes/default"}`,
    `- projectMemoryStorage: ${memory?.storage ?? "(none)"}`,
    `- projectMemoryDir: ${memory?.dir ?? "(none)"}`,
    `- PROJECT.md chars: ${memory?.project?.length ?? 0}`,
    `- SUMMARY.md chars: ${memory?.summary?.length ?? 0}`,
    `- TASKS.md chars: ${memory?.tasks?.length ?? 0}`,
    `- DECISIONS.md chars: ${memory?.decisions?.length ?? 0}`,
    `- CODING.md chars: ${memory?.coding?.length ?? 0}`,
    `- sessionMemory chars: ${session?.sessionMemory?.summary?.length ?? 0}`,
    `- archiveCount: ${session?.archives?.length ?? 0}`,
    `- activeArchiveTitle: ${archive?.title ?? "(none)"}`,
    `- archiveThroughMessageId: ${archive?.throughMessageId ?? "(none)"}`,
    `- memoryThroughMessageId: ${memory?.throughMessageId ?? "(none)"}`,
    "",
    "## Nearby Message Index",
    nearbyMessageIndex(messages, targetIndex),
    "",
    "## Nearby Conversation",
    "### Previous user message",
    "```md",
    truncate(prevUser?.content),
    "```",
    "",
    "### Target assistant message",
    "```md",
    truncate(target?.content),
    "```",
    "",
    "## Target Message Metadata",
    `- pointVerdicts: ${JSON.stringify(target?.pointVerdicts ?? {})}`,
    `- pointDoubts: ${JSON.stringify(target?.pointDoubts ?? {})}`,
    `- pointAttributions: ${JSON.stringify(target?.pointAttributions ?? {})}`,
    `- clarifyBranchCount: ${target?.children?.length ?? 0}`,
    `- reasoningChars: ${target?.reasoning?.length ?? 0}`,
    `- thinkingSeconds: ${target?.thinkingSeconds ?? "(none)"}`,
    "",
    "## Recent Agent Activity",
    recentActivity.length
      ? recentActivity
          .map((a) => `- ${new Date(a.at).toISOString()} [${a.kind}] ${a.message}`)
          .join("\n")
      : "- (none)",
    "",
    "## Recent File Changes",
    recentChanges.length
      ? recentChanges
          .map((c) => `- ${c.path} size=${c.size} at=${new Date(c.at).toISOString()}`)
          .join("\n")
      : "- (none)",
    "",
    "## Recent Feedback Events",
    recentFeedback.length
      ? recentFeedback
          .map((e) =>
            `- ${new Date(e.at).toISOString()} target=${e.targetId} #${e.pointIndex} ${e.signal} source=${e.source ?? "unknown"} decision=${e.decisionType ?? "point"} weight=${e.weight}`,
          )
          .join("\n")
      : "- (none)",
    "",
    "## Memory Snippets",
    "### PROJECT.md",
    "```md",
    truncate(memory?.project, SMALL_SNIP),
    "```",
    "",
    "### SUMMARY.md",
    "```md",
    truncate(memory?.summary, SMALL_SNIP),
    "```",
    "",
    "### CODING.md",
    "```md",
    truncate(memory?.coding, SMALL_SNIP),
    "```",
  ].join("\n");
}
