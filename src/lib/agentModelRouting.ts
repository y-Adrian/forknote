import type { ApiSettings } from "../types";

export type AgentModelPhase = "plan" | "code" | "summary";

/** Pick a phase model; empty override falls back to the session/default model. */
export function resolveAgentModelForPhase(
  settings: Pick<
    ApiSettings,
    "model" | "agentPlanModel" | "agentCodeModel" | "agentSummaryModel"
  >,
  phase: AgentModelPhase,
): string {
  const fallback = (settings.model ?? "").trim();
  const override =
    phase === "plan"
      ? settings.agentPlanModel
      : phase === "code"
        ? settings.agentCodeModel
        : settings.agentSummaryModel;
  const picked = (override ?? "").trim();
  return picked || fallback;
}

/** Clone API settings with the model resolved for a given agent phase. */
export function withAgentPhaseModel(
  settings: ApiSettings,
  phase: AgentModelPhase,
): ApiSettings {
  const model = resolveAgentModelForPhase(settings, phase);
  if (model === (settings.model ?? "").trim()) return settings;
  return { ...settings, model };
}
