import { useEffect, useState } from "react";
import { useLocale } from "../lib/i18n";
import { loadProjectPrefs, saveProjectPrefs } from "../lib/project";
import { DEFAULT_SIDECAR_URL, pickProjectFolder } from "../lib/sidecar";
import { useAppStore } from "../store/useAppStore";

interface Props {
  open: boolean;
  onClose: () => void;
}

function normalizeSidecarUrl(value: string): string {
  return value.trim() || DEFAULT_SIDECAR_URL;
}

export function ProjectPanel({ open, onClose }: Props) {
  const { t } = useLocale();
  const projectRoot = useAppStore((s) => s.projectRoot);
  const sidecarUrl = useAppStore((s) => s.sidecarUrl);
  const projectError = useAppStore((s) => s.projectError);
  const openProject = useAppStore((s) => s.openProject);
  const disconnectProject = useAppStore((s) => s.disconnectProject);
  const setSidecarUrl = useAppStore((s) => s.setSidecarUrl);

  const [pathDraft, setPathDraft] = useState("");
  const [urlDraft, setUrlDraft] = useState(sidecarUrl);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [browseBusy, setBrowseBusy] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const prefs = loadProjectPrefs();
    const nextUrl = normalizeSidecarUrl(
      sidecarUrl || prefs.sidecarUrl || DEFAULT_SIDECAR_URL,
    );
    setPathDraft(projectRoot || prefs.lastPath || "");
    setUrlDraft(nextUrl);
    // Non-default URLs stay visible so power users see what they set.
    setAdvancedOpen(nextUrl !== DEFAULT_SIDECAR_URL);
    setBrowseError(null);
  }, [open, projectRoot, sidecarUrl]);

  if (!open) return null;

  const connect = async () => {
    setBusy(true);
    setBrowseError(null);
    try {
      const url = normalizeSidecarUrl(urlDraft);
      setSidecarUrl(url);
      saveProjectPrefs({
        lastPath: pathDraft.trim(),
        sidecarUrl: url,
      });
      await openProject(pathDraft.trim());
      if (useAppStore.getState().projectRoot) onClose();
    } finally {
      setBusy(false);
    }
  };

  const browse = async () => {
    setBrowseBusy(true);
    setBrowseError(null);
    try {
      const url = normalizeSidecarUrl(urlDraft);
      setSidecarUrl(url);
      saveProjectPrefs({ sidecarUrl: url });
      const result = await pickProjectFolder(url);
      if (result.cancelled || !result.path) return;
      setPathDraft(result.path);
    } catch (e) {
      setBrowseError(
        e instanceof Error ? e.message : t("projectPanel.browseFailed"),
      );
    } finally {
      setBrowseBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal project-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="project-title"
      >
        <h2 id="project-title">{t("projectPanel.title")}</h2>
        <p className="hint">{t("projectPanel.lead")}</p>

        <label>
          {t("projectPanel.path")}
          <div className="fn-project-path-row">
            <input
              value={pathDraft}
              onChange={(e) => setPathDraft(e.target.value)}
              placeholder={t("projectPanel.pathPlaceholder")}
              spellCheck={false}
              autoFocus
            />
            <button
              type="button"
              className="btn ghost"
              disabled={busy || browseBusy}
              onClick={() => void browse()}
            >
              {browseBusy ? t("projectPanel.browsing") : t("projectPanel.browse")}
            </button>
          </div>
        </label>

        {projectRoot && (
          <p className="project-connected-hint">
            {t("projectPanel.connected")} <code>{projectRoot}</code>
          </p>
        )}

        <div className={`fn-project-advanced${advancedOpen ? " is-open" : ""}`}>
          <button
            type="button"
            className="fn-project-advanced-toggle"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((v) => !v)}
          >
            <span>{t("projectPanel.advanced")}</span>
            <span className="fn-project-advanced-chevron" aria-hidden>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                <path
                  d="M6 9l6 6 6-6"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>
          {advancedOpen && (
            <div className="fn-project-advanced-body">
              <label>
                {t("projectPanel.sidecarUrl")}
                <input
                  value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)}
                  placeholder={DEFAULT_SIDECAR_URL}
                  spellCheck={false}
                />
              </label>
              <p className="fn-project-advanced-hint">
                {t("projectPanel.sidecarUrlHint")}
              </p>
            </div>
          )}
        </div>

        {(browseError || projectError) && (
          <p className="ds-error">{browseError || projectError}</p>
        )}

        <div className="modal-actions">
          {projectRoot && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                disconnectProject();
              }}
            >
              {t("projectPanel.disconnect")}
            </button>
          )}
          <button type="button" className="btn ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || browseBusy || !pathDraft.trim()}
            onClick={() => void connect()}
          >
            {busy ? t("projectPanel.connecting") : t("projectPanel.connect")}
          </button>
        </div>
      </div>
    </div>
  );
}
