import type { AgentToolCall } from "./agentTools";

const CODE_PATH_RE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i;

/** Tools that change source text on disk. */
const CODE_EDIT_TOOLS = new Set([
  "write_file",
  "search_replace",
  "apply_patch",
]);

export function isCodeSourcePath(path: string | undefined | null): boolean {
  if (!path) return false;
  const clean = path.split("?")[0]?.split("#")[0] ?? "";
  return CODE_PATH_RE.test(clean);
}

/**
 * True when a successful tool batch edited at least one TS/JS source file,
 * so the agent turn should auto-run diagnostics.
 */
export function batchNeedsAutoDiagnostics(
  items: Array<{ tool: AgentToolCall["tool"]; path?: string; ok: boolean }>,
): boolean {
  return items.some(
    (item) =>
      item.ok &&
      CODE_EDIT_TOOLS.has(item.tool) &&
      isCodeSourcePath(item.path),
  );
}

/** Compact user message fed back into the model after auto-diagnostics. */
export function formatAutoDiagnosticsFeedback(opts: {
  ok: boolean;
  skipped?: boolean;
  output: string;
  locale?: "zh" | "en";
}): string {
  const en = opts.locale === "en";
  if (opts.skipped) {
    if (en) {
      return "[Auto diagnostics] Skipped (no tsconfig.json or unsupported project). Configure TypeScript first if type checking is needed.";
    }
    return [
      "【自动诊断】已跳过（项目无 tsconfig.json 或不支持）。",
      "若需要类型检查，请自行配置 TypeScript 后再改。",
    ].join("\n");
  }
  const body = (opts.output || "").trim() || "(no output)";
  const truncated =
    body.length > 6000 ? `${body.slice(0, 6000)}\n…(truncated)` : body;
  if (en) {
    return opts.ok
      ? `[Auto diagnostics] TypeScript check passed (run_diagnostics).\n${truncated}\nIf the task is unfinished, continue the steps the user goal needs; if done, give a concise final reply.`
      : `[Auto diagnostics] TypeScript check failed (run_diagnostics). Fix the errors below; diagnostics re-run after each edit.\n${truncated}\nDo not claim it is fixed unless a later check passes or you confirmed the errors are unrelated to this change.`;
  }
  if (opts.ok) {
    return [
      "【自动诊断】TypeScript 检查通过（run_diagnostics）。",
      truncated,
      "若任务未完成请继续用户目标所需步骤；已完成则给出凝练最终回复，勿长篇总结。",
    ].join("\n");
  }
  return [
    "【自动诊断】TypeScript 检查失败（run_diagnostics）。请根据下列错误继续修复，再改完后仍会自动复检。",
    truncated,
    "不要声称已修复，除非后续诊断通过或你已确认错误与本次改动无关。",
  ].join("\n");
}
