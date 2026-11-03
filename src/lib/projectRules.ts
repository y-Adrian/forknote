/**
 * Project instruction files (AGENTS.md / CLAUDE.md / .cursorrules …) that
 * repositories commit for coding agents. Loaded every project turn so the
 * agent follows house rules the same way mainstream harnesses do.
 */
import { readFile } from "./sidecar";

/** Checked in order; earlier files win when the budget runs out. */
export const PROJECT_RULE_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  ".cursorrules",
  ".github/copilot-instructions.md",
] as const;

/** Total characters of rule text injected per turn. */
export const PROJECT_RULES_MAX_CHARS = 8_000;

export interface ProjectRuleFile {
  path: string;
  content: string;
}

/** Read every rule file that exists; missing files are skipped silently. */
export async function loadProjectRules(
  projectRoot: string,
  sidecarUrl: string,
  signal?: AbortSignal,
): Promise<ProjectRuleFile[]> {
  const reads = await Promise.all(
    PROJECT_RULE_FILES.map(async (path): Promise<ProjectRuleFile | null> => {
      try {
        const res = await readFile(path, sidecarUrl, signal, undefined, projectRoot);
        const content = (res.content ?? "").trim();
        return content ? { path, content } : null;
      } catch {
        return null;
      }
    }),
  );
  return reads.filter((r): r is ProjectRuleFile => r !== null);
}

/** Format rule files as one bounded system message, or null when none exist. */
export function formatProjectRulesSystem(
  rules: ProjectRuleFile[],
  locale: "zh" | "en",
  maxChars = PROJECT_RULES_MAX_CHARS,
): string | null {
  if (rules.length === 0) return null;
  const header =
    locale === "zh"
      ? "【项目规则】以下是仓库提交的 Agent 指令文件，在本项目中工作时必须遵守（与用户最新消息冲突时以用户为准）："
      : "[Project rules] Agent instruction files committed in this repository. Follow them when working in this project (the user's latest message wins on conflict):";
  const parts: string[] = [header];
  let budget = maxChars;
  for (const rule of rules) {
    if (budget <= 0) break;
    const body = rule.content.length > budget
      ? `${rule.content.slice(0, budget)}\n…(truncated)`
      : rule.content;
    budget -= body.length;
    parts.push(`--- ${rule.path} ---\n${body}`);
  }
  return parts.join("\n\n");
}
