import type { AgentActivity, AgentFileChange } from "./agentTools";

/** Project active-session agent UI from per-session maps. */
export function projectAgentSessionUi(
  activeSessionId: string | null,
  activityBySession: Record<string, AgentActivity[]>,
  changesBySession: Record<string, AgentFileChange[]>,
): {
  agentActivity: AgentActivity[];
  agentChanges: AgentFileChange[];
} {
  return {
    agentActivity: activeSessionId
      ? activityBySession[activeSessionId] ?? []
      : [],
    agentChanges: activeSessionId
      ? changesBySession[activeSessionId] ?? []
      : [],
  };
}

export function appendSessionAgentActivity(
  bySession: Record<string, AgentActivity[]>,
  sessionId: string,
  activity: AgentActivity,
): Record<string, AgentActivity[]> {
  const prev = bySession[sessionId] ?? [];
  return { ...bySession, [sessionId]: [...prev, activity] };
}

export function appendSessionAgentChange(
  bySession: Record<string, AgentFileChange[]>,
  sessionId: string,
  change: AgentFileChange,
): Record<string, AgentFileChange[]> {
  const prev = bySession[sessionId] ?? [];
  return { ...bySession, [sessionId]: [...prev, change] };
}

export function clearSessionAgentUiMaps(
  activityBySession: Record<string, AgentActivity[]>,
  changesBySession: Record<string, AgentFileChange[]>,
  sessionId: string,
): {
  agentActivityBySession: Record<string, AgentActivity[]>;
  agentChangesBySession: Record<string, AgentFileChange[]>;
} {
  const agentActivityBySession = { ...activityBySession };
  const agentChangesBySession = { ...changesBySession };
  delete agentActivityBySession[sessionId];
  delete agentChangesBySession[sessionId];
  return { agentActivityBySession, agentChangesBySession };
}
