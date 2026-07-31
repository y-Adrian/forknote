/**
 * Split model output that wraps chain-of-thought in think / thinking tags.
 * Supports complete and still-open blocks (streaming).
 *
 * Provider formats differ:
 * - Many OpenAI-compat gateways: `delta.reasoning_content`
 * - Ollama OpenAI `/v1`: `delta.reasoning` (from native `message.thinking`)
 * - Some local / older templates: `<think>…</think>` (or thinking/reasoning) inside `content`
 * - DeepSeek (esp. zh UI): untagged English or Chinese meta-CoT before the real answer
 */

const THINK_BLOCK_RE =
  /<(?:think|thinking|reasoning)\b[^>]*>([\s\S]*?)(?:<\/(?:think|thinking|reasoning)>|$)/gi;

const THINK_STRIP_RE =
  /<(?:think|thinking|reasoning)\b[^>]*>[\s\S]*?(?:<\/(?:think|thinking|reasoning)>|$)/gi;

/** Trailing incomplete open tag, e.g. `<thi` mid-stream */
const PARTIAL_OPEN_TAG_RE =
  /<(?:t(?:h(?:i(?:n(?:k(?:i(?:n(?:g)?)?)?)?)?)?)?|re(?:a(?:s(?:o(?:n(?:i(?:n(?:g)?)?)?)?)?)?)?)?$/i;

const CJK_RE = /[\u4e00-\u9fff]/;
const LATIN_LETTER_RE = /[A-Za-z]/;

/** English meta-reasoning openers DeepSeek often dumps into content on zh turns. */
const EN_META_OPEN_RE =
  /^(?:The user\b|I need to\b|I should\b|I(?:'ll| will)\b|Let(?:'s| me)\b|Looking at\b|The question is\b|My (?:task|goal|plan)\b|First,\s*I\b|Okay,\s*I\b|Alright,\s*I\b|So\s+I\b|Based on (?:the )?(?:tool|user|request)\b)/i;

/** Chinese meta-CoT openers (planning monologue before the real answer). */
const ZH_META_OPEN_RE =
  /^(?:我们需要|用户(?:最新|要求|说)|需要调用|让我们|因此我|所以我|注意[：:]|实际上|计划阶段|严格服从|为了安全|我认为|仔细阅读|看历史|然而|或许|根据规则|系统说|系统提示)/;

/** Chinese answer / status openers that mark the end of meta-CoT. */
const ZH_ANSWER_OPEN_RE =
  /^(?:已(?:按要求)?(?:完成|执行|列出|修改|创建)|任务已完成|以下是|完整输出|命令成功|我先(?:运行|执行)|现在(?:开始|执行|调用)|将先执行|需要批准后才能运行)/;

export function splitReasoningFromContent(raw: string): {
  content: string;
  reasoning: string;
  /** True when a think-tag (complete, open, or partial open) was present */
  hadThinkTags: boolean;
} {
  const parts: string[] = [];
  THINK_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let hadThinkTags = false;
  while ((match = THINK_BLOCK_RE.exec(raw)) !== null) {
    hadThinkTags = true;
    parts.push(match[1] ?? "");
  }

  let content = raw.replace(THINK_STRIP_RE, "");
  const partial = content.match(PARTIAL_OPEN_TAG_RE);
  if (partial) {
    hadThinkTags = true;
    content = content.slice(0, content.length - partial[0].length);
  }

  return {
    // Keep raw whitespace during stream; callers trim for display.
    content,
    reasoning: parts.join("\n\n"),
    hadThinkTags,
  };
}

/**
 * Peel leading untagged English meta-CoT when a Chinese answer follows.
 * Conservative: English-only replies and en UI are left unchanged.
 */
