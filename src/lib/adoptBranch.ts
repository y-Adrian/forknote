import type { BranchNode } from "../types";
import type { Locale } from "./i18n";
import { anchorForAnswerPoint } from "./points";

const ADOPT_SUMMARY_MAX = 480;
const ADOPT_BODY_MAX = 32_000;

const ADOPT_MARKER_RE = /<!--\s*\/?forknote-adopted:[^>]*-->/g;
const ADOPT_BLOCK_RE =
  /<!--\s*forknote-adopted:([A-Za-z0-9_-]+)\s*-->\s*([\s\S]*?)\s*<!--\s*\/forknote-adopted:\1\s*-->/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function truncateAdoptSummary(text: string, max = ADOPT_SUMMARY_MAX): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function clipAdoptBody(text: string): string {
  const t = text.trim();
  if (t.length <= ADOPT_BODY_MAX) return t;
  return `${t.slice(0, ADOPT_BODY_MAX)}\n…`;
}

export function stripAdoptMarkers(text: string): string {
  return text.replace(ADOPT_MARKER_RE, "").replace(/\n{3,}/g, "\n\n");
}

export type AdoptedContentSegment =
  | { type: "markdown"; text: string }
  | { type: "adopted"; branchId: string; label: string; body: string };

export function parseAdoptedInner(raw: string): { label: string; body: string } {
  const unquoted = raw
    .split("\n")
    .map((line) => line.replace(/^>\s?/, ""))
    .join("\n")
    .trim();
  const colonInside = /^\*\*(.+?)[：:]\*\*\s*([\s\S]*)$/.exec(unquoted);
  if (colonInside) {
    return { label: colonInside[1].trim(), body: colonInside[2].trim() };
  }
  const colonAfter = /^\*\*(.+?)\*\*[：:]\s*([\s\S]*)$/.exec(unquoted);
  if (colonAfter) {
    return { label: colonAfter[1].trim(), body: colonAfter[2].trim() };
  }
  const headed = /^\*\*(.+?)\*\*\s*(?:\n+)([\s\S]*)$/.exec(unquoted);
  if (headed) return { label: headed[1].trim(), body: headed[2].trim() };
  return { label: "", body: unquoted };
}

/** Split parent markdown so adopted notes can render as cards, not raw HTML comments. */
export function splitAdoptedSegments(content: string): AdoptedContentSegment[] {
  const out: AdoptedContentSegment[] = [];
  let last = 0;
  const re = new RegExp(ADOPT_BLOCK_RE.source, "g");
  for (const match of content.matchAll(re)) {
    const idx = match.index ?? 0;
    if (idx > last) {
      const text = stripAdoptMarkers(content.slice(last, idx));
      if (text.trim()) out.push({ type: "markdown", text });
    }
    const inner = parseAdoptedInner(match[2] ?? "");
    out.push({
      type: "adopted",
      branchId: match[1] ?? "",
      label: inner.label,
      body: inner.body,
    });
    last = idx + match[0].length;
  }
  if (last === 0) {
    const text = stripAdoptMarkers(content);
    return [{ type: "markdown", text }];
  }
  if (last < content.length) {
    const text = stripAdoptMarkers(content.slice(last));
    if (text.trim()) out.push({ type: "markdown", text });
  }
  return out.length > 0 ? out : [{ type: "markdown", text: content }];
}

export function adoptedBodyNeedsCollapse(body: string): boolean {
  const t = body.trim();
  if (t.length > 220) return true;
  return t.split("\n").filter((l) => l.trim()).length > 4;
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
    `**${label}**`,
    "",
    clipAdoptBody(summary),
    `<!-- /forknote-adopted:${branchId} -->`,
  ].join("\n");
}

/**
 * Insert (or refresh) an adopt note into the parent assistant message.
 * Does not overwrite the original body — inserts a labeled clarification card.
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
    summary,
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

/** Remove adopt note from parent content (alias for callers). */
export function removeAdoptNoteFromContent(
  content: string,
  branchId: string,
): string {
  return stripAdoptedNote(content, branchId);
}

/** Drop adoptedAt / adoptedSummary from a branch in the tree. */
export function clearBranchAdoptFields(
  nodes: BranchNode[],
  branchId: string,
): BranchNode[] {
  return nodes.map((node) => {
    const children = clearBranchAdoptFields(node.children, branchId);
    if (node.id !== branchId) {
      return children === node.children ? node : { ...node, children };
    }
    const { adoptedAt: _a, adoptedSummary: _s, ...rest } = node;
    return { ...rest, children };
  });
}

