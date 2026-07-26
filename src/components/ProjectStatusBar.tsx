import { useAppStore } from "../store/useAppStore";
import { useLocale } from "../lib/i18n";

/** Compact chip + activity / changes for the connected local project. */
export function ProjectStatusBar({ onOpenProject }: { onOpenProject: () => void }) {
  const { t } = useLocale();
  const projectRoot = useAppStore((s) => s.projectRoot);
  const agentActivity = useAppStore((s) => s.agentActivity);
  const agentChanges = useAppStore((s) => s.agentChanges);
  const clearAgentLog = useAppStore((s) => s.clearAgentLog);
  const disconnectProject = useAppStore((s) => s.disconnectProject);
  /** Tool / agent log is mid-turn only — hide the strip when the session is idle. */
  const agentExecuting = useAppStore((s) => {
    const sid = s.activeSessionId;
    if (!sid) return false;
    if (s.loadingMainBySession[sid]) return true;
    if (s.loadingBranchBySession[sid]) return true;
    if (s.agentPendingPlan?.sessionId === sid) return true;
    return false;
  });

  const shortRoot = projectRoot
    ? projectRoot.split(/[/\\]/).filter(Boolean).slice(-2).join("/")
    : null;

  const showActivityPanel =
    agentExecuting && (agentActivity.length > 0 || agentChanges.length > 0);

  return (
    <div className="fn-project-bar">
      <div className="fn-project-bar-row">
        {projectRoot ? (
          <button
            type="button"
            className="fn-project-chip is-connected"
            title={projectRoot}
            onClick={onOpenProject}
          >
            <span className="fn-project-dot" aria-hidden />
            <span className="fn-project-chip-label">{shortRoot}</span>
          </button>
        ) : (
          <button
            type="button"
            className="fn-project-chip"
            onClick={onOpenProject}
          >
            {t("projectBar.open")}
          </button>
        )}
        {projectRoot && (
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => disconnectProject()}
          >
            {t("common.disconnect")}
          </button>
        )}
        {showActivityPanel && (
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => clearAgentLog()}
          >
            {t("projectBar.clearLog")}
          </button>
        )}
      </div>

      {showActivityPanel && agentActivity.length > 0 && (
        <ul className="fn-agent-activity" aria-label={t("projectBar.activityAria")}>
          {agentActivity.slice(-6).map((a) => (
            <li key={a.id} className={`is-${a.kind}`}>
              {a.message}
            </li>
          ))}
        </ul>
      )}

      {showActivityPanel && agentChanges.length > 0 && (
        <div className="fn-agent-changes">
          <div className="fn-agent-changes-title">{t("projectBar.changes")}</div>
          <ul>
            {agentChanges.map((c) => (
              <li key={`${c.path}-${c.at}`}>
                <code>{c.path}</code>
                <span className="fn-agent-changes-meta">{c.size} B</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
