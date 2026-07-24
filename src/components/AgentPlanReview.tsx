import { useLocale } from "../lib/i18n";
import { useAppStore } from "../store/useAppStore";

/** Plan review bar — approve or cancel before agent tools run. */
export function AgentPlanReview() {
  const { t } = useLocale();
  const plan = useAppStore((s) => s.agentPendingPlan);
  const approveAgentPlan = useAppStore((s) => s.approveAgentPlan);
  const rejectAgentPlan = useAppStore((s) => s.rejectAgentPlan);
  const loadingMain = useAppStore((s) => s.loadingMain);

  if (!plan) return null;

  return (
    <div className="fn-agent-plan" role="region" aria-label={t("agentPlan.aria")}>
      <div className="fn-agent-plan-header">
        <span className="fn-agent-plan-kicker">{t("agentPlan.kicker")}</span>
        <p className="fn-agent-plan-lead">{t("agentPlan.lead")}</p>
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
          disabled={loadingMain}
          onClick={() => void approveAgentPlan()}
        >
          {loadingMain ? t("agentPlan.running") : t("agentPlan.approve")}
        </button>
        <button
          type="button"
          className="btn ghost"
          disabled={loadingMain}
          onClick={() => rejectAgentPlan()}
        >
          {t("agentPlan.cancel")}
        </button>
      </div>
    </div>
  );
}
