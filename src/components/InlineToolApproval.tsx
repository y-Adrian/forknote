import type { NodeId } from "../types";
import {
  commandLeavesProject,
  resolveTerminalApproveCommands,
  summarizeInlineApprovalAction,
  usesInlineToolApproval,
} from "../lib/agentTools";
import { useLocale } from "../lib/i18n";
import { normalizeApiSettings, saveSettings } from "../lib/settings";
import { useAppStore } from "../store/useAppStore";

type Scope =
  | { kind: "main" }
  | { kind: "branch"; branchId: NodeId };

interface Props {
  scope?: Scope;
  className?: string;
}

/**
 * Cursor-like inline tool approval in the conversation thread:
 * compact action summary with Allow / Stop on the right.
 * Shown only when a pending plan actually needs tool approval.
 */
export function InlineToolApproval({
  scope = { kind: "main" },
  className,
}: Props) {
  const { t } = useLocale();
  const plan = useAppStore((s) => {
    const pending =
      s.agentPendingPlan && s.agentPendingPlan.sessionId === s.activeSessionId
        ? s.agentPendingPlan
        : null;
    if (!pending) return null;
    if (scope.kind === "main") {
      return pending.branchId ? null : pending;
    }
    return pending.branchId === scope.branchId ? pending : null;
  });
  const projectRoot = useAppStore((s) => s.projectRoot);
  const approveAgentPlan = useAppStore((s) => s.approveAgentPlan);
  const rejectAgentPlan = useAppStore((s) => s.rejectAgentPlan);
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const running = useAppStore((s) => {
    if (!s.activeSessionId) return false;
    if (scope.kind === "branch") {
      return s.loadingBranchBySession[s.activeSessionId] === scope.branchId;
    }
    return Boolean(s.loadingMainBySession[s.activeSessionId]);
  });

  if (!plan) return null;
  if (!usesInlineToolApproval(plan.planText, plan.steps, plan.commands)) {
    return null;
  }

  const summary = summarizeInlineApprovalAction({
    planText: plan.planText,
    steps: plan.steps,
    explicitCommands: plan.commands,
  });
  const isTerminal = summary.kind === "terminal";
  const commands = isTerminal
    ? resolveTerminalApproveCommands({
        planText: plan.planText,
        steps: plan.steps,
        explicitCommands: plan.commands,
      })
    : [];
  const outsideProject =
    isTerminal && commands.length > 0
      ? commands.some((c) => commandLeavesProject(c, projectRoot))
      : false;
  const detail = summary.detail;
  const extra = className ? ` ${className}` : "";

  let body = detail;
  if (detail && !isTerminal) {
    if (summary.kind === "write") body = `Write ${detail}`;
    else if (summary.kind === "edit") body = `Edit ${detail}`;
    else if (summary.kind === "mkdir") body = `mkdir ${detail}`;
  }

  return (
    <div
      className={`fn-tool-approve${outsideProject ? " is-outside" : ""}${extra}`}
      role="region"
      aria-label={t("agentTool.aria")}
    >
      {outsideProject ? (
        <p className="fn-tool-approve-warn" role="alert">
          {t("agentTerminal.outsideWarn")}
        </p>
      ) : null}

      {isTerminal && projectRoot ? (
        <div className="fn-tool-approve-cwd" title={projectRoot}>
          <span className="fn-tool-approve-cwd-label">
            {t("agentTerminal.cwd")}
          </span>
          <code>{projectRoot}</code>
        </div>
      ) : null}

      <div className="fn-tool-approve-row">
        <div className="fn-tool-approve-block">
          <div className="fn-tool-approve-toolbar">
            <span className="fn-tool-approve-lang">{summary.lang}</span>
          </div>
          {body ? (
            <pre className="fn-tool-approve-pre">
              <code>{body}</code>
            </pre>
          ) : (
            <p className="fn-tool-approve-pending">
              {isTerminal
                ? t("agentTerminal.commandPending")
                : t("agentTool.actionPending")}
            </p>
          )}
        </div>
        <div className="fn-tool-approve-actions">
          <button
            type="button"
            className="btn primary fn-tool-approve-allow"
            disabled={running}
            onClick={() => void approveAgentPlan()}
          >
            {running ? t("agentTool.running") : t("agentTool.allow")}
          </button>
          {isTerminal && commands.length > 0 ? (
            <button
              type="button"
              className="btn ghost fn-tool-approve-always"
              disabled={running}
              title={t("agentTool.alwaysAllowTitle")}
              onClick={() => {
                const next = normalizeApiSettings({
                  ...settings,
                  agentCommandAllow: [
                    ...(settings.agentCommandAllow ?? []),
                    ...commands,
                  ],
                });
                saveSettings(next);
                setSettings(next);
                void approveAgentPlan();
              }}
            >
              {t("agentTool.alwaysAllow")}
            </button>
          ) : null}
          <button
            type="button"
            className="btn ghost fn-tool-approve-stop"
            disabled={running}
            onClick={() => rejectAgentPlan()}
          >
            {t("agentTool.stop")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** @deprecated Prefer {@link InlineToolApproval}. */
export const InlineTerminalApproval = InlineToolApproval;

function selectPendingInlinePlan(
  s: ReturnType<typeof useAppStore.getState>,
  scope: Scope,
): { pending: boolean; assistantId: NodeId | null } {
  const pending =
    s.agentPendingPlan && s.agentPendingPlan.sessionId === s.activeSessionId
      ? s.agentPendingPlan
      : null;
  if (!pending) return { pending: false, assistantId: null };
  if (scope.kind === "main") {
    if (pending.branchId) return { pending: false, assistantId: null };
  } else if (pending.branchId !== scope.branchId) {
    return { pending: false, assistantId: null };
  }
  if (
    !usesInlineToolApproval(pending.planText, pending.steps, pending.commands)
  ) {
    return { pending: false, assistantId: null };
  }
  return {
    pending: true,
    assistantId: pending.assistantId ?? null,
  };
}

/**
 * True when the active session has an inline tool plan pending for this scope.
 * Uses primitive selectors — returning a fresh object from `useAppStore` causes
 * Maximum update depth exceeded (Object.is always fails).
 */
export function usePendingInlineApproval(scope: Scope = { kind: "main" }): {
  pending: boolean;
  assistantId: NodeId | null;
} {
  const branchId = scope.kind === "branch" ? scope.branchId : null;
  const pending = useAppStore((s) => {
    const result = selectPendingInlinePlan(
      s,
      branchId ? { kind: "branch", branchId } : { kind: "main" },
    );
    return result.pending;
  });
  const assistantId = useAppStore((s) => {
    const result = selectPendingInlinePlan(
      s,
      branchId ? { kind: "branch", branchId } : { kind: "main" },
    );
    return result.assistantId;
  });
  return { pending, assistantId };
}

/** @deprecated Prefer {@link usePendingInlineApproval}. */
export const usePendingTerminalPlan = usePendingInlineApproval;
