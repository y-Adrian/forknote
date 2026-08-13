import type {
  ArchiveSnapshot,
  BranchNode,
  ChatMessage,
  FeedbackEvent,
  ThreadRoot,
} from "../types";
import { flattenAdoptedForPlaintext } from "./adoptBranch";
import { getLocale, withReplyLanguage, type Locale } from "./i18n";
import { annotateContentWithVerdicts, formatCheckpointForArchive } from "./points";
import { firstUserMessage } from "./thread";
import type { ChatMessage as ApiChatMessage } from "./openai";

const QUOTE_MAX = 120;
const CLARIFY_MAX = 220;
const CLARIFY_ADOPTED_MAX = 4000;
const MSG_MAX = 4000;
const FEEDBACK_LOG_MAX = 24;

function truncate(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function flattenClarifications(nodes: BranchNode[], lines: string[]): void {
  for (const node of nodes) {
    const answer = annotateContentWithVerdicts(
      flattenAdoptedForPlaintext(node.assistantMessage),
      node.pointVerdicts,
      node.pointDoubts,
      node.pointAttributions,
    );
    if (!answer.trim() && !node.adoptedSummary?.trim()) {
      if (node.children.length) flattenClarifications(node.children, lines);
      continue;
    }
    const adopted = Boolean(node.adoptedAt);
    const body = adopted
      ? truncate(
          node.adoptedSummary?.trim() || answer,
          CLARIFY_ADOPTED_MAX,
        )
      : truncate(answer, CLARIFY_MAX);
    const flag = adopted ? "【已收进主线】" : "【未采纳进主线】";
    const point =
      node.anchor.pointIndex != null ? ` · 分点【${node.anchor.pointIndex}】` : "";
    lines.push(
      `- ${flag}${point} 澄清「${truncate(node.anchor.quotedText, QUOTE_MAX)}」→ ${body}`,
    );
    if (node.children.length) flattenClarifications(node.children, lines);
  }
}

function formatFeedbackLogSummary(events: FeedbackEvent[]): string {
  if (!events.length) return "";
  const slice = events.slice(-FEEDBACK_LOG_MAX);
  const lines = slice.map((e) => {
    const src = e.source ?? (e.explicit ? "explicit" : "unknown");
    const attr = e.attribution ? ` · ${e.attribution}` : "";
    return `- #${e.pointIndex} ${e.signal} (${src}, w=${e.weight})${attr}`;
  });
  return `## 反馈事件摘要（最近 ${slice.length} 条）\n${lines.join("\n")}`;
}

export type BuildArchiveSourceOptions = {
  feedbackLog?: FeedbackEvent[] | null;
};

/** Build the raw material fed to the archive model. */
export function buildArchiveSource(
  thread: ThreadRoot,
  options?: BuildArchiveSourceOptions,
): string {
  const blocks: string[] = [];
  const topic = firstUserMessage(thread)?.trim();
  if (topic) {
    blocks.push(`# 原始问题\n${topic}`);
  }

  let turn = 0;
  for (const msg of thread.messages) {
    if (!msg.content.trim()) continue;
    if (msg.role === "user") {
      turn += 1;
      blocks.push(`## 用户 · 第 ${turn} 轮\n${truncate(msg.content, MSG_MAX)}`);
      continue;
    }
    const annotated = annotateContentWithVerdicts(
      flattenAdoptedForPlaintext(msg.content),
      msg.pointVerdicts,
      msg.pointDoubts,
      msg.pointAttributions,
    );
    blocks.push(
      `## 助手 · 第 ${turn || 1} 轮（含分点裁决标注）\n${truncate(annotated, MSG_MAX)}`,
    );
    const clarifications: string[] = [];
    flattenClarifications(msg.children, clarifications);
    if (clarifications.length) {
      blocks.push(`### 本轮澄清（含是否已收进主线）\n${clarifications.join("\n")}`);
    }
    const checkpoint = formatCheckpointForArchive(msg.content, msg.pointVerdicts);
    if (checkpoint) blocks.push(checkpoint);
  }

  const feedback = formatFeedbackLogSummary(options?.feedbackLog ?? []);
  if (feedback) blocks.push(feedback);

  return blocks.join("\n\n");
}

export const ARCHIVE_SYSTEM = `你是开发日志编辑。用户会提供一段「主线问答 + 分点裁决 + 选中澄清」的原始材料。
请整理成一篇可继续迭代的**开发日志草稿**（Markdown）。

要求：
1. 分点反馈是校准信号：**未拒绝即默认采纳**；区分「主动采纳」「默认采纳」「被动使用（复制）」；「存疑」写成待验证/置信度缺口；「不采纳」按已确认归因（目标/约束/路线/专业判断/表达）写成对照教训，勿当作仍可行方案。
2. 澄清必须区分两类：标记「已收进主线」的结论写入正文实践要点；标记「未采纳进主线」的只进「未决 / 旁路探索」，不要当成已定论。
3. 若材料含反馈事件摘要，用它校准权重（hypothesis_confirm / passive_copy / explicit），不要编造未出现的事件。
4. 结构建议：背景 / 对该用户有效的决策方式 / 实践要点（路径、命令、配置若材料里有则保留） / 已收进主线的澄清结论 / 可信度缺口与未决问题 / 不适合该用户的策略（简要）。
5. 简明、可当作后续对话的上下文底座；不要写「你可以继续问我…」类客套。
6. 不要编造材料中没有的事实。
7. 第一行用短标题（不要用 # 以外的装饰），随后正文。
8. 若材料含「检查点（阶段性整合）」：已不采纳分点之后未裁决的步骤视为过时，不要写进实践要点；把已采纳步骤与「已收进主线」的澄清写成下一轮底座。检查点文档应可直接作为后续对话上下文，也便于阶段性导出。`;

export function archiveSystemPrompt(locale: Locale = getLocale()): string {
  return withReplyLanguage(ARCHIVE_SYSTEM, locale);
}

export function archiveUserPrompt(
  source: string,
  locale: Locale = getLocale(),
): string {
  if (locale === "zh") {
    return `请根据以下原始材料整理开发日志草稿：\n\n${source}`;
  }
  return `Please turn the following raw material into a development-log draft:\n\n${source}`;
}

export function archiveTitleFromContent(content: string, fallback: string): string {
  const first = content
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!first) return fallback;
  const cleaned = first.replace(/^#+\s*/, "").trim();
  if (!cleaned) return fallback;
  return cleaned.length > 48 ? `${cleaned.slice(0, 48)}…` : cleaned;
}

export function lastNonEmptyMessageId(thread: ThreadRoot): string | null {
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const m = thread.messages[i];
    if (m?.content.trim()) return m.id;
  }
  return null;
}

