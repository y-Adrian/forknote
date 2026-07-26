import type { NodeId } from "../types";
import {
  commandLeavesProject,
  isPrimarilyTerminalPlan,
  resolveTerminalApproveCommands,
} from "../lib/agentTools";
import { useLocale } from "../lib/i18n";
import { useAppStore } from "../store/useAppStore";

type Scope =
  | { kind: "main" }
  | { kind: "branch"; branchId: NodeId };

interface Props {
  scope?: Scope;
  className?: string;
}

/**
 * Cursor-like inline shell approval: monospace command block in the thread
 * with Allow / Reject on the right. Not the composer Terminal card.
 */
export function InlineTerminalApproval({
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
  const running = useAppStore((s) => {
    if (!s.activeSessionId) return false;
    if (scope.kind === "branch") {
      return s.loadingBranchBySession[s.activeSessionId] === scope.branchId;
    }
    return Boolean(s.loadingMainBySession[s.activeSessionId]);
  });

  if (!plan) return null;
  if (!isPrimarilyTerminalPlan(plan.planText, plan.steps, plan.commands)) {
    return null;
  }

  const commands = resolveTerminalApproveCommands({
    planText: plan.planText,
    steps: plan.steps,
    explicitCommands: plan.commands,
  });
  const command = commands.length > 0 ? commands.join("\n") : "";
  const outsideProject =
    commands.length > 0
      ? commands.some((c) => commandLeavesProject(c, projectRoot))
      : false;
  const extra = className ? ` ${className}` : "";

  return (
    <div
      className={`fn-shell-approve${outsideProject ? " is-outside" : ""}${extra}`}
      role="region"
      aria-label={t("agentTerminal.aria")}
    >
      {outsideProject ? (
        <p className="fn-shell-approve-warn" role="alert">
          {t("agentTerminal.outsideWarn")}
        </p>
      ) : null}

      {projectRoot ? (
        <div className="fn-shell-approve-cwd" title={projectRoot}>
          <span className="fn-shell-approve-cwd-label">
            {t("agentTerminal.cwd")}
          </span>
          <code>{projectRoot}</code>
        </div>
      ) : null}

      <div className="fn-shell-approve-row">
        <div className="fn-shell-approve-block">
          <div className="fn-shell-approve-toolbar">
            <span className="fn-shell-approve-lang">shell</span>
          </div>
          {command ? (
            <pre className="fn-shell-approve-pre">
              <code>{command}</code>
            </pre>
          ) : (
            <p className="fn-shell-approve-pending">
              {t("agentTerminal.commandPending")}
            </p>
          )}
        </div>
        <div className="fn-shell-approve-actions">
          <button
            type="button"
            className="btn primary fn-shell-approve-allow"
            disabled={running}
            onClick={() => void approveAgentPlan()}
          >
            {running ? t("agentTerminal.running") : t("agentTerminal.allow")}
          </button>
          <button
            type="button"
            className="btn ghost fn-shell-approve-reject"
            disabled={running}
            onClick={() => rejectAgentPlan()}
          >
            {t("agentTerminal.reject")}
          </button>
        </div>
      </div>
    </div>
  );
}

function selectPendingTerminalPlan(
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
    !isPrimarilyTerminalPlan(pending.planText, pending.steps, pending.commands)
  ) {
    return { pending: false, assistantId: null };
  }
  return {
    pending: true,
    assistantId: pending.assistantId ?? null,
  };
}

/**
 * True when the active session has a terminal plan pending for this scope.
 * Uses primitive selectors — returning a fresh object from `useAppStore` causes
 * Maximum update depth exceeded (Object.is always fails).
 */
export function usePendingTerminalPlan(scope: Scope = { kind: "main" }): {
  pending: boolean;
  assistantId: NodeId | null;
} {
  const branchId = scope.kind === "branch" ? scope.branchId : null;
  const pending = useAppStore((s) => {
    const result = selectPendingTerminalPlan(
      s,
      branchId ? { kind: "branch", branchId } : { kind: "main" },
    );
    return result.pending;
  });
  const assistantId = useAppStore((s) => {
    const result = selectPendingTerminalPlan(
      s,
      branchId ? { kind: "branch", branchId } : { kind: "main" },
    );
    return result.assistantId;
  });
  return { pending, assistantId };
}
