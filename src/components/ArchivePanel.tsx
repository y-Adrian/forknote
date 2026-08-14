import { useEffect, useMemo } from "react";
import { resolveConversationContext } from "../lib/conversationContext";
import { useLocale } from "../lib/i18n";
import { useAppStore } from "../store/useAppStore";
import type { NodeId } from "../types";
import { AccessibleModal } from "./AccessibleModal";
import { MarkdownBody } from "./MarkdownBody";

export function ArchivePanel() {
  const { t } = useLocale();
  const open = useAppStore((s) => s.archivePanelOpen);
  const loadingArchive = useAppStore(
    (s) =>
      s.loadingArchiveSessionId != null &&
      s.loadingArchiveSessionId === s.activeSessionId,
  );
  const archiveDraft = useAppStore((s) => s.archiveDraft);
  const archiveAlreadyCurrent = useAppStore((s) => s.archiveAlreadyCurrent);
  const viewingArchiveId = useAppStore((s) => s.viewingArchiveId);
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setArchivePanelOpen = useAppStore((s) => s.setArchivePanelOpen);
  const setViewingArchiveId = useAppStore((s) => s.setViewingArchiveId);
  const setContextMode = useAppStore((s) => s.setContextMode);
  const deleteArchive = useAppStore((s) => s.deleteArchive);
  const stopGeneration = useAppStore((s) => s.stopGeneration);

  const session = useMemo(
    () => sessions.find((s) => s.id === activeSessionId),
    [sessions, activeSessionId],
  );
  const archives = session?.archives ?? [];
  const resolvedContext = useMemo(
    () => resolveConversationContext(session),
    [session],
  );
  const activeArchiveId = session?.activeArchiveId ?? null;
  const inArchiveMode = resolvedContext.mode === "archive";

  const selectedId: NodeId | null =
    viewingArchiveId ??
    activeArchiveId ??
    archives[archives.length - 1]?.id ??
    null;

  const selected = archives.find((a) => a.id === selectedId) ?? null;
  const body = loadingArchive
    ? archiveDraft
    : (selected?.content ?? archiveDraft);

  useEffect(() => {
    if (!open) return;
    if (viewingArchiveId) return;
    if (selectedId) setViewingArchiveId(selectedId);
  }, [open, viewingArchiveId, selectedId, setViewingArchiveId]);

  if (!open) return null;

  const onClose = () => setArchivePanelOpen(false);

  return (
    <AccessibleModal
      open={open}
      onClose={onClose}
      labelledBy="archive-panel-title"
      className="modal fn-archive-modal"
    >
        <header className="fn-archive-modal-header">
          <div>
            <h2 id="archive-panel-title">{t("archive.title")}</h2>
            <p className="fn-archive-modal-hint">
              {loadingArchive
                ? t("archive.hintLoading")
                : archiveAlreadyCurrent
                  ? t("archive.hintUpToDate")
                  : t("archive.hintIdle")}
            </p>
          </div>
          <button
            type="button"
            className="btn ghost"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            {t("common.close")}
          </button>
        </header>

        {archives.length > 1 && !loadingArchive && (
          <label className="fn-archive-select">
            <span>{t("archive.past")}</span>
            <select
              value={selectedId ?? ""}
              onChange={(e) => {
                const id = e.target.value as NodeId;
                setViewingArchiveId(id || null);
              }}
            >
              {archives.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                  {a.id === activeArchiveId && inArchiveMode
                    ? t("archive.activeContext")
                    : ""}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="fn-archive-body">
          {loadingArchive && !body.trim() ? (
            <div className="fn-archive-loading" aria-busy="true">
              <div className="ds-typing" aria-label={t("archive.generatingAria")}>
                <span />
                <span />
                <span />
              </div>
              <p>{t("archive.generating")}</p>
            </div>
          ) : body.trim() ? (
            <div className="fn-archive-markdown markdown-body">
              <MarkdownBody content={body} />
            </div>
          ) : (
            <p className="muted">{t("archive.empty")}</p>
          )}
        </div>

        <div className="modal-actions fn-archive-actions">
          {loadingArchive ? (
            <button
              type="button"
              className="btn ghost"
              onClick={() => stopGeneration()}
            >
              {t("common.stop")}
            </button>
          ) : (
            <>
              {selected && (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    if (window.confirm(t("archive.deleteConfirm"))) {
                      deleteArchive(selected.id);
                    }
                  }}
                >
                  {t("common.delete")}
                </button>
              )}
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setContextMode("live");
                  onClose();
                }}
              >
                {t("archive.fullThread")}
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!selected}
                onClick={() => {
                  if (!selected) return;
                  setContextMode("archive", selected.id);
                  onClose();
                }}
              >
                {t("archive.continue")}
              </button>
            </>
          )}
        </div>
    </AccessibleModal>
  );
}
