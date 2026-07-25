import type { ChatSession } from "../types";

/** Local-first share payload: title + main-thread messages as Markdown. */
export function sessionToShareMarkdown(session: ChatSession): string {
  const lines: string[] = [`# ${session.title.trim() || "Untitled"}`, ""];
  const messages = session.thread?.messages ?? [];
  if (messages.length === 0) {
    lines.push("_Empty note_");
    return lines.join("\n").trimEnd() + "\n";
  }
  for (const msg of messages) {
    const heading = msg.role === "user" ? "User" : "Assistant";
    lines.push(`## ${heading}`, "", msg.content.trim(), "");
  }
  return lines.join("\n").trimEnd() + "\n";
}
