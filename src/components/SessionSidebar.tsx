import type { MouseEvent } from "react";
import { BranchLogo } from "./BranchLogo";
import { groupSessionsByDate } from "../lib/sessionGroups";
import { useAppStore } from "../store/useAppStore";
import type { NodeId } from "../types";

interface Props {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenSettings: () => void;
}

export function SessionSidebar({
  collapsed,
  onToggleCollapse,
  onOpenSettings,
}: Props) {
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const loadingMain = useAppStore((s) => s.loadingMain);
  const createSession = useAppStore((s) => s.createSession);
  const switchSession = useAppStore((s) => s.switchSession);
  const deleteSession = useAppStore((s) => s.deleteSession);

  const groups = groupSessionsByDate(sessions);

  const handleDelete = (e: MouseEvent, id: NodeId) => {
    e.stopPropagation();
    if (confirm("删除这条会话？将无法恢复。")) {
      deleteSession(id);
    }
  };

  return (
    <aside
      className={`ds-sidebar${collapsed ? " collapsed" : ""}`}
      aria-label="会话列表"
    >
      <div className="ds-sidebar-top">
        <div className="ds-brand">
          <BranchLogo collapsed={collapsed} />
        </div>
        <div className="ds-sidebar-tools">
          <button
            type="button"
            className="ds-icon-btn"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
            title={collapsed ? "展开侧栏" : "收起侧栏"}
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
      </div>

      {!collapsed && (
        <>
          <button
            type="button"
            className="ds-new-chat"
            onClick={() => createSession()}
            disabled={loadingMain}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            开启新对话
          </button>

          <div className="ds-session-scroll">
            {groups.map((group) => (
              <div key={group.label} className="ds-session-group">
                <div className="ds-session-group-label">{group.label}</div>
                <ul className="ds-session-list">
                  {group.sessions.map((session) => {
                    const active = session.id === activeSessionId;
                    return (
                      <li key={session.id} className="ds-session-row">
                        <button
                          type="button"
                          className={`ds-session-item${active ? " active" : ""}`}
                          onClick={() => switchSession(session.id)}
                          title={session.title}
                        >
                          {session.title}
                        </button>
                        <button
                          type="button"
                          className="ds-session-more"
                          aria-label="删除会话"
                          onClick={(e) => handleDelete(e, session.id)}
                        >
                          ×
                        </button>
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
              className="ds-footer-user"
              onClick={onOpenSettings}
              title="设置与 API"
            >
              <span className="ds-avatar">B</span>
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
    </aside>
  );
}
