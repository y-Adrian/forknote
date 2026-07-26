/**
 * Settings → Memory: layer toggles + editable preferences / project pack / session.
 */
import { useEffect, useState } from "react";
import {
  loadContextMemoryPack,
  MEMORY_FILES,
  type MemoryFileName,
} from "../lib/contextMemory";
import { useLocale } from "../lib/i18n";
import { normalizeApiSettings, saveSettings } from "../lib/settings";
import {
  addUserPreference,
  deleteUserPreference,
  loadUserPreferences,
  updateUserPreference,
} from "../lib/userPreferences";
import { useAppStore } from "../store/useAppStore";
import type {
  ApiSettings,
  ContextMemoryPack,
  UserPreferenceEntry,
} from "../types";

function LayerToggles({
  draft,
  setDraft,
}: {
  draft: ApiSettings;
  setDraft: (next: ApiSettings) => void;
}) {
  const { t } = useLocale();
  const setLayer = (
    key: "memoryLayerPreferences" | "memoryLayerProject" | "memoryLayerSession",
    checked: boolean,
  ) => {
    const next: ApiSettings = { ...draft, [key]: checked };
    if (key === "memoryLayerProject") next.contextMemoryEnabled = checked;
    setDraft(next);
  };
  return (
    <div className="fn-memory-layers">
      <h4 className="ss-subhead">{t("memory.layersTitle")}</h4>
      <p className="ss-panel-lead ss-panel-hint">{t("memory.layersLead")}</p>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={draft.memoryLayerPreferences !== false}
          onChange={(e) => setLayer("memoryLayerPreferences", e.target.checked)}
        />
        {t("memory.layer.preferences")}
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={
            draft.memoryLayerProject != null
              ? draft.memoryLayerProject !== false
              : draft.contextMemoryEnabled !== false
          }
          onChange={(e) => setLayer("memoryLayerProject", e.target.checked)}
        />
        {t("memory.layer.project")}
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={draft.memoryLayerSession !== false}
          onChange={(e) => setLayer("memoryLayerSession", e.target.checked)}
        />
        {t("memory.layer.session")}
      </label>
    </div>
  );
}

function PreferencesEditor() {
  const { t } = useLocale();
  const [entries, setEntries] = useState<UserPreferenceEntry[]>(() =>
    loadUserPreferences(),
  );
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  return (
    <div className="fn-memory-section">
      <h4 className="ss-subhead">{t("memory.prefsTitle")}</h4>
      <p className="ss-panel-lead ss-panel-hint">{t("memory.prefsLead")}</p>
      <ul className="fn-memory-list">
        {entries.length === 0 ? (
          <li className="fn-memory-empty">{t("memory.prefsEmpty")}</li>
        ) : (
          entries.map((entry) => (
            <li key={entry.id} className="fn-memory-item">
              {editingId === entry.id ? (
                <div className="fn-memory-edit-row">
                  <textarea
                    rows={2}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                  />
                  <div className="fn-memory-item-actions">
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => {
                        setEditingId(null);
                        setEditText("");
                      }}
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() => {
                        setEntries(updateUserPreference(entry.id, editText));
                        setEditingId(null);
                        setEditText("");
                      }}
                    >
                      {t("common.save")}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="fn-memory-item-text">{entry.text}</p>
                  <div className="fn-memory-item-actions">
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => {
                        setEditingId(entry.id);
                        setEditText(entry.text);
                      }}
                    >
                      {t("memory.edit")}
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => setEntries(deleteUserPreference(entry.id))}
                    >
                      {t("common.delete")}
                    </button>
                  </div>
                </>
              )}
            </li>
          ))
        )}
      </ul>
      <div className="fn-memory-add">
        <textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("memory.prefsPlaceholder")}
        />
        <button
          type="button"
          className="btn primary"
          disabled={!draft.trim()}
          onClick={() => {
            setEntries(addUserPreference(draft));
            setDraft("");
          }}
        >
          {t("memory.prefsAdd")}
        </button>
      </div>
    </div>
  );
}

