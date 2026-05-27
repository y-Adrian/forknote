import type { BranchNode, ThreadRoot } from "../types";

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
        `答：${truncate(node.assistantMessage, ANCESTOR_ANSWER_MAX)}`,
      ].join("\n");
    })
    .join("\n\n");
}

export function buildMainQuestionMessages(userQuestion: string) {
  return [
    {
      role: "system" as const,
      content:
        "你是阅读辅助助手。用户会提出一个主问题，请给出结构清晰、可分段阅读的回答。优先使用 Markdown 小标题与列表。回答应完整但避免无意义的重复。",
    },
    { role: "user" as const, content: userQuestion },
  ];
}

export function buildBranchQuestionMessages(
  thread: ThreadRoot,
  parentContent: string,
  parentId: string,
  anchorQuoted: string,
  userQuestion: string,
) {
  const isRootParent = parentId === thread.id;
  const ancestors = isRootParent
    ? []
    : (findBranchPath(thread.children, parentId) ?? []).slice(0, -1);

  const system = `你是「选中追问」助手。用户正在阅读一段 AI 回答，并针对其中选中的一小段文字提问。

规则：
1. 只回答当前子问题，不要重复整篇主回答。
2. 默认用 3～8 句或简短列表，保持精炼。
3. 若子问题与选中片段关系不大，先指出这一点，再尽量回答。
4. 使用中文。`;

  const user = `【主问题】
${thread.userQuestion}

【主回答】
${thread.assistantMessage}

【上级分支摘要】
${formatAncestorChain(ancestors)}

【父级回答全文】
${parentContent}

【当前选中原文】
「${anchorQuoted}」

【当前子问题】
${userQuestion}`;

  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
}
