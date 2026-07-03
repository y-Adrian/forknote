import type { PointVerdict, PointVerdictMap } from "../types";

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

export const VERDICT_LABELS: Record<PointVerdict, string> = {
  accept: "采纳",
  unsure: "不置可否",
  reject: "拒绝",
};

/**
 * 构建带裁决标注的回答文本，用于发给模型的上下文：
 * - 拒绝的分点剔除正文，仅留一行标记，防止模型继续沿错误方向展开
 * - 采纳的分点标注 ✅，提示模型这是已确认的结论
 * - 未裁决/不置可否保持原样
 */
export function annotateContentWithVerdicts(
  content: string,
  verdicts: PointVerdictMap | undefined,
): string {
  if (!verdicts || Object.keys(verdicts).length === 0) return content;

  const parsed = parseAnswerPoints(content);
  if (parsed.points.length === 0) return content;

  const parts: string[] = [];
  if (parsed.preamble) parts.push(parsed.preamble);

  for (const p of parsed.points) {
    const v = verdicts[p.index];
    if (v === "reject") {
      parts.push(`【${p.index}】（用户已拒绝此点，内容已省略，请勿再基于此点展开）`);
    } else if (v === "accept") {
      parts.push(`【${p.index}】（用户已采纳✅）${p.content}`);
    } else {
      parts.push(`【${p.index}】${p.content}`);
    }
  }

  return parts.join("\n\n");
}