function ProjectPackEditor() {
  const { t } = useLocale();
  const settings = useAppStore((s) => s.settings);
  const projectRoot = useAppStore((s) => s.projectRoot);
  const sidecarUrl = useAppStore((s) => s.sidecarUrl);
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const saveContextMemoryFields = useAppStore((s) => s.saveContextMemoryFields);
  const session = sessions.find((s) => s.id === activeSessionId);
  const [pack, setPack] = useState<ContextMemoryPack | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await loadContextMemoryPack({
        settings,
        session,
        projectRoot,
        sidecarUrl,
      });
      if (!cancelled) setPack(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [settings, session, projectRoot, sidecarUrl, activeSessionId]);

  const setField = (file: MemoryFileName, value: string) => {
    setPack((prev) => {
      const base = prev ?? {
        summary: "",
        tasks: "",
        decisions: "",
        updatedAt: Date.now(),
        storage: projectRoot ? ("project" as const) : ("local" as const),
      };
      if (file === "SUMMARY.md") return { ...base, summary: value };
      if (file === "TASKS.md") return { ...base, tasks: value };
      return { ...base, decisions: value };
    });
  };
  const valueFor = (file: MemoryFileName): string => {
    if (!pack) return "";
    if (file === "SUMMARY.md") return pack.summary;
    if (file === "TASKS.md") return pack.tasks;
    return pack.decisions;
  };

  return (
    <div className="fn-memory-section">
      <h4 className="ss-subhead">{t("memory.projectTitle")}</h4>
      <p className="ss-panel-lead ss-panel-hint">
        {projectRoot
          ? t("memory.projectLeadBound", {
              dir: settings.memoryDir || ".forknote/memory",
            })
          : t("memory.projectLeadLocal")}
      </p>
      {MEMORY_FILES.map((file) => (
        <label key={file} className="fn-memory-file-label">
          {file}
          <textarea
            rows={5}
            value={valueFor(file)}
            onChange={(e) => setField(file, e.target.value)}
            spellCheck={false}
          />
        </label>
      ))}
      <div className="modal-actions">
        <button
          type="button"
          className="btn primary"
          disabled={saving}
          onClick={() => {
            const current = pack ?? {
              summary: "",
              tasks: "",
              decisions: "",
              updatedAt: Date.now(),
              storage: "local" as const,
            };
            setSaving(true);
            setStatus(null);
            void saveContextMemoryFields({
              summary: current.summary,
              tasks: current.tasks,
              decisions: current.decisions,
            })
              .then(() => setStatus(t("common.saved")))
              .catch((e) =>
                setStatus(
                  e instanceof Error ? e.message : t("memory.saveFailed"),
                ),
              )
              .finally(() => setSaving(false));
          }}
        >
          {t("memory.projectSave")}
        </button>
      </div>
      {status ? <p className="hint local-hint">{status}</p> : null}
    </div>
  );
}

function SessionMemoryEditor() {
  const { t } = useLocale();
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setSessionMemory = useAppStore((s) => s.setSessionMemory);
  const session = sessions.find((s) => s.id === activeSessionId);
  const [draft, setDraft] = useState(session?.sessionMemory?.summary ?? "");
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    setDraft(session?.sessionMemory?.summary ?? "");
    setStatus(null);
  }, [session?.id, session?.sessionMemory?.updatedAt]);
  return (
    <div className="fn-memory-section">
      <h4 className="ss-subhead">{t("memory.sessionTitle")}</h4>
      <p className="ss-panel-lead ss-panel-hint">{t("memory.sessionLead")}</p>
      {!activeSessionId ? (
        <p className="fn-memory-empty">{t("memory.sessionNone")}</p>
      ) : (
        <>
          <textarea
            rows={5}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("memory.sessionPlaceholder")}
          />
          <div className="modal-actions">
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setDraft("");
                setSessionMemory("");
                setStatus(t("common.saved"));
              }}
            >
              {t("memory.sessionClear")}
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setSessionMemory(draft);
                setStatus(t("common.saved"));
              }}
            >
              {t("common.save")}
            </button>
          </div>
          {status ? <p className="hint local-hint">{status}</p> : null}
        </>
      )}
    </div>
  );
}

export function MemorySettingsPanel({
  draft,
  setDraft,
  onSave,
}: {
  draft: ApiSettings;
  setDraft: (next: ApiSettings) => void;
  onSave: (settings: ApiSettings) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="ss-panel fn-memory-panel">
      <h3 className="ss-panel-title">{t("memory.title")}</h3>
      <p className="ss-panel-lead">{t("memory.lead")}</p>
      <LayerToggles draft={draft} setDraft={setDraft} />
      <div className="modal-actions">
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            const next = normalizeApiSettings(draft);
            saveSettings(next);
            onSave(next);
          }}
        >
          {t("memory.saveLayers")}
        </button>
      </div>
      <hr className="ss-divider" />
      <PreferencesEditor />
      <hr className="ss-divider" />
      <ProjectPackEditor />
      <hr className="ss-divider" />
      <SessionMemoryEditor />
    </div>
  );
}
