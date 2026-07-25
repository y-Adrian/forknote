import type { NodeId } from "../types";
import { useLocale } from "../lib/i18n";
import { useAppStore } from "../store/useAppStore";

type Scope =
  /** Main-thread composer: only plans without a Fork branchId. */
  | { kind: "main" }
  /** Fork float: only the plan for this branch. */
  | { kind: "branch"; branchId: NodeId };

interface Props {
  scope?: Scope;
  /** Extra class for compact float layout. */
  className?: string;
}

/** Plan review bar — approve or cancel before agent tools run. */
export function AgentPlanReview({
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

  const shown = plan.steps.length;
  const total = plan.totalStepCount ?? shown;
  const isChunked = total > shown && shown > 0;

  return (
    <div
      className={`fn-agent-plan${className ? ` ${className}` : ""}`}
      role="region"
      aria-label={t("agentPlan.aria")}
    >
      <div className="fn-agent-plan-header">
        <span className="fn-agent-plan-kicker">{t("agentPlan.kicker")}</span>
        <p className="fn-agent-plan-lead">{t("agentPlan.lead")}</p>
        {isChunked ? (
          <p className="fn-agent-plan-chunk">
            {t("agentPlan.chunkNote", { shown, total })}
          </p>
        ) : null}
      </div>

      {plan.steps.length > 0 ? (
        <ol className="fn-agent-plan-steps">
          {plan.steps.map((step, i) => (
            <li key={`${i}-${step.slice(0, 24)}`}>{step}</li>
          ))}
        </ol>
      ) : (
        <pre className="fn-agent-plan-body">{plan.planText}</pre>
      )}

      <div className="fn-agent-plan-actions">
        <button
          type="button"
          className="btn primary"
          disabled={running}
          onClick={() => void approveAgentPlan()}
        >
          {running ? t("agentPlan.running") : t("agentPlan.approve")}
        </button>
        <button
          type="button"
          className="btn ghost"
          disabled={running}
          onClick={() => rejectAgentPlan()}
        >
          {t("agentPlan.cancel")}
        </button>
      </div>
    </div>
  );
}
