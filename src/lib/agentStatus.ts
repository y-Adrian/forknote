/**
 * Assistant content that is a mid-turn status placeholder (tools / explore),
 * not real answer text yet. Keep in sync with agentTurn status strings.
 */
export const AGENT_TURN_PLACEHOLDER_RE =
  /^(Creating |Listing |Reading |Searching |Running |Using project tools|Thinking|Drafting plan|思考中|正在制定计划|正在创建 |正在列出 |正在读取 |正在搜索 |正在运行 |正在使用项目工具)/;

export function isAgentTurnPlaceholder(content: string): boolean {
  const trimmed = content.trim();
  return Boolean(trimmed) && AGENT_TURN_PLACEHOLDER_RE.test(trimmed);
}
