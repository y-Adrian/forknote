import type { MouseEvent } from "react";
import { useAppStore } from "../store/useAppStore";
import type { NodeId } from "../types";

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
  });
}

export function SessionSidebar() {
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const loadingMain = useAppStore((s) => s.loadingMain);
  const createSession = useAppStore((s) => s.createSession);
  const switchSession = useAppStore((s) => s.switchSession);
  const deleteSession = useAppStore((s) => s.deleteSession);

  const handleDelete = (e: MouseEvent, id: NodeId) => {
    e.stopPropagation();
    if (
      confirm("删除这条会话？批注与回答将一并移除，且无法恢复。")
    ) {
      deleteSession(id);
    }
  };

  return (
    <aside className="session-sidebar" aria-label="会话列表">
      <div className="session-sidebar-header">
        <h2>会话</h2>
        <button
          type="button"
          className="btn primary sm"
          onClick={() => createSession()}
          disabled={loadingMain}
        >
          新建
        </button>
      </div>

      <ul className="session-list">
        {sessions.map((session) => {
          const active = session.id === activeSessionId;
          const hasContent = Boolean(session.thread);
          return (
            <li key={session.id}>
              <button
                type="button"
                className={`session-item${active ? " active" : ""}`}
                onClick={() => switchSession(session.id)}
              >
                <span className="session-title">{session.title}</span>
                <span className="session-meta">
                  {hasContent ? "已有对话" : "空白"}
                  {" · "}
                  {formatTime(session.updatedAt)}
                </span>
              </button>
              <button
                type="button"
                className="session-delete"
                aria-label={`删除会话：${session.title}`}
                title="删除会话"
                onClick={(e) => handleDelete(e, session.id)}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>

      <p className="hint session-hint">
        每条会话独立保存。选中会话后在右侧提问；批注追问为可选功能。
      </p>
    </aside>
  );
}
