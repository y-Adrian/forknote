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

const POINT_RE = /^(?:\*{1,2}|[-*]\s+)?【(\d{1,2})】(?:\*{1,2})?/;

/**
 * 把回答按「【N】」行拆分。
 * 支持标记出现在行首（模型被提示词约束为独立行起始）；
 * 也容忍常见变体：`**【1】**`、`- 【1】`。
 */
export function parseAnswerPoints(content: string): ParsedAnswer {
  const lines = content.split("\n");
  const points: AnswerPoint[] = [];
  let preambleLines: string[] = [];
  let current: { index: number; lines: string[] } | null = null;

  for (const line of lines) {
    const m = POINT_RE.exec(line.trim());
    if (m) {
      if (current) {
        points.push({
          index: current.index,
          content: current.lines.join("\n").trim(),
        });
      }
      current = {
        index: Number(m[1]),
        lines: [line.trim().replace(POINT_RE, "").trim()],
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
  return {
    startOffset: start,
    endOffset: end,
    quotedText: slice || point.content,
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
