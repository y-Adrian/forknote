/**
 * Split model output that wraps chain-of-thought in think / thinking tags.
 * Supports complete and still-open blocks (streaming).
 *
 * Provider formats differ:
 * - Many OpenAI-compat gateways: `delta.reasoning_content`
 * - Ollama OpenAI `/v1`: `delta.reasoning` (from native `message.thinking`)
 * - Some local / older templates: `<think>…</think>` (or thinking/reasoning) inside `content`
 */

const THINK_BLOCK_RE =
  /<(?:think|thinking|reasoning)>([\s\S]*?)(?:<\/(?:think|thinking|reasoning)>|$)/gi;

const THINK_STRIP_RE =
  /<(?:think|thinking|reasoning)>[\s\S]*?(?:<\/(?:think|thinking|reasoning)>|$)/gi;

/** Trailing incomplete open tag, e.g. `<thi` mid-stream */
const PARTIAL_OPEN_TAG_RE =
  /<(?:t(?:h(?:i(?:n(?:k(?:i(?:n(?:g)?)?)?)?)?)?)?|re(?:a(?:s(?:o(?:n(?:i(?:n(?:g)?)?)?)?)?)?)?)?$/i;

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

/** Merge API reasoning channel with any think-tags found in content. */
export function mergeReasoningChannels(
  apiReasoning: string,
  contentRaw: string,
): { content: string; reasoning: string } {
  const fromTags = splitReasoningFromContent(contentRaw);
  const reasoning = [apiReasoning.trim(), fromTags.reasoning.trim()]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  // Strip tags whenever present (even if body is still empty mid-stream).
  const content = fromTags.hadThinkTags ? fromTags.content : contentRaw;

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
