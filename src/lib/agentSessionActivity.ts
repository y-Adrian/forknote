import type { AgentActivity, AgentFileChange } from "./agentTools";

/** Stable empties so projections / selectors do not allocate a new [] each read. */
export const EMPTY_AGENT_ACTIVITY: AgentActivity[] = [];
export const EMPTY_AGENT_CHANGES: AgentFileChange[] = [];

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
      ? activityBySession[activeSessionId] ?? EMPTY_AGENT_ACTIVITY
      : EMPTY_AGENT_ACTIVITY,
    agentChanges: activeSessionId
      ? changesBySession[activeSessionId] ?? EMPTY_AGENT_CHANGES
      : EMPTY_AGENT_CHANGES,
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
