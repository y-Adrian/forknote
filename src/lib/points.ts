import type {
  Anchor,
  PointAttributionMap,
  PointDoubtMap,
  PointVerdictMap,
} from "../types";
import { describePointFeedbackForAgent } from "./feedback";

/**
 * 分点回答协议：
 * 模型按「【1】…【2】…」格式输出观点/步骤。
 * 解析器把回答拆成 前言 + 若干分点段。
 */

export interface AnswerPoint {
  /** 分点编号，从 1 开始 */
  index: number;
  /** 分点 Markdown 内容（不含【N】标记本身） */
  content: string;
}

export interface ParsedAnswer {
  /** 分点之前的引导文字（可能为空） */
  preamble: string;
  points: AnswerPoint[];
}

/**
 * Match a point-start line and return the body after the 【N】 marker.
 * Do not steal the opening `**` of bold titles like `【1】**title**`
 * (old regex left a dangling `title**` in the UI).
 */
export function matchPointStartLine(
  line: string,
): { index: number; rest: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // **【N】** body — marker wrapped in matching emphasis
  let m = /^(\*{1,2})\s*【(\d{1,2})】\s*\1\s*(.*)$/.exec(trimmed);
  if (m) {
    return { index: Number(m[2]), rest: m[3].trim() };
  }

  // **【N】body** / **【N】body — leading stars wrap past the marker; keep them
  // on the body so Markdown bold/italic still balances.
  m = /^(\*{1,2})\s*【(\d{1,2})】\s*(.*)$/.exec(trimmed);
  if (m) {
    const stars = m[1];
    let rest = m[3].trim();
    if (rest && !rest.startsWith(stars)) {
      rest = `${stars}${rest}`;
    }
    return { index: Number(m[2]), rest };
  }

  // List bullet: "- 【N】" / "* 【N】" (space after * required)
  m = /^[-*]\s+【(\d{1,2})】\s*(.*)$/.exec(trimmed);
  if (m) {
    return { index: Number(m[1]), rest: m[2].trim() };
  }

  // Bare 【N】 — leave any following **title** intact
  m = /^【(\d{1,2})】\s*(.*)$/.exec(trimmed);
  if (m) {
    return { index: Number(m[1]), rest: m[2].trim() };
  }

  return null;
}

/**
 * 把回答按「【N】」行拆分。
 * 支持标记出现在行首（模型被提示词约束为独立行起始）；
 * 也容忍常见变体：`**【1】**`、`- 【1】`、`【1】**标题**`。
 */
export function parseAnswerPoints(content: string): ParsedAnswer {
  const lines = content.split("\n");
  const points: AnswerPoint[] = [];
  let preambleLines: string[] = [];
  let current: { index: number; lines: string[] } | null = null;

  for (const line of lines) {
    const matched = matchPointStartLine(line);
    if (matched) {
      if (current) {
        points.push({
          index: current.index,
          content: current.lines.join("\n").trim(),
        });
      }
      current = {
        index: matched.index,
        lines: [matched.rest],
      };
    } else if (current) {
      current.lines.push(line);
    } else {
      preambleLines.push(line);
    }
  }

  if (current) {
    points.push({
      index: current.index,
      content: current.lines.join("\n").trim(),
    });
  }

  return {
    preamble: preambleLines.join("\n").trim(),
    points,
  };
}

/** Encode a same-window reply verdict target for `setPointVerdict`. */
export function branchReplyVerdictTargetId(
  branchId: string,
  replyIndex: number,
): string {
  return `${branchId}::r${replyIndex}`;
}

export function parseBranchReplyVerdictTarget(
  targetId: string,
): { branchId: string; replyIndex: number } | null {
  const m = /^(.+)::r(\d+)$/.exec(targetId);
  if (!m) return null;
  return { branchId: m[1], replyIndex: Number(m[2]) };
}

/** 回答是否是分点格式（至少 2 个分点才值得展示裁决 UI） */
export function hasPoints(content: string): boolean {
  return parseAnswerPoints(content).points.length >= 2;
}

/**
 * Streaming preview should not expose protocol markers like `【1】`.
 * Keep one stable Markdown mount, but render point bodies as ordinary prose.
 */
export function stripPointMarkersForPreview(content: string): string {
  let changed = false;
  const lines = content.split("\n").map((line) => {
    const matched = matchPointStartLine(line);
    if (!matched) return line;
    changed = true;
    return matched.rest;
  });
  return changed ? lines.join("\n").replace(/^\n+/, "") : content;
}

/**
 * Build an Anchor for one-click 「澄清此点」 from a numbered point【N】.
 */