/** Messages strictly after the archived cutoff (by array order). */
export function messagesAfterArchive(
  thread: ThreadRoot,
  archive: ArchiveSnapshot,
): ChatMessage[] {
  const idx = thread.messages.findIndex((m) => m.id === archive.throughMessageId);
  if (idx < 0) return thread.messages.filter((m) => m.content.trim());
  return thread.messages.slice(idx + 1).filter((m) => m.content.trim());
}

export function buildArchiveContextMessages(
  archive: ArchiveSnapshot,
  later: ChatMessage[],
  baseSystem: string,
  locale: Locale = getLocale(),
): ApiChatMessage[] {
  const modeNote =
    locale === "zh"
      ? `当前会话处于「归档上下文」模式：上方开发日志是已校准的归纳文，其后消息是归档之后的续聊。请优先依据日志与后续消息继续。
- 用户询问「之前做了什么 / 先前结论」时，根据归档日志与后续消息概括，不要声称没有先前记录。
- 不要无谓复述已被压缩掉的长篇原文；若日志与用户新问题冲突，以用户新问题为准并指出差异。`
      : `This session is in archive-context mode: the development log above is the calibrated summary; later messages are chat after the archive. Prefer the log and subsequent messages.
- When asked what was done earlier, summarize from the archive log and later messages — do not claim there is no prior record.
- Do not needlessly restate long text that was compressed away; if the log conflicts with a new user question, follow the new question and note the difference.`;

  const system = `${baseSystem}

${modeNote}`;

  const archiveUser =
    locale === "zh"
      ? `【已归档的开发日志】\n标题：${archive.title}\n\n${archive.content}`
      : `[Archived development log]\nTitle: ${archive.title}\n\n${archive.content}`;

  const archiveAck =
    locale === "zh"
      ? "已加载归档日志作为后续对话底座。请继续你的问题；我会在日志结论上推进，并标出仍待验证的点。"
      : "Loaded the archive log as the base for follow-up chat. Continue with your question; I will build on the log and flag anything still unverified.";

  return [
    { role: "system", content: system },
    {
      role: "user",
      content: archiveUser,
    },
    {
      role: "assistant",
      content: archiveAck,
    },
    ...later.map((m) => ({
      role: m.role as "user" | "assistant",
      content: annotateContentWithVerdicts(
        flattenAdoptedForPlaintext(m.content),
        m.pointVerdicts,
        m.pointDoubts,
        m.pointAttributions,
      ),
    })),
  ];
}
