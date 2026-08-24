import type {
  AgentActivity,
  AgentFileChange,
} from "./agentTools";
import type {
  ArchiveSnapshot,
  ChatMessage,
  ChatSession,
  NodeId,
  ThreadRoot,
} from "../types";

const SNIP = 1600;
const SMALL_SNIP = 420;

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

  return [
    "# ForkNote Turn Diagnostic",
    "",
    "Paste this whole packet when asking someone to debug a conversation/logical issue.",
    "It is generated from local UI state; API keys and full API settings are intentionally omitted.",
    "",
    "## Target",
    `- generatedAt: ${generated}`,
    `- session: ${session?.id ?? "(none)"} · ${session?.title ?? "(untitled)"}`,
    `- targetMessage: ${target ? messageLabel(target) : targetMessageId}`,
    `- previousUser: ${prevUser ? messageLabel(prevUser) : "(none)"}`,
    `- sourceMode: ${bool(sourceMode)}`,
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
