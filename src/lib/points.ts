import type { PointDoubtMap, PointVerdictMap } from "../types";

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

const POINT_RE = /^【(\d{1,2})】/;

/**
 * 把回答按「【N】」行拆分。
 * 支持标记出现在行首（模型被提示词约束为独立行起始）。
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

/** 回答是否是分点格式（至少 2 个分点才值得展示裁决 UI） */
export function hasPoints(content: string): boolean {
  return parseAnswerPoints(content).points.length >= 2;
}

/**
 * 构建带裁决标注的回答文本，用于发给模型的上下文：
 * - 缺省 / 采纳 → 视为已采纳（含正文）
 * - 不采纳 → 剔除正文，仅留拒绝标记
 * - 存疑 → 保留正文，并附上用户疑问
 *
 * 若没有任何裁决记录，直接返回原文（全部隐含采纳）。
 */
export function annotateContentWithVerdicts(
  content: string,
  verdicts: PointVerdictMap | undefined,
  doubts?: PointDoubtMap,
): string {
  if (!verdicts || Object.keys(verdicts).length === 0) return content;

  const parsed = parseAnswerPoints(content);
  if (parsed.points.length === 0) return content;

  const parts: string[] = [];
  if (parsed.preamble) parts.push(parsed.preamble);

  for (const p of parsed.points) {
    const v = verdicts[p.index];
    if (v === "reject") {
      parts.push(
        `【${p.index}】（用户已拒绝此点，内容已省略，请勿再基于此点展开）`,
      );
    } else if (v === "unsure") {
      const doubt = doubts?.[p.index]?.trim();
      if (doubt) {
        parts.push(`【${p.index}】（用户存疑：${doubt}）${p.content}`);
      } else {
        parts.push(`【${p.index}】（用户存疑）${p.content}`);
      }
    } else {
      // accept 或未标记 → 默认采纳
      parts.push(`【${p.index}】（用户已采纳✅）${p.content}`);
    }
  }

  return parts.join("\n\n");
}
