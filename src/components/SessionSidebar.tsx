import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ForkNoteLogo } from "./BranchLogo";
import { useLocale } from "../lib/i18n";
import {
  resolveSessionModel,
  truncateModelLabel,
} from "../lib/sessionApi";
import { groupSessionsByDate } from "../lib/sessionGroups";
import {
  displaySessionTitle,
  getSkipSessionDeleteConfirm,
  setSkipSessionDeleteConfirm,
} from "../lib/storage";
import { useTheme } from "../lib/theme";
import { useAppStore } from "../store/useAppStore";
import type { ChatSession, NodeId } from "../types";
import { ShareSessionDialog } from "./ShareSessionDialog";

type MenuPos = { top: number; right: number };

interface Props {
  collapsed: boolean;
  /** True below the 768px shell breakpoint — drawer overlay, not icon rail. */
  narrowViewport: boolean;
  mobileNavOpen: boolean;
  onToggleCollapse: () => void;
  onCloseMobileNav: () => void;
  onOpenSettings: () => void;
}

function IconRename() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 20h4l10.5-10.5a1.5 1.5 0 0 0 0-2.12L16.62 5.5a1.5 1.5 0 0 0-2.12 0L4 16v4z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M13.5 6.5l4 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconPin({ filled }: { filled?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M15 4.5l4.5 4.5-3.2.8a2 2 0 0 0-1.1 1.1L14.4 14 10 9.6l2.1-.8a2 2 0 0 0 1.1-1.1L15 4.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill={filled ? "currentColor" : "none"}
      />
      <path
        d="M10 9.6L5 19l9.4-5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconShare() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="18" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="6" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="18" cy="19" r="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M8.4 13.2l7.2 4.1M15.6 6.7l-7.2 4.1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconMemoryShare({ shared }: { shared?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3v6M8 7h8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <rect
        x="5"
        y="11"
        width="14"
        height="9"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
        fill={shared ? "currentColor" : "none"}
        fillOpacity={shared ? 0.15 : 0}
      />
      <path
        d="M9 15h6M9 17.5h4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M8 7l1 12a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1l1-12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MenuItem({
  danger,
  onClick,
  icon,
  children,
}: {
  danger?: boolean;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={danger ? "is-danger" : undefined}
      onClick={onClick}
    >
      <span className="fn-session-menu-icon">{icon}</span>
      <span className="fn-session-menu-label">{children}</span>
    </button>
  );
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
  narrowViewport,
  mobileNavOpen,
  onToggleCollapse,
  onCloseMobileNav,
  onOpenSettings,
}: Props) {
  const { t } = useLocale();
  const sessions = useAppStore((s) => s.sessions);
  const settings = useAppStore((s) => s.settings);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const createSession = useAppStore((s) => s.createSession);
  const switchSession = useAppStore((s) => s.switchSession);
  const deleteSession = useAppStore((s) => s.deleteSession);
  const renameSession = useAppStore((s) => s.renameSession);
  const togglePinSession = useAppStore((s) => s.togglePinSession);
  const setShareMemory = useAppStore((s) => s.setShareMemory);
  const { theme, toggleTheme } = useTheme();

  const [renamingId, setRenamingId] = useState<NodeId | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [menuId, setMenuId] = useState<NodeId | null>(null);
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    id: NodeId;
    pos: MenuPos;
  } | null>(null);
  const [skipDeleteConfirmChecked, setSkipDeleteConfirmChecked] =
    useState(false);
  const [shareSession, setShareSession] = useState<ChatSession | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const skipBlurCommit = useRef(false);

  const groups = useMemo(
    () =>
      groupSessionsByDate(sessions, {
        today: t("sidebar.today"),
        previous7: t("sidebar.previous7"),
        pinned: t("sidebar.pinned"),
      }),
    [sessions, t],
  );

  const closeNarrowDrawer = () => {
    if (narrowViewport) onCloseMobileNav();
  };

  const openSession = (id: NodeId) => {
    switchSession(id);
    closeNarrowDrawer();
  };

  const handleNewNote = () => {
    createSession();
    closeNarrowDrawer();
  };

  const menuSession = useMemo(
    () => (menuId ? sessions.find((s) => s.id === menuId) : undefined),
    [menuId, sessions],
  );

  const menuPinned =
    typeof menuSession?.pinnedAt === "number" && menuSession.pinnedAt > 0;
  const menuShareMemory = menuSession?.shareMemory !== false;

  const closeMenu = () => {
    setMenuId(null);
    setMenuPos(null);
  };

  const closeConfirmDelete = () => {
    setConfirmDelete(null);
    setSkipDeleteConfirmChecked(false);
  };

  useEffect(() => {
    if (renamingId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingId]);

  useEffect(() => {
    if (!menuId) return;

    const onPointerDown = (e: Event) => {
      const target = e.target;
      if (!(target instanceof Element)) {
        closeMenu();
        return;
      }
      if (
        target.closest(".fn-session-menu") ||
        target.closest(".fn-session-action")
      ) {
        return;
      }
      closeMenu();
    };

    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };

    // Defer so the opening click does not immediately dismiss the menu.
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", onPointerDown);
    }, 0);

    const onScrollOrResize = () => closeMenu();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("scroll", onScrollOrResize, true);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [menuId]);

  useEffect(() => {
    if (!confirmDelete) return;

    const onPointerDown = (e: Event) => {
      const target = e.target;
      if (!(target instanceof Element)) {
        closeConfirmDelete();
        return;
      }
      if (target.closest(".fn-session-delete-confirm")) return;
      closeConfirmDelete();
    };

    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") closeConfirmDelete();
    };

    // Defer so the Delete click that opens this float does not dismiss it.
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", onPointerDown);
    }, 0);

    const onScrollOrResize = () => closeConfirmDelete();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("scroll", onScrollOrResize, true);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [confirmDelete]);

  useEffect(() => {
    if (menuId && !menuSession) closeMenu();
  }, [menuId, menuSession]);

  useEffect(() => {
    if (
      confirmDelete &&
      !sessions.some((s) => s.id === confirmDelete.id)
    ) {
      closeConfirmDelete();
    }
  }, [confirmDelete, sessions]);

  const startRename = (id: NodeId, current: string) => {
    closeMenu();
    closeConfirmDelete();
    setRenamingId(id);
    setDraftTitle(displaySessionTitle(current));
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

  const performDelete = (id: NodeId) => {
    if (renamingId === id) cancelRename();
    deleteSession(id);
  };

  const handleDelete = (e: MouseEvent, id: NodeId) => {
    e.stopPropagation();
    const pos = menuPos;
    closeMenu();
    if (getSkipSessionDeleteConfirm()) {
      performDelete(id);
      return;
    }
    if (!pos) return;
    setSkipDeleteConfirmChecked(false);
    setConfirmDelete({ id, pos });
  };

  const commitDelete = () => {
    if (!confirmDelete) return;
    const id = confirmDelete.id;
    if (skipDeleteConfirmChecked) {
      setSkipSessionDeleteConfirm(true);
    }
    performDelete(id);
    closeConfirmDelete();
  };

  const handlePin = () => {
    if (!menuSession) return;
    togglePinSession(menuSession.id);
    closeMenu();
  };

  const handleToggleShareMemory = () => {
    if (!menuSession) return;
    setShareMemory(menuSession.id, menuSession.shareMemory === false);
    closeMenu();
  };

  const handleShare = () => {
    if (!menuSession) return;
    setShareSession(menuSession);
    closeMenu();
  };

  const toggleMenu = (e: MouseEvent<HTMLButtonElement>, id: NodeId) => {
    e.stopPropagation();
    closeConfirmDelete();
    if (menuId === id) {
      closeMenu();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuPos({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    });
    setMenuId(id);
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
      className={`ds-sidebar fn-sidebar${collapsed ? " collapsed" : ""}${
        narrowViewport && mobileNavOpen ? " is-drawer-open" : ""
      }`}
      aria-label={t("sidebar.notesAria")}
      aria-hidden={narrowViewport && !mobileNavOpen ? true : undefined}
      {...(narrowViewport && !mobileNavOpen ? { inert: true } : {})}
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
              aria-label={
                narrowViewport ? t("sidebar.closeList") : t("sidebar.collapse")
              }
              title={
                narrowViewport ? t("sidebar.closeList") : t("sidebar.collapse")
              }
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
            onClick={handleNewNote}
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
                            onClick={() => openSession(session.id)}
                            onDoubleClick={(e) => {
                              e.preventDefault();
                              startRename(session.id, session.title);
                            }}
                            title={
                              modelLabel
                                ? t("sidebar.sessionHint", {
                                    title: displaySessionTitle(session.title),
                                    model: modelLabel,
                                  })
                                : t("sidebar.renameHint", {
                                    title: displaySessionTitle(session.title),
                                  })
                            }
                          >
                            <span className="fn-session-item-title">
                              {displaySessionTitle(session.title)}
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
                              aria-haspopup="menu"
                              title={t("sidebar.more")}
                              onClick={(e) => toggleMenu(e, session.id)}
                            >
                              ···
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          {menuSession && menuPos
            ? createPortal(
                <div
                  className="fn-session-menu"
                  role="menu"
                  style={{ top: menuPos.top, right: menuPos.right }}
                >
                  <MenuItem
                    icon={<IconRename />}
                    onClick={() =>
                      startRename(menuSession.id, menuSession.title)
                    }
                  >
                    {t("sidebar.rename")}
                  </MenuItem>
                  <MenuItem
                    icon={<IconPin filled={menuPinned} />}
                    onClick={handlePin}
                  >
                    {menuPinned ? t("sidebar.unpin") : t("sidebar.pin")}
                  </MenuItem>
                  <MenuItem
                    icon={<IconMemoryShare shared={menuShareMemory} />}
                    onClick={handleToggleShareMemory}
                  >
                    {menuShareMemory
                      ? t("sidebar.isolateMemory")
                      : t("sidebar.shareMemory")}
                  </MenuItem>
                  <MenuItem icon={<IconShare />} onClick={handleShare}>
                    {t("sidebar.share")}
                  </MenuItem>
                  <MenuItem
                    danger
                    icon={<IconTrash />}
                    onClick={(e) => handleDelete(e, menuSession.id)}
                  >
                    {t("sidebar.delete")}
                  </MenuItem>
                </div>,
                document.body,
              )
            : null}

          {confirmDelete
            ? createPortal(
                <div
                  className="fn-session-delete-confirm"
                  role="alertdialog"
                  aria-modal="true"
                  aria-labelledby="fn-session-delete-title"
                  style={{
                    top: confirmDelete.pos.top,
                    right: confirmDelete.pos.right,
                  }}
                >
                  <p id="fn-session-delete-title">
                    {t("sidebar.deleteConfirm")}
                  </p>
                  <label className="fn-session-delete-confirm-skip">
                    <input
                      type="checkbox"
                      checked={skipDeleteConfirmChecked}
                      onChange={(e) =>
                        setSkipDeleteConfirmChecked(e.target.checked)
                      }
                    />
                    {t("sidebar.deleteDontAskAgain")}
                  </label>
                  <div className="fn-session-delete-confirm-actions">
                    <button type="button" onClick={closeConfirmDelete}>
                      {t("common.cancel")}
                    </button>
                    <button
                      type="button"
                      className="is-danger"
                      onClick={commitDelete}
                    >
                      {t("common.ok")}
                    </button>
                  </div>
                </div>,
                document.body,
              )
            : null}

          {shareSession
            ? createPortal(
                <ShareSessionDialog
                  session={shareSession}
                  onClose={() => setShareSession(null)}
                />,
                document.body,
              )
            : null}

          <div className="ds-sidebar-footer">
            <div className="ds-footer-bar">
              <span className="ds-avatar" aria-hidden>
                F
              </span>
              <button
                type="button"
                className="ds-icon-btn fn-settings-btn"
                onClick={onOpenSettings}
                title={t("common.settings")}
                aria-label={t("common.settings")}
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
          </div>
        </>
      )}

      {collapsed && (
        <div className="fn-sidebar-collapsed-actions">
          <button
            type="button"
            className="ds-icon-btn"
            onClick={() => createSession()}
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
