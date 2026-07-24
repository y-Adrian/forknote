import { useEffect, useState } from "react";
import { useLocale } from "../lib/i18n";
import { loadProjectPrefs, saveProjectPrefs } from "../lib/project";
import { pickProjectFolder } from "../lib/sidecar";
import { useAppStore } from "../store/useAppStore";

interface Props {
  open: boolean;
  onClose: () => void;
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
  const [busy, setBusy] = useState(false);
  const [browseBusy, setBrowseBusy] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const prefs = loadProjectPrefs();
    setPathDraft(projectRoot || prefs.lastPath || "");
    setUrlDraft(sidecarUrl || prefs.sidecarUrl || "/sidecar");
    setBrowseError(null);
  }, [open, projectRoot, sidecarUrl]);

  if (!open) return null;

  const connect = async () => {
    setBusy(true);
    setBrowseError(null);
    try {
      setSidecarUrl(urlDraft.trim() || "/sidecar");
      saveProjectPrefs({
        lastPath: pathDraft.trim(),
        sidecarUrl: urlDraft.trim() || "/sidecar",
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
      const url = urlDraft.trim() || "/sidecar";
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
          {t("projectPanel.sidecarUrl")}
          <input
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder="/sidecar"
            spellCheck={false}
          />
        </label>

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
