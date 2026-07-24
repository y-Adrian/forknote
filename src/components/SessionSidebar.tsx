import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { ForkNoteLogo } from "./BranchLogo";
import { useLocale } from "../lib/i18n";
import {
  resolveSessionModel,
  truncateModelLabel,
} from "../lib/sessionModel";
import { groupSessionsByDate } from "../lib/sessionGroups";
import { useTheme } from "../lib/theme";
import { useAppStore } from "../store/useAppStore";
import type { NodeId } from "../types";

interface Props {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenSettings: () => void;
}

function ThemeToggleButton({
  theme,
  onToggle,
  className = "ds-icon-btn",
  toLightLabel,
  toDarkLabel,
  lightTitle,
  darkTitle,
}: {
  theme: "light" | "dark";
  onToggle: () => void;
  className?: string;
  toLightLabel: string;
  toDarkLabel: string;
  lightTitle: string;
  darkTitle: string;
}) {
  const toLight = theme === "dark";
  return (
    <button
      type="button"
      className={className}
      onClick={onToggle}
      aria-label={toLight ? toLightLabel : toDarkLabel}
      title={toLight ? lightTitle : darkTitle}
    >
      {toLight ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.7" />
          <path
            d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

export function SessionSidebar({
  collapsed,
  onToggleCollapse,
  onOpenSettings,
}: Props) {
  const { t } = useLocale();
  const sessions = useAppStore((s) => s.sessions);
  const settings = useAppStore((s) => s.settings);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const loadingMain = useAppStore((s) => s.loadingMain);
  const createSession = useAppStore((s) => s.createSession);
  const switchSession = useAppStore((s) => s.switchSession);
  const deleteSession = useAppStore((s) => s.deleteSession);
  const renameSession = useAppStore((s) => s.renameSession);
  const { theme, toggleTheme } = useTheme();

  const [renamingId, setRenamingId] = useState<NodeId | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [menuId, setMenuId] = useState<NodeId | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const skipBlurCommit = useRef(false);

  const groups = useMemo(
    () =>
      groupSessionsByDate(sessions, {
        today: t("sidebar.today"),
        previous7: t("sidebar.previous7"),
      }),
    [sessions, t],
  );

  useEffect(() => {
    if (renamingId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingId]);

  useEffect(() => {
    if (!menuId) return;
    const close = () => setMenuId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuId]);

  const startRename = (id: NodeId, current: string) => {
    setMenuId(null);
    setRenamingId(id);
    setDraftTitle(current);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setDraftTitle("");
  };

  const commitRename = () => {
    if (!renamingId) return;
    const ok = renameSession(renamingId, draftTitle);
    if (ok) cancelRename();
    else renameInputRef.current?.focus();
  };

  const handleRenameBlur = () => {
    if (skipBlurCommit.current) {
      skipBlurCommit.current = false;
      return;
    }
    commitRename();
  };

  const handleRenameKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      skipBlurCommit.current = true;
      cancelRename();
    }
  };

  const handleDelete = (e: MouseEvent, id: NodeId) => {
    e.stopPropagation();
    setMenuId(null);
    if (confirm(t("sidebar.deleteConfirm"))) {
      if (renamingId === id) cancelRename();
      deleteSession(id);
    }
  };

  const themeToggleProps = {
    theme,
    onToggle: toggleTheme,
    toLightLabel: t("sidebar.toLight"),
    toDarkLabel: t("sidebar.toDark"),
    lightTitle: t("sidebar.lightMode"),
    darkTitle: t("sidebar.darkMode"),
  };

  return (
    <aside
      className={`ds-sidebar fn-sidebar${collapsed ? " collapsed" : ""}`}
      aria-label={t("sidebar.notesAria")}
    >
      <div className="ds-sidebar-top">
        {collapsed ? (
          <button
            type="button"
            className="ds-brand fn-sidebar-brand-btn"
            onClick={onToggleCollapse}
            aria-label={t("sidebar.expand")}
            title={t("sidebar.expand")}
          >
            <ForkNoteLogo collapsed />
          </button>
        ) : (
          <div className="ds-brand">
            <ForkNoteLogo collapsed={false} />
          </div>
        )}
        {!collapsed && (
          <div className="ds-sidebar-tools">
            <ThemeToggleButton {...themeToggleProps} />
            <button
              type="button"
              className="ds-icon-btn"
              onClick={onToggleCollapse}
              aria-label={t("sidebar.collapse")}
              title={t("sidebar.collapse")}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 6h16M4 12h10M4 18h16"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        )}
      </div>

      {!collapsed && (
        <>
          <button
            type="button"
            className="fn-new-note"
            onClick={() => createSession()}
            disabled={loadingMain}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            {t("sidebar.newNote")}
          </button>

          <div className="ds-session-scroll">
            {groups.length === 0 && (
              <p className="fn-sidebar-empty">{t("sidebar.empty")}</p>
            )}
            {groups.map((group) => (
              <div key={group.label} className="ds-session-group">
                <div className="ds-session-group-label">{group.label}</div>
                <ul className="ds-session-list">
                  {group.sessions.map((session) => {
                    const active = session.id === activeSessionId;
                    const renaming = renamingId === session.id;
                    const menuOpen = menuId === session.id;
                    const modelLabel = truncateModelLabel(
                      resolveSessionModel(session, settings),
                    );

                    return (
                      <li
                        key={session.id}
                        className={`ds-session-row${menuOpen ? " is-menu-open" : ""}`}
                      >
                        {renaming ? (
                          <input
                            ref={renameInputRef}
                            className="fn-session-rename-input"
                            value={draftTitle}
                            onChange={(e) => setDraftTitle(e.target.value)}
                            onKeyDown={handleRenameKey}
                            onBlur={handleRenameBlur}
                            aria-label={t("sidebar.renameAria")}
                            maxLength={80}
                          />
                        ) : (
                          <button
                            type="button"
                            className={`ds-session-item${active ? " active" : ""}`}
                            onClick={() => switchSession(session.id)}
                            onDoubleClick={(e) => {
                              e.preventDefault();
                              startRename(session.id, session.title);
                            }}
                            title={
                              modelLabel
                                ? t("sidebar.sessionHint", {
                                    title: session.title,
                                    model: modelLabel,
                                  })
                                : t("sidebar.renameHint", {
                                    title: session.title,
                                  })
                            }
                          >
                            <span className="fn-session-item-title">
                              {session.title}
                              {session.titleLocked && (
                                <span className="fn-title-locked" aria-hidden>
                                  ·
                                </span>
                              )}
                            </span>
                            {modelLabel ? (
                              <span className="fn-session-item-model">
                                {modelLabel}
                              </span>
                            ) : null}
                          </button>
                        )}

                        {!renaming && (
                          <div className="fn-session-actions">
                            <button
                              type="button"
                              className="fn-session-action"
                              aria-label={t("sidebar.moreAria")}
                              aria-expanded={menuOpen}
                              title={t("sidebar.more")}
                              onClick={(e) => {
                                e.stopPropagation();
                                setMenuId(menuOpen ? null : session.id);
                              }}
                            >
                              ···
                            </button>
                            {menuOpen && (
                              <div
                                className="fn-session-menu"
                                role="menu"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() =>
                                    startRename(session.id, session.title)
                                  }
                                >
                                  {t("sidebar.rename")}
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="is-danger"
                                  onClick={(e) => handleDelete(e, session.id)}
                                >
                                  {t("sidebar.delete")}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          <div className="ds-sidebar-footer">
            <button
              type="button"
              className="ds-footer-user fn-settings-btn"
              onClick={onOpenSettings}
              title={t("common.settings")}
              aria-label={t("common.settings")}
            >
              <span className="ds-avatar">F</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </>
      )}

      {collapsed && (
        <div className="fn-sidebar-collapsed-actions">
          <button
            type="button"
            className="ds-icon-btn"
            onClick={() => createSession()}
            disabled={loadingMain}
            aria-label={t("sidebar.newNote")}
            title={t("sidebar.newNote")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <ThemeToggleButton {...themeToggleProps} />
          <button
            type="button"
            className="ds-icon-btn"
            onClick={onOpenSettings}
            aria-label={t("common.settings")}
            title={t("common.settings")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      )}
    </aside>
  );
}
