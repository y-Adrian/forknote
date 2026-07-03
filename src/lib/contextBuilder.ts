import type { BranchNode, ThreadRoot } from "../types";
import type { ChatMessage as ApiChatMessage } from "./openai";
import { annotateContentWithVerdicts } from "./points";
import { firstUserMessage } from "./thread";

const ANCESTOR_ANSWER_MAX = 280;
const ANCESTOR_QUESTION_MAX = 120;

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

function formatAncestorChain(ancestors: BranchNode[]): string {
  if (ancestors.length === 0) return "（无上级分支）";

  return ancestors
    .map((node, index) => {
      const n = index + 1;
      return [
        `【上级分支 ${n}】`,
        `选中：「${truncate(node.anchor.quotedText, 80)}」`,
        `问：${truncate(node.userQuestion, ANCESTOR_QUESTION_MAX)}`,
        `答：${truncate(
          annotateContentWithVerdicts(node.assistantMessage, node.pointVerdicts),
          ANCESTOR_ANSWER_MAX,
        )}`,
      ].join("\n");
    })
    .join("\n\n");
}

const CHAT_SYSTEM = `你是友好、准确的对话助手。请用中文回答，使用 Markdown。

回答格式要求（重要）：
1. 将回答拆分为若干个可独立判断的观点或步骤，每个观点/步骤以「【N】」开头（N 为从 1 开始的编号），且【N】必须位于行首。
2. 每个分点应自成一体：一个结论、一个步骤或一个判断，便于用户逐点采纳或拒绝。
3. 分点前可以有 1～2 句简短引导；不要在分点之外添加大段结论。
4. 分点数量按内容定，一般 3～8 个；简单问题可以少于 3 个。
5. 若用户在上下文中标记了「已拒绝」的分点，不要再基于该点展开；「已采纳✅」的分点视为已确认的事实。

示例格式：
下面从三个方面分析这个问题。

【1】第一个观点……

【2】第二个观点……

【3】第三个观点……`;

export function buildConversationMessages(
  thread: ThreadRoot,
): ApiChatMessage[] {
  const completed = thread.messages.filter(
    (m) => m.content.trim().length > 0,
  );
  return [
    { role: "system", content: CHAT_SYSTEM },
    ...completed.map((m) => ({
      role: m.role as "user" | "assistant",
      content:
        m.role === "assistant"
          ? annotateContentWithVerdicts(m.content, m.pointVerdicts)
          : m.content,
    })),
  ];
}

/** 追问挂载点：主对话助手消息 id，或某条分支 id */
export function resolveBranchAttachContext(
  thread: ThreadRoot,
  attachParentId: string,
): { assistantContent: string; ancestors: BranchNode[] } | null {
  for (const msg of thread.messages) {
    if (msg.role !== "assistant") continue;
    const annotated = annotateContentWithVerdicts(msg.content, msg.pointVerdicts);
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

export function buildBranchQuestionMessages(
  thread: ThreadRoot,
  attachParentId: string,
  anchorQuoted: string,
  userQuestion: string,
) {
  const ctx = resolveBranchAttachContext(thread, attachParentId);
  if (!ctx) {
    throw new Error("无法解析分支上下文");
  }

  const { assistantContent: parentContent, ancestors } = ctx;

  const conversation = thread.messages
    .filter((m) => m.content.trim())
    .map((m) =>
      m.role === "user"
        ? `用户：${truncate(m.content, 400)}`
        : `助手：${truncate(
            annotateContentWithVerdicts(m.content, m.pointVerdicts),
            400,
          )}`,
    )
    .join("\n\n");

  const system = `你是「选中追问」助手。用户正在阅读对话里的一条助手回复，并针对其中选中的一小段文字提问；同一选中片段下可能有多轮追问。

规则：
1. 只回答当前子问题，不要重复整段对话；若存在上级分支摘要，请结合其上下文连贯作答。
2. 保持精炼，回答拆分为若干可独立判断的分点，每个分点以「【N】」开头（N 从 1 开始，位于行首），便于用户逐点采纳或拒绝；简单问题可只有 1～2 个分点。
3. 若子问题与选中片段关系不大，先指出这一点，再尽量回答。
4. 上下文中标记「已拒绝」的分点不要再展开；「已采纳✅」的分点视为已确认。
5. 使用中文。`;

  const user = `【会话摘要】
${conversation || `（首问）${firstUserMessage(thread)}`}

【当前这条助手回复】
${parentContent}

【上级分支摘要】
${formatAncestorChain(ancestors)}

【当前选中原文】
「${anchorQuoted}」

【当前子问题】
${userQuestion}`;

  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
}
