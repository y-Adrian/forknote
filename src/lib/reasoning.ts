/**
 * Split model output that wraps chain-of-thought in think / thinking tags.
 * Supports complete and still-open blocks (streaming).
 *
 * Provider formats differ:
 * - Many OpenAI-compat gateways: `delta.reasoning_content`
 * - Ollama OpenAI `/v1`: `delta.reasoning` (from native `message.thinking`)
 * - Some local / older templates: `<think>…</think>` (or thinking/reasoning) inside `content`
 * - DeepSeek (esp. zh UI): untagged English meta-CoT before a Chinese answer
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

export type MergeReasoningOptions = {
  /** When true (zh UI / CJK ask), peel untagged English meta-CoT before Chinese answers. */
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
    const peeled = peelUntaggedBilingualReasoning(content, {
      expectChineseAnswer: true,
    });
    if (peeled.peeled) {
      content = peeled.content;
      peeledReasoning = peeled.reasoning;
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
