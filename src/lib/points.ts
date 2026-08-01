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

/**
 * 构建带裁决标注的回答文本，用于发给模型的上下文。
 * 对齐反馈闭环：主动采纳 ≠ 默认沉默；不采纳/存疑可带归因标签。
 */
export function annotateContentWithVerdicts(
  content: string,
  verdicts: PointVerdictMap | undefined,
  doubts?: PointDoubtMap,
  attributions?: PointAttributionMap,
): string {
  if (!verdicts || Object.keys(verdicts).length === 0) return content;

  const parsed = parseAnswerPoints(content);
  if (parsed.points.length === 0) return content;

  const parts: string[] = [];
  if (parsed.preamble) parts.push(parsed.preamble);

  for (const p of parsed.points) {
    parts.push(
      describePointFeedbackForAgent({
        index: p.index,
        content: p.content,
        verdict: verdicts[p.index],
        doubt: doubts?.[p.index],
        attribution: attributions?.[p.index],
      }),
    );
  }

  return parts.join("\n\n");
}
