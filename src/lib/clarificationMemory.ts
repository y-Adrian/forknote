import type { BranchNode, ClarificationMemoryEntry } from "../types";
import type { Locale } from "./i18n";

/**
 * Derived session index for completed Clarify turns. The branch tree remains
 * the source of truth; this bounded copy exists only for prompt injection.
 */

const ENTRY_MAX = 1_000;
const FIELD_MAX = 420;
export const CLARIFICATION_MEMORY_MAX_ENTRIES = 8;

function compact(text: string, max = FIELD_MAX): string {
  const value = text.trim().replace(/\s+/g, " ");
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

export function clarificationMemoryEntryFromBranch(
  branch: BranchNode,
  now = Date.now(),
): ClarificationMemoryEntry | null {
  const turns = [
    { question: branch.userQuestion, answer: branch.assistantMessage },
    ...(branch.replies ?? []).map((reply) => ({
      question: reply.userQuestion,
      answer: reply.assistantMessage,
    })),
  ].filter((turn) => turn.answer.trim());
  if (turns.length === 0) return null;

  const summary = turns
    .slice(-3)
    .map(
      (turn, index) =>
        `${index + 1}. ${compact(turn.question, 180)} → ${compact(turn.answer)}`,
    )
    .join("\n");

  return {
    branchId: branch.id,
    anchor: compact(branch.anchor.quotedText, 180),
    summary: compact(summary, ENTRY_MAX),
    adopted: Boolean(branch.adoptedAt),
    updatedAt: now,
  };
}

export function upsertClarificationMemory(
  current: ClarificationMemoryEntry[] | null | undefined,
  entry: ClarificationMemoryEntry,
): ClarificationMemoryEntry[] {
  return [...(current ?? []).filter((item) => item.branchId !== entry.branchId), entry]
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(-CLARIFICATION_MEMORY_MAX_ENTRIES);
}

export function formatClarificationMemoryAddendum(
  entries: ClarificationMemoryEntry[] | null | undefined,
  locale: Locale,
): string | null {
  const recent = (entries ?? [])
    .filter((entry) => entry.summary.trim())
    .slice(-CLARIFICATION_MEMORY_MAX_ENTRIES);
  if (recent.length === 0) return null;

  const header =
    locale === "zh"
      ? [
          "【本会话共享澄清】",
          "以下是同一会话中已经补充解释的局部信息。主线与所有澄清分支均可使用；若与较新的用户消息冲突，以较新的消息为准。",
        ]
      : [
          "[Shared clarifications in this session]",
          "These are local explanations established elsewhere in this session. Main and Clarify turns may use them; newer user messages take precedence.",
        ];
  const lines = recent.map((entry) => {
    const state = entry.adopted
      ? locale === "zh"
        ? "已并入主线"
        : "merged into main"
      : locale === "zh"
        ? "补充说明"
        : "supplement";
    return `- [${state}] “${entry.anchor}”\n  ${entry.summary}`;
  });
  return [...header, "", ...lines].join("\n");
}
