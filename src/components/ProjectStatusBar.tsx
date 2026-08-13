import { useAppStore } from "../store/useAppStore";
import { useLocale } from "../lib/i18n";

type ProjectStatusPart = "all" | "row" | "panels";

/** Mid-turn agent tool log + file changes (hidden when the session is idle). */
export function AgentActivityPanels() {
  const { t } = useLocale();
  const agentActivity = useAppStore((s) => s.agentActivity);
  const agentChanges = useAppStore((s) => s.agentChanges);
  const agentExecuting = useAppStore((s) => {
    const sid = s.activeSessionId;
    if (!sid) return false;
    if (s.loadingMainBySession[sid]) return true;
    if (s.loadingBranchBySession[sid]) return true;
    if (s.agentPendingPlan?.sessionId === sid) return true;
    return false;
  });

  if (!agentExecuting || (agentActivity.length === 0 && agentChanges.length === 0)) {
    return null;
  }

  return (
    <>
      {agentActivity.length > 0 && (
        <ul className="fn-agent-activity" aria-label={t("projectBar.activityAria")}>
          {agentActivity.slice(-6).map((a) => (
            <li key={a.id} className={`is-${a.kind}`}>
              {a.message}
            </li>
          ))}
        </ul>
      )}
      {agentChanges.length > 0 && (
        <div className="fn-agent-changes">
          <div className="fn-agent-changes-title">{t("projectBar.changes")}</div>
          <ul>
            {agentChanges.map((c) => (
              <li key={`${c.path}-${c.at}`}>
                <div className="fn-agent-changes-row">
                  <code>{c.path}</code>
                  <span className="fn-agent-changes-meta">{c.size} B</span>
                </div>
                {c.diff ? (
                  <pre className="fn-agent-changes-diff">{c.diff}</pre>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/** Compact chip + activity / changes for the connected local project. */
export function ProjectStatusBar({
  onOpenProject,
  part = "all",
}: {
  onOpenProject: () => void;
  /** `row` = chip controls only; `panels` = activity/changes; `all` = both (empty state). */
  part?: ProjectStatusPart;
}) {
  const { t } = useLocale();
  const projectRoot = useAppStore((s) => s.projectRoot);
  const disconnectProject = useAppStore((s) => s.disconnectProject);

  const pathParts = projectRoot
    ? projectRoot.split(/[/\\]/).filter(Boolean)
    : [];
  /** Toolbar row prefers a single folder name so the chip can show in full. */
  const shortRoot =
    pathParts.length === 0
      ? null
      : part === "row"
        ? pathParts[pathParts.length - 1]
        : pathParts.slice(-2).join("/");

  const showRow = part === "all" || part === "row";
  const showPanels = part === "all" || part === "panels";

  const row = showRow ? (
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
    </div>
  ) : null;

  const panels = showPanels ? <AgentActivityPanels /> : null;

  if (part === "row") return row;
  if (part === "panels") return panels;

  return (
    <div className="fn-project-bar">
      {row}
      {panels}
    </div>
  );
}
