import { useEffect, useState } from "react";
import { loadProjectPrefs, saveProjectPrefs } from "../lib/project";
import { useAppStore } from "../store/useAppStore";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ProjectPanel({ open, onClose }: Props) {
  const projectRoot = useAppStore((s) => s.projectRoot);
  const sidecarUrl = useAppStore((s) => s.sidecarUrl);
  const projectError = useAppStore((s) => s.projectError);
  const openProject = useAppStore((s) => s.openProject);
  const disconnectProject = useAppStore((s) => s.disconnectProject);
  const setSidecarUrl = useAppStore((s) => s.setSidecarUrl);

  const [pathDraft, setPathDraft] = useState("");
  const [urlDraft, setUrlDraft] = useState(sidecarUrl);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const prefs = loadProjectPrefs();
    setPathDraft(projectRoot || prefs.lastPath || "");
    setUrlDraft(sidecarUrl || prefs.sidecarUrl || "/sidecar");
  }, [open, projectRoot, sidecarUrl]);

  if (!open) return null;

  const connect = async () => {
    setBusy(true);
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal project-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="project-title"
      >
        <h2 id="project-title">Local project</h2>
        <p className="hint">
          Run <code>npm run sidecar</code> on this machine, then enter the
          project absolute path and connect. The main chat can read and write
          files under that directory (paths stay inside the project root).
        </p>

        <label>
          Sidecar URL
          <input
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder="/sidecar"
            spellCheck={false}
          />
        </label>

        <label>
          Project absolute path
          <input
            value={pathDraft}
            onChange={(e) => setPathDraft(e.target.value)}
            placeholder="/Users/you/my-app"
            spellCheck={false}
            autoFocus
          />
        </label>

        {projectRoot && (
          <p className="project-connected-hint">
            Connected: <code>{projectRoot}</code>
          </p>
        )}

        {projectError && <p className="ds-error">{projectError}</p>}

        <div className="modal-actions">
          {projectRoot && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                disconnectProject();
              }}
            >
              Disconnect
            </button>
          )}
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !pathDraft.trim()}
            onClick={() => void connect()}
          >
            {busy ? "Connecting…" : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}
