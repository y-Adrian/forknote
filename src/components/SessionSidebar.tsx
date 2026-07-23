import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { ForkNoteLogo } from "./BranchLogo";
import { groupSessionsByDate } from "../lib/sessionGroups";
import { useTheme } from "../lib/theme";
import { useAppStore } from "../store/useAppStore";
import type { NodeId } from "../types";

interface Props {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenSettings: () => void;
  onOpenProject: () => void;
}

function ThemeToggleButton({
  theme,
  onToggle,
  className = "ds-icon-btn",
}: {
  theme: "light" | "dark";
  onToggle: () => void;
  className?: string;
}) {
  const toLight = theme === "dark";
  return (
    <button
      type="button"
      className={className}
      onClick={onToggle}
      aria-label={toLight ? "Switch to light mode" : "Switch to dark mode"}
      title={toLight ? "Light mode" : "Dark mode"}
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
  onOpenProject,
}: Props) {
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const loadingMain = useAppStore((s) => s.loadingMain);
  const projectRoot = useAppStore((s) => s.projectRoot);
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

  const groups = groupSessionsByDate(sessions);

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
    if (confirm("Delete this note? This cannot be undone.")) {
      if (renamingId === id) cancelRename();
      deleteSession(id);
    }
  };

  return (
    <aside
      className={`ds-sidebar fn-sidebar${collapsed ? " collapsed" : ""}`}
      aria-label="Notes"
    >
      <div className="ds-sidebar-top">
        {collapsed ? (
          <button
            type="button"
            className="ds-brand fn-sidebar-brand-btn"
            onClick={onToggleCollapse}
            aria-label="Expand sidebar"
            title="Expand sidebar"
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
            <ThemeToggleButton theme={theme} onToggle={toggleTheme} />
            <button
              type="button"
              className="ds-icon-btn"
              onClick={onToggleCollapse}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
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
            New note
          </button>

          <div className="ds-session-scroll">
            {groups.length === 0 && (
              <p className="fn-sidebar-empty">No notes yet — ask a question on the right.</p>
            )}
            {groups.map((group) => (
              <div key={group.label} className="ds-session-group">
                <div className="ds-session-group-label">{group.label}</div>
                <ul className="ds-session-list">
                  {group.sessions.map((session) => {
                    const active = session.id === activeSessionId;
                    const renaming = renamingId === session.id;
                    const menuOpen = menuId === session.id;

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
                            aria-label="Rename note"
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
                            title={`${session.title} (double-click to rename)`}
                          >
                            {session.title}
                            {session.titleLocked && (
                              <span className="fn-title-locked" aria-hidden>
                                ·
                              </span>
                            )}
                          </button>
                        )}

                        {!renaming && (
                          <div className="fn-session-actions">
                            <button
                              type="button"
                              className="fn-session-action"
                              aria-label="More actions"
                              aria-expanded={menuOpen}
                              title="More"
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
                                  Rename
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="is-danger"
                                  onClick={(e) => handleDelete(e, session.id)}
                                >
                                  Delete
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
              className="ds-footer-user fn-project-btn"
              onClick={onOpenProject}
              title={projectRoot ? `Project: ${projectRoot}` : "Open local project"}
              aria-label={projectRoot ? "Project connected" : "Open local project"}
            >
              <span className={`fn-project-dot${projectRoot ? " is-on" : ""}`} aria-hidden />
              <span className="fn-project-btn-label">
                {projectRoot ? "Project" : "Open project"}
              </span>
            </button>
            <button
              type="button"
              className="ds-footer-user fn-settings-btn"
              onClick={onOpenSettings}
              title="API settings"
              aria-label="API settings"
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
            aria-label="New note"
            title="New note"
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
          <ThemeToggleButton theme={theme} onToggle={toggleTheme} />
          <button
            type="button"
            className="ds-icon-btn"
            onClick={onOpenProject}
            aria-label="Open local project"
            title={projectRoot ? `Project: ${projectRoot}` : "Open local project"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v7A1.5 1.5 0 0 1 19.5 18h-15A1.5 1.5 0 0 1 3 16.5v-9z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="ds-icon-btn"
            onClick={onOpenSettings}
            aria-label="API settings"
            title="API settings"
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
