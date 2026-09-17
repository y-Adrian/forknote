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
import { messagesAfterArchive } from "./archiveView";
export {
  buildArchiveContextMessages,
  messagesAfterArchive,
} from "./archiveView";

const QUOTE_MAX = 120;
const CLARIFY_MAX = 220;
/** Adopted clarify bodies used to be 4k; keep lean for archive prompts. */
const CLARIFY_ADOPTED_MAX = 1200;
const CLARIFY_REPLY_KEEP = 3;
/** Recent turns keep more detail; older turns are aggressively capped. */
export const MSG_MAX_RECENT = 2200;
export const MSG_MAX_OLDER = 1000;
const RECENT_TURN_KEEP = 2;
const FEEDBACK_LOG_MAX = 16;
/** Cap previous log body when doing incremental archive. */
export const PREV_ARCHIVE_CONTENT_MAX = 10_000;
/** Hard ceiling on archive/compress user-material size (chars). */
export const ARCHIVE_SOURCE_HARD_MAX = 48_000;
const CODE_FENCE_BODY_MAX = 600;
const TOOL_DUMP_KEEP = 160;

function truncate(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/**
 * Collapse tool-result dumps and huge code fences before per-message caps.
 * Agent turns often leave status/tool noise that burns tokens without helping the log.
 */
export function shrinkTextForArchive(text: string): string {
  let t = text.replace(/\r\n/g, "\n");
  // Tool-result blocks injected into agent transcripts / status pastes
  t = t.replace(
    /【(?:工具结果|run_terminal|list_dir|read_file)[^】\n]*】[^\n]*(?:\n(?!【|#|##)[^\n]*)*/g,
    (block) => {
      const head = block.slice(0, TOOL_DUMP_KEEP).replace(/\s+/g, " ").trim();
      return `${head}…（工具输出已省略）`;
    },
  );
  t = t.replace(/```([\w+-]*)\n([\s\S]*?)```/g, (full, lang: string, body: string) => {
    if (body.length <= CODE_FENCE_BODY_MAX) return full;
    const tag = lang ? `\`\`\`${lang}` : "```";
    return `${tag}\n${body.slice(0, CODE_FENCE_BODY_MAX)}\n…\n\`\`\``;
  });
  return t;
}

/** Keep head + tail when the assembled source still exceeds the hard max. */
export function capArchiveSource(
  source: string,
  max = ARCHIVE_SOURCE_HARD_MAX,
): string {
  if (source.length <= max) return source;
  const head = Math.floor(max * 0.35);
  const tail = Math.floor(max * 0.55);
  return `${source.slice(0, head)}\n\n…（中间材料已截断以控制长度）\n\n${source.slice(-tail)}`;
}

function capPreviousArchiveContent(content: string): string {
  const t = content.trim();
  if (t.length <= PREV_ARCHIVE_CONTENT_MAX) return t;
  return `…（较早日志条目已截断）\n\n${t.slice(-PREV_ARCHIVE_CONTENT_MAX)}`;
}

function countUserTurns(messages: ChatMessage[]): number {
  let n = 0;
  for (const msg of messages) {
    if (msg.role === "user" && msg.content.trim()) n += 1;
  }
  return n;
}

function msgCapForTurn(turn: number, totalTurns: number): number {
  if (totalTurns <= 0) return MSG_MAX_RECENT;
  return turn > totalTurns - RECENT_TURN_KEEP ? MSG_MAX_RECENT : MSG_MAX_OLDER;
}

function prepareMessageBody(text: string, max: number): string {
  return truncate(shrinkTextForArchive(text), max);
}

function appendClarificationReplies(
  node: BranchNode,
  lines: string[],
  since?: number,
): void {
  const replies = (node.replies ?? [])
    .filter(
      (reply) =>
        reply.assistantMessage.trim() &&
        (since == null || reply.createdAt > since),
    )
    .slice(-CLARIFY_REPLY_KEEP);
  for (const reply of replies) {
    const answer = annotateContentWithVerdicts(
      flattenAdoptedForPlaintext(reply.assistantMessage),
      reply.pointVerdicts,
      reply.pointDoubts,
      reply.pointAttributions,
    );
    lines.push(
      `  ↳ 续问「${truncate(reply.userQuestion, QUOTE_MAX)}」→ ${prepareMessageBody(answer, CLARIFY_MAX)}`,
    );
  }
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
      ? prepareMessageBody(
          node.adoptedSummary?.trim() || answer,
          CLARIFY_ADOPTED_MAX,
        )
      : prepareMessageBody(answer, CLARIFY_MAX);
    const flag = adopted ? "【已收进主线】" : "【未采纳进主线】";
    const point =
      node.anchor.pointIndex != null ? ` · 分点【${node.anchor.pointIndex}】` : "";
    lines.push(
      `- ${flag}${point} 澄清「${truncate(node.anchor.quotedText, QUOTE_MAX)}」→ ${body}`,
    );
    appendClarificationReplies(node, lines);
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
    blocks.push(`# 原始问题\n${prepareMessageBody(topic, MSG_MAX_RECENT)}`);
  }

  const totalTurns = countUserTurns(thread.messages);
  let turn = 0;
  for (const msg of thread.messages) {
    if (!msg.content.trim()) continue;
    if (msg.role === "user") {
      turn += 1;
      const cap = msgCapForTurn(turn, totalTurns);
      blocks.push(
        `## 用户 · 第 ${turn} 轮\n${prepareMessageBody(msg.content, cap)}`,
      );
      continue;
    }
    const annotated = annotateContentWithVerdicts(
      flattenAdoptedForPlaintext(msg.content),
      msg.pointVerdicts,
      msg.pointDoubts,
      msg.pointAttributions,
    );
    const cap = msgCapForTurn(turn || 1, totalTurns);
    blocks.push(
      `## 助手 · 第 ${turn || 1} 轮（含分点裁决标注）\n${prepareMessageBody(annotated, cap)}`,
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

  return capArchiveSource(blocks.join("\n\n"));
}

/**
 * Canonical 开发日志 shape for Archive LLM output.
 * Tests assert these section markers stay in the system prompt.
 */
export const ARCHIVE_SECTION_MARKERS = [
  "### 背景/目标",
  "### 尝试过程",
  "### 结论/结果",
  "### 参考",
] as const;

export const ARCHIVE_SYSTEM = `你是开发日志编辑。用户会提供一段「主线问答 + 分点裁决 + 选中澄清」的原始材料。
请整理成一篇可继续迭代的**开发日志草稿**（Markdown）。

读者是「三个月后的自己」：5 分钟内要能恢复现场——定位问题、复现当时思路、追溯结论。这不是周报，也不是日记。

## 强制结构（每个有意义的排障/决策会话一篇条目；勿合并无关问题）

每条条目必须用以下 Markdown（标题日期用材料中可推断的日期；无法推断则用当天；tag/area 用简短域标签如 auth / build / agent）：

\`\`\`markdown
## YYYY-MM-DD · [tag/area] short title

### 背景/目标
1–2 句：今天卡在什么问题、为什么重要。

### 尝试过程
- 试了什么、**为什么试**（决策记录，不是流水账）
- 出错/现象：粘贴**原文**错误日志，禁止改写 paraphrase
- 哪些假设被排除、**为什么排除**（比只写最终根因更重要）

### 结论/结果
- 什么有效
- 若已定位：根因
- 若未解决：卡在哪里 + 下一步试什么

### 参考
文档 / Issue / Commit 链接（材料里有则写；没有可省略小节或写「无」）
\`\`\`

## 场景变体（在同一骨架上侧重）

- **纯排障**：完整四段；加重「尝试过程」（原文报错、排除链）。
- **设计决策**：「尝试过程」写成「考虑过的方案 + 取舍理由」；「结论/结果」写清选定方案，并写**何时应重评**的触发条件。
- **进度跟踪**：可把「背景/目标」写成目标；「结论/结果」写完成情况与**阻塞项**（写清 unblock 需要什么）。

## 原则

1. 支持：定位问题 → 复现思考 → 追溯结论。
2. 「为何排除」优先于只写最终原因；死胡同如实保留，不要美化成成功叙事。
3. 错误日志保持 verbatim（原文）。
4. 一次有意义的排障/决策会话 → 一条 \`##\` 条目；不要按日历硬凑日记，也不要把无关问题塞进同一条。
5. 简明，可当作后续对话的上下文底座；不要写「你可以继续问我…」类客套。
6. 不要编造材料中没有的事实。路径、命令、配置若材料里有则保留原文。

## 分点 / 澄清校准（写入对应段落，勿另起周报式大纲）

1. 分点反馈是校准信号：**未拒绝即默认采纳**；区分「主动采纳」「默认采纳」「被动使用（复制）」。「存疑」写入结论中的待验证/置信度缺口；「不采纳」按已确认归因（目标/约束/路线/专业判断/表达）写成对照教训，勿当作仍可行方案——可放在「尝试过程」的排除项或「结论/结果」。
2. 澄清：标记「已收进主线」的写入结论/有效做法；标记「未采纳进主线」的只进未决或旁路，不要当成已定论。
3. 若材料含反馈事件摘要，用它校准权重（hypothesis_confirm / passive_copy / explicit），不要编造未出现的事件。
4. 若材料含「检查点（阶段性整合）」：已不采纳分点之后未裁决的步骤视为过时；把已采纳步骤与「已收进主线」的澄清写入结论底座。`;

export function archiveSystemPrompt(locale: Locale = getLocale()): string {
  return withReplyLanguage(ARCHIVE_SYSTEM, locale);
}

export function archiveUserPrompt(
  source: string,
  locale: Locale = getLocale(),
): string {
  if (locale === "zh") {
    return `请根据以下原始材料整理开发日志草稿。必须使用「## YYYY-MM-DD · [tag/area] 标题」条目，并包含 ### 背景/目标、### 尝试过程、### 结论/结果、### 参考：\n\n${source}`;
  }
  return `Please turn the following raw material into a development-log draft. Use dated entries \`## YYYY-MM-DD · [tag/area] title\` with sections ### 背景/目标, ### 尝试过程, ### 结论/结果, and ### 参考 (body language may follow the reply-language rule):\n\n${source}`;
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

/** Prefer active archive, else the latest snapshot in the list. */
export function resolveBaseArchive(
  archives: ArchiveSnapshot[] | null | undefined,
  activeArchiveId?: string | null,
): ArchiveSnapshot | null {
  const list = archives ?? [];
  if (!list.length) return null;
  if (activeArchiveId) {
    const active = list.find((a) => a.id === activeArchiveId);
    if (active) return active;
  }
  return list[list.length - 1] ?? null;
}

function branchTreeHasUpdatesAfter(
  nodes: BranchNode[],
  since: number,
): boolean {
  for (const node of nodes) {
    if (node.createdAt > since) return true;
    if (typeof node.adoptedAt === "number" && node.adoptedAt > since) {
      return true;
    }
    for (const reply of node.replies ?? []) {
      if (reply.createdAt > since) return true;
    }
    if (branchTreeHasUpdatesAfter(node.children, since)) return true;
  }
  return false;
}

function coveredMessages(
  thread: ThreadRoot,
  archive: ArchiveSnapshot,
): ChatMessage[] {
  const idx = thread.messages.findIndex((m) => m.id === archive.throughMessageId);
  if (idx < 0) return thread.messages;
  return thread.messages.slice(0, idx + 1);
}

/**
 * True when there is new mainline chat and/or new interactions
 * (feedback / clarifications / adopts) since the given archive.
 */
export function archiveHasNewMaterial(
  thread: ThreadRoot,
  archive: ArchiveSnapshot,
  feedbackLog?: FeedbackEvent[] | null,
): boolean {
  if (messagesAfterArchive(thread, archive).length > 0) return true;

  const since = archive.createdAt;
  if ((feedbackLog ?? []).some((e) => e.at > since)) return true;

  for (const msg of coveredMessages(thread, archive)) {
    if (msg.role !== "assistant") continue;
    if (branchTreeHasUpdatesAfter(msg.children, since)) return true;
  }
  return false;
}

function formatMessageBlocks(
  messages: ChatMessage[],
  startTurn = 0,
): string[] {
  const blocks: string[] = [];
  const totalTurns = startTurn + countUserTurns(messages);
  let turn = startTurn;
  for (const msg of messages) {
    if (!msg.content.trim()) continue;
    if (msg.role === "user") {
      turn += 1;
      const cap = msgCapForTurn(turn, totalTurns);
      blocks.push(
        `## 用户 · 第 ${turn} 轮\n${prepareMessageBody(msg.content, cap)}`,
      );
      continue;
    }
    const annotated = annotateContentWithVerdicts(
      flattenAdoptedForPlaintext(msg.content),
      msg.pointVerdicts,
      msg.pointDoubts,
      msg.pointAttributions,
    );
    const cap = msgCapForTurn(turn || 1, totalTurns);
    blocks.push(
      `## 助手 · 第 ${turn || 1} 轮（含分点裁决标注）\n${prepareMessageBody(annotated, cap)}`,
    );
    const clarifications: string[] = [];
    flattenClarifications(msg.children, clarifications);
    if (clarifications.length) {
      blocks.push(`### 本轮澄清（含是否已收进主线）\n${clarifications.join("\n")}`);
    }
    const checkpoint = formatCheckpointForArchive(msg.content, msg.pointVerdicts);
    if (checkpoint) blocks.push(checkpoint);
  }
  return blocks;
}

function collectNewClarificationsAfter(
  nodes: BranchNode[],
  since: number,
  lines: string[],
): void {
  for (const node of nodes) {
    const isNew =
      node.createdAt > since ||
      (typeof node.adoptedAt === "number" && node.adoptedAt > since) ||
      (node.replies ?? []).some((r) => r.createdAt > since);
    if (isNew) {
      const answer = annotateContentWithVerdicts(
        flattenAdoptedForPlaintext(node.assistantMessage),
        node.pointVerdicts,
        node.pointDoubts,
        node.pointAttributions,
      );
      const adopted = Boolean(node.adoptedAt);
      const body = adopted
        ? prepareMessageBody(
            node.adoptedSummary?.trim() || answer,
            CLARIFY_ADOPTED_MAX,
          )
        : prepareMessageBody(answer, CLARIFY_MAX);
      const flag = adopted ? "【已收进主线】" : "【未采纳进主线】";
      const point =
        node.anchor.pointIndex != null
          ? ` · 分点【${node.anchor.pointIndex}】`
          : "";
      lines.push(
        `- ${flag}${point} 澄清「${truncate(node.anchor.quotedText, QUOTE_MAX)}」→ ${body}`,
      );
      appendClarificationReplies(
        node,
        lines,
        node.createdAt > since ? undefined : since,
      );
    }
    if (node.children.length) {
      collectNewClarificationsAfter(node.children, since, lines);
    }
  }
}

/**
 * Build LLM source for incremental archive: previous log as base + only
 * new turns / clarifications / feedback since that snapshot.
 */
export function buildIncrementalArchiveSource(
  previous: ArchiveSnapshot,
  thread: ThreadRoot,
  options?: BuildArchiveSourceOptions,
): string {
  const blocks: string[] = [
    `# 上一版开发日志（底座）\n标题：${previous.title}\n\n${capPreviousArchiveContent(previous.content)}`,
  ];

  const later = messagesAfterArchive(thread, previous);
  if (later.length) {
    blocks.push(
      `# 归档之后的新对话（仅增量）\n${formatMessageBlocks(later).join("\n\n")}`,
    );
  }

  const newClarifications: string[] = [];
  for (const msg of coveredMessages(thread, previous)) {
    if (msg.role !== "assistant") continue;
    collectNewClarificationsAfter(
      msg.children,
      previous.createdAt,
      newClarifications,
    );
  }
  if (newClarifications.length) {
    blocks.push(
      `# 归档覆盖范围内的新澄清 / 采纳\n${newClarifications.join("\n")}`,
    );
  }

  const freshEvents = (options?.feedbackLog ?? []).filter(
    (e) => e.at > previous.createdAt,
  );
  const feedback = formatFeedbackLogSummary(freshEvents);
  if (feedback) {
    blocks.push(`# 自上一版以来的反馈\n${feedback}`);
  }

  return capArchiveSource(blocks.join("\n\n"));
}

/**
 * Delta-only material after an archive (no previous-log body).
 * Used when Compress already has the archive draft as its primary source.
 */
export function buildCompressDeltaAfterArchive(
  previous: ArchiveSnapshot,
  thread: ThreadRoot,
  options?: BuildArchiveSourceOptions,
): string {
  const blocks: string[] = [];
  const later = messagesAfterArchive(thread, previous);
  if (later.length) {
    blocks.push(
      `# 归档之后的新对话\n${formatMessageBlocks(later).join("\n\n")}`,
    );
  }

  const newClarifications: string[] = [];
  for (const msg of coveredMessages(thread, previous)) {
    if (msg.role !== "assistant") continue;
    collectNewClarificationsAfter(
      msg.children,
      previous.createdAt,
      newClarifications,
    );
  }
  if (newClarifications.length) {
    blocks.push(
      `# 归档覆盖范围内的新澄清 / 采纳\n${newClarifications.join("\n")}`,
    );
  }

  const freshEvents = (options?.feedbackLog ?? []).filter(
    (e) => e.at > previous.createdAt,
  );
  const feedback = formatFeedbackLogSummary(freshEvents);
  if (feedback) {
    blocks.push(`# 自上一版以来的反馈\n${feedback}`);
  }

  return blocks.length ? capArchiveSource(blocks.join("\n\n")) : "";
}

export const INCREMENTAL_ARCHIVE_SYSTEM = `${ARCHIVE_SYSTEM}

增量归档补充规则：
- 材料含「上一版开发日志（底座）」与「新交互」。输出仍须是完整开发日志（可含多条 \`##\` 条目），不是补丁说明。
- **同一问题续作**：就地更新对应条目的「尝试过程 / 结论/结果 / 参考」，保留仍有效的排除链与原文报错；不要无故抹掉死胡同。
- **新的独立排障/决策会话**：追加一条新的 \`## YYYY-MM-DD · [tag/area] …\` 条目；不要把无关问题合并进旧条目。
- 重点融入新对话、新澄清、新反馈；不要无故重写无关历史条目。
- 若新交互与底座冲突，以新交互为准，并在该条目结论中简要标明变更。`;

export function incrementalArchiveSystemPrompt(
  locale: Locale = getLocale(),
): string {
  return withReplyLanguage(INCREMENTAL_ARCHIVE_SYSTEM, locale);
}

export function incrementalArchiveUserPrompt(
  source: string,
  locale: Locale = getLocale(),
): string {
  if (locale === "zh") {
    return `请在上一版开发日志底座上做增量更新，整理成新一版开发日志草稿（保留强制结构：## 日期条目 + ### 背景/目标 / 尝试过程 / 结论/结果 / 参考；新会话追加条目，同题续作则更新原条目）：\n\n${source}`;
  }
  return `Please produce an updated development-log draft by incrementally revising the previous log. Keep the required structure (dated \`##\` entries + ### 背景/目标 / 尝试过程 / 结论/结果 / 参考); append a new entry for a new session, or update the same entry when continuing the same problem:\n\n${source}`;
}
