import type { BranchNode } from "../types";
import type { Locale } from "./i18n";
import { anchorForAnswerPoint } from "./points";

const ADOPT_SUMMARY_MAX = 480;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function truncateAdoptSummary(text: string, max = ADOPT_SUMMARY_MAX): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/** Strip a previous adopt note for this branch id from parent content. */
export function stripAdoptedNote(content: string, branchId: string): string {
  const start = `<!-- forknote-adopted:${branchId} -->`;
  const end = `<!-- /forknote-adopted:${branchId} -->`;
  const re = new RegExp(
    `\\n?${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n?`,
    "g",
  );
  return content.replace(re, "\n").replace(/\n{3,}/g, "\n\n");
}

export function formatAdoptedBlock(
  branchId: string,
  summary: string,
  locale: Locale,
  pointIndex?: number,
): string {
  const label =
    locale === "zh"
      ? pointIndex != null
        ? `澄清结论（【${pointIndex}】）`
        : "澄清结论"
      : pointIndex != null
        ? `Clarification (point ${pointIndex})`
        : "Clarification";
  return [
    `<!-- forknote-adopted:${branchId} -->`,
    `> **${label}：** ${summary}`,
    `<!-- /forknote-adopted:${branchId} -->`,
  ].join("\n");
}

/**
 * Insert (or refresh) an adopt note into the parent assistant message.
 * Does not overwrite the original body — appends a blockquote note.
 */
export function applyAdoptNoteToContent(
  content: string,
  branch: BranchNode,
  summary: string,
  locale: Locale,
): string {
  const cleaned = stripAdoptedNote(content, branch.id);
  const block = formatAdoptedBlock(
    branch.id,
    truncateAdoptSummary(summary),
    locale,
    branch.anchor.pointIndex,
  );

  const pointIndex = branch.anchor.pointIndex;
  if (pointIndex != null) {
    const pointAnchor = anchorForAnswerPoint(cleaned, pointIndex);
    if (pointAnchor) {
      const before = cleaned.slice(0, pointAnchor.endOffset).replace(/\s+$/, "");
      const after = cleaned.slice(pointAnchor.endOffset).replace(/^\s+/, "");
      return `${before}\n\n${block}${after ? `\n\n${after}` : "\n"}`;
    }
  }

  const quote = branch.anchor.quotedText?.trim();
  if (quote) {
    const idx = cleaned.indexOf(quote);
    if (idx >= 0) {
      const insertAt = idx + quote.length;
      const before = cleaned.slice(0, insertAt).replace(/\s+$/, "");
      const after = cleaned.slice(insertAt).replace(/^\s+/, "");
      return `${before}\n\n${block}${after ? `\n\n${after}` : "\n"}`;
    }
  }

  const end = Math.min(
    Math.max(branch.anchor.endOffset, 0),
    cleaned.length,
  );
  if (end > 0 && end < cleaned.length) {
    const before = cleaned.slice(0, end).replace(/\s+$/, "");
    const after = cleaned.slice(end).replace(/^\s+/, "");
    return `${before}\n\n${block}${after ? `\n\n${after}` : "\n"}`;
  }

  return `${cleaned.trimEnd()}\n\n${block}\n`;
}

/** Prefer latest reply answer, else initial fork answer. */
export function resolveBranchAdoptSource(branch: BranchNode): string {
  const replies = branch.replies ?? [];
  for (let i = replies.length - 1; i >= 0; i--) {
    const text = replies[i]?.assistantMessage?.trim();
    if (text) return text;
  }
  return branch.assistantMessage?.trim() ?? "";
}