export function peelUntaggedBilingualReasoning(
  raw: string,
  opts?: { expectChineseAnswer?: boolean },
): { content: string; reasoning: string; peeled: boolean } {
  if (!opts?.expectChineseAnswer) {
    return { content: raw, reasoning: "", peeled: false };
  }
  const text = raw;
  if (!text.trim() || !CJK_RE.test(text) || !LATIN_LETTER_RE.test(text)) {
    return { content: raw, reasoning: "", peeled: false };
  }

  // Prefer a blank-line boundary before the first CJK-heavy paragraph.
  const paras = text.split(/\n{2,}/);
  let cutAt = -1;
  let enBefore = "";
  let built = "";
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i] ?? "";
    const cjkCount = (p.match(/[\u4e00-\u9fff]/g) ?? []).length;
    if (cjkCount >= 2 && i > 0) {
      cutAt = built.length;
      enBefore = text.slice(0, cutAt).trim();
      break;
    }
    built += (i === 0 ? "" : "\n\n") + p;
  }

  // Fallback: first line with ≥2 CJK chars.
  if (cutAt < 0) {
    const lines = text.split("\n");
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const cjkCount = (line.match(/[\u4e00-\u9fff]/g) ?? []).length;
      if (cjkCount >= 2 && offset > 0) {
        cutAt = offset;
        enBefore = text.slice(0, cutAt).trim();
        break;
      }
      offset += line.length + (i < lines.length - 1 ? 1 : 0);
    }
  }

  if (cutAt <= 0 || !enBefore) {
    return { content: raw, reasoning: "", peeled: false };
  }

  // Must look like meta-reasoning, not a short English loanphrase.
  if (enBefore.length < 40) {
    return { content: raw, reasoning: "", peeled: false };
  }
  const enSentences = enBefore
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => /[A-Za-z]{3,}/.test(s));
  if (enSentences.length < 2) {
    return { content: raw, reasoning: "", peeled: false };
  }
  const head = enBefore.trimStart().slice(0, 120);
  if (!EN_META_OPEN_RE.test(head) && !enSentences.some((s) => EN_META_OPEN_RE.test(s))) {
    return { content: raw, reasoning: "", peeled: false };
  }

  // Don't peel through fenced code at the start.
  if (/^```/.test(enBefore.trimStart())) {
    return { content: raw, reasoning: "", peeled: false };
  }

  const content = text.slice(cutAt).replace(/^\s*\n+/, "");
  if (!CJK_RE.test(content)) {
    return { content: raw, reasoning: "", peeled: false };
  }

  return { content, reasoning: enBefore, peeled: true };
}

/**
 * Peel leading Chinese meta-CoT when a clearer answer paragraph follows.
 * Only for zh UI; requires meta openers + a later answer-style opener.
 */
export function peelUntaggedChineseMetaReasoning(
  raw: string,
  opts?: { expectChineseAnswer?: boolean },
): { content: string; reasoning: string; peeled: boolean } {
  if (!opts?.expectChineseAnswer) {
    return { content: raw, reasoning: "", peeled: false };
  }
  const text = raw;
  if (!text.trim() || !CJK_RE.test(text)) {
    return { content: raw, reasoning: "", peeled: false };
  }
  if (/^```/.test(text.trimStart())) {
    return { content: raw, reasoning: "", peeled: false };
  }

  const head = text.trimStart().slice(0, 80);
  if (!ZH_META_OPEN_RE.test(head)) {
    return { content: raw, reasoning: "", peeled: false };
  }

  const paras = text.split(/\n{2,}/);
  if (paras.length < 2) {
    return { content: raw, reasoning: "", peeled: false };
  }

  let built = "";
  let cutAt = -1;
  for (let i = 0; i < paras.length; i++) {
    const p = (paras[i] ?? "").trim();
    if (i > 0 && ZH_ANSWER_OPEN_RE.test(p)) {
      cutAt = built.length;
      break;
    }
    built += (i === 0 ? "" : "\n\n") + (paras[i] ?? "");
  }

  if (cutAt < 60) {
    return { content: raw, reasoning: "", peeled: false };
  }

  const meta = text.slice(0, cutAt).trim();
  const content = text.slice(cutAt).replace(/^\s*\n+/, "");
  // Meta must look like a monologue (multiple sentences / substantial length).
  if (meta.length < 60 || content.length < 8) {
    return { content: raw, reasoning: "", peeled: false };
  }
  const metaLines = meta.split(/\n+/).filter((l) => l.trim().length > 0);
  if (metaLines.length < 2 && meta.length < 120) {
    return { content: raw, reasoning: "", peeled: false };
  }

  return { content, reasoning: meta, peeled: true };
}

export type MergeReasoningOptions = {
  /** When true (zh UI / CJK ask), peel untagged English/Chinese meta-CoT before answers. */
  expectChineseAnswer?: boolean;
};

/** Merge API reasoning channel with any think-tags found in content. */
export function mergeReasoningChannels(
  apiReasoning: string,
  contentRaw: string,
  opts?: MergeReasoningOptions,
): { content: string; reasoning: string } {
  const fromTags = splitReasoningFromContent(contentRaw);
  // Strip tags whenever present (even if body is still empty mid-stream).
  let content = fromTags.hadThinkTags ? fromTags.content : contentRaw;
  let peeledReasoning = "";

  if (!fromTags.hadThinkTags && opts?.expectChineseAnswer) {
    const enPeeled = peelUntaggedBilingualReasoning(content, {
      expectChineseAnswer: true,
    });
    if (enPeeled.peeled) {
      content = enPeeled.content;
      peeledReasoning = enPeeled.reasoning;
    } else {
      const zhPeeled = peelUntaggedChineseMetaReasoning(content, {
        expectChineseAnswer: true,
      });
      if (zhPeeled.peeled) {
        content = zhPeeled.content;
        peeledReasoning = zhPeeled.reasoning;
      }
    }
  }

  const reasoning = [apiReasoning.trim(), fromTags.reasoning.trim(), peeledReasoning.trim()]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  return { content, reasoning };
}

/**
 * Track incremental content/reasoning emissions while a full content buffer grows.
 * Avoids duplicating think-tag text when re-parsing the accumulated stream.
 */
export function diffSplitReasoning(
  prev: { contentLen: number; reasoningLen: number },
  rawContent: string,
): {
  contentDelta: string;
  reasoningDelta: string;
  content: string;
  reasoning: string;
  next: { contentLen: number; reasoningLen: number };
} {
  const split = splitReasoningFromContent(rawContent);
  const contentDelta =
    split.content.length > prev.contentLen
      ? split.content.slice(prev.contentLen)
      : "";
  const reasoningDelta =
    split.reasoning.length > prev.reasoningLen
      ? split.reasoning.slice(prev.reasoningLen)
      : "";
  return {
    contentDelta,
    reasoningDelta,
    content: split.content,
    reasoning: split.reasoning,
    next: {
      contentLen: split.content.length,
      reasoningLen: split.reasoning.length,
    },
  };
}