export function anchorForAnswerPoint(
  content: string,
  pointIndex: number,
): Anchor | null {
  const parsed = parseAnswerPoints(content);
  const point = parsed.points.find((p) => p.index === pointIndex);
  if (!point) return null;

  const marker = `【${pointIndex}】`;
  let start = content.indexOf(marker);
  if (start < 0) {
    start = content.indexOf(point.content);
    if (start < 0) {
      return {
        startOffset: 0,
        endOffset: Math.min(content.length, point.content.length),
        quotedText: point.content,
        pointIndex,
      };
    }
  }

  let end = content.length;
  const later = parsed.points
    .filter((p) => p.index > pointIndex)
    .sort((a, b) => a.index - b.index);
  for (const next of later) {
    const nextMarker = `【${next.index}】`;
    const nextStart = content.indexOf(nextMarker, start + marker.length);
    if (nextStart > start) {
      end = nextStart;
      break;
    }
  }

  const slice = content.slice(start, end).trim();
  // Prefer point body (no 【N】) — matches PointizedAnswer DOM for reopen highlights.
  const quoted = point.content.trim() || slice;
  return {
    startOffset: start,
    endOffset: end,
    quotedText: quoted,
    pointIndex,
  };
}

/** Lowest rejected point index, or null if none. */
export function earliestRejectIndex(
  verdicts: PointVerdictMap | undefined,
): number | null {
  if (!verdicts) return null;
  const rejects = Object.entries(verdicts)
    .filter(([, v]) => v === "reject")
    .map(([k]) => Number(k))
    .filter((n) => Number.isFinite(n));
  if (!rejects.length) return null;
  return Math.min(...rejects);
}

export function hasExplicitAcceptOrReject(
  verdicts: PointVerdictMap | undefined,
): boolean {
  if (!verdicts) return false;
  return Object.values(verdicts).some((v) => v === "accept" || v === "reject");
}

/**
 * Checkpoint note for archive source: where the user branched, what to keep.
 * Unmarked points count as adopted unless rejected.
 */
export function formatCheckpointForArchive(
  content: string,
  verdicts: PointVerdictMap | undefined,
): string | null {
  if (!hasExplicitAcceptOrReject(verdicts)) return null;
  const parsed = parseAnswerPoints(content);
  if (parsed.points.length < 2) return null;

  const rejected = Object.entries(verdicts ?? {})
    .filter(([, v]) => v === "reject")
    .map(([k]) => Number(k))
    .sort((a, b) => a - b);
  const unsure = Object.entries(verdicts ?? {})
    .filter(([, v]) => v === "unsure")
    .map(([k]) => Number(k))
    .sort((a, b) => a - b);
  const cut = earliestRejectIndex(verdicts);
  const rejectedSet = new Set(rejected);
  const unsureSet = new Set(unsure);
  const accepted = parsed.points
    .map((p) => p.index)
    .filter((n) => {
      if (rejectedSet.has(n) || unsureSet.has(n)) return false;
      if (cut != null && n > cut && !verdicts?.[n]) return false;
      return true;
    })
    .sort((a, b) => a - b);

  const lines: string[] = ["### 检查点（阶段性整合）"];
  if (accepted.length) {
    lines.push(
      `- 已采纳（含未拒绝的默认采纳）：${accepted.map((n) => `【${n}】`).join(" ")}`,
    );
  }
  if (rejected.length) {
    lines.push(`- 已不采纳：${rejected.map((n) => `【${n}】`).join(" ")}`);
  }
  if (unsure.length) {
    lines.push(`- 存疑待验证：${unsure.map((n) => `【${n}】`).join(" ")}`);
  }
  if (cut != null) {
    lines.push(
      `- 截断：从【${cut}】起，其后未单独裁决的步骤视为过时，不要再当作可行方案。请把已采纳步骤、已收进主线的澄清、以及不采纳原因整合成下一轮底座。`,
    );
  } else {
    lines.push(
      "- 请把已采纳步骤（含未拒绝的默认采纳）与已收进主线的澄清整合成下一轮底座。",
    );
  }
  return lines.join("\n");
}

/**
 * 构建带裁决标注的回答文本，用于发给模型的上下文。
 * 未拒绝的分点按默认采纳；不采纳/存疑可带归因标签。
 * 更早分点被不采纳时，其后未裁决步骤标记为已截断。
 */
export function annotateContentWithVerdicts(
  content: string,
  verdicts: PointVerdictMap | undefined,
  doubts?: PointDoubtMap,
  attributions?: PointAttributionMap,
): string {
  const parsed = parseAnswerPoints(content);
  if (parsed.points.length === 0) return content;

  const cut = earliestRejectIndex(verdicts);
  const parts: string[] = [];
  if (parsed.preamble) parts.push(parsed.preamble);

  for (const p of parsed.points) {
    const verdict = verdicts?.[p.index];
    const truncated = cut != null && p.index > cut && !verdict;
    parts.push(
      describePointFeedbackForAgent({
        index: p.index,
        content: p.content,
        verdict,
        doubt: doubts?.[p.index],
        attribution: attributions?.[p.index],
        truncated,
      }),
    );
  }

  return parts.join("\n\n");
}
