import type { ArchiveSnapshot, ChatMessage, ThreadRoot } from "../types";
import { flattenAdoptedForPlaintext } from "./adoptBranch";
import { getLocale, type Locale } from "./i18n";
import type { ChatMessage as ApiChatMessage } from "./openai";
import { annotateContentWithVerdicts } from "./points";

/** Messages after the archive cutoff; used by the main view without archive prompts. */
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
